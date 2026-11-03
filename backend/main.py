from __future__ import annotations

import configparser
import functools
import io
import shutil
import signal
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from functools import lru_cache
import json
import os
import re
import subprocess
import threading
import uuid
import time
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from backend.security import install_boundary
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DATA = Path(os.environ.get("APP_DATA", "/data")).resolve()
TEST_ROOT = (DATA / "test-remotes").resolve()
CONFIG = DATA / "rclone.conf"
STATE = DATA / "state.json"
LOCK = threading.RLock()
OPERATIONS: dict[str, dict[str, Any]] = {}
OPERATIONS_LOCK = threading.RLock()
SCHEDULER_STARTED = False
SCHEDULER_STOP = threading.Event()
os.umask(0o077)
DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
DATA.chmod(0o700)
TEST_ROOT.mkdir(parents=True, exist_ok=True)

if not CONFIG.exists():
    CONFIG.write_text("", encoding="utf-8")
if not STATE.exists():
    STATE.write_text(json.dumps({"local_roots": {}, "jobs": []}), encoding="utf-8")

for private_file in (CONFIG, STATE):
    private_file.chmod(0o600)

app = FastAPI(title="Rclone Desk", version="0.1.0")
install_boundary(app)
CONFIG_USERS = 0
RCLONE_SLOTS = threading.BoundedSemaphore(8)
EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="rclone")
CANCEL_EVENTS: dict[str, threading.Event] = {}
MAX_PENDING_OPERATIONS = 256
DOWNLOAD_SLOTS = threading.BoundedSemaphore(2)
DOWNLOAD_ROOT = Path(tempfile.gettempdir()) / "rclone-desk-downloads"
DOWNLOAD_ROOT.mkdir(mode=0o700, exist_ok=True)
if DOWNLOAD_ROOT.is_symlink():
    raise RuntimeError("Temporary download directory must not be a symlink")
DOWNLOAD_ROOT.chmod(0o700)
for stale_spool in DOWNLOAD_ROOT.glob("download-*"):
    if stale_spool.is_file() or stale_spool.is_symlink():
        stale_spool.unlink()
MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024
DOWNLOAD_TIMEOUT = 300


def locked(function):
    @functools.wraps(function)
    def wrapper(*args, **kwargs):
        with LOCK:
            return function(*args, **kwargs)
    return wrapper


@contextmanager
def config_use():
    global CONFIG_USERS
    with LOCK:
        CONFIG_USERS += 1
    try:
        yield
    finally:
        with LOCK:
            CONFIG_USERS -= 1


def require_config_idle():
    with OPERATIONS_LOCK:
        active = any(op["status"] in ("queued", "running") for op in OPERATIONS.values())
    if CONFIG_USERS or active:
        raise HTTPException(409, "Wait for active remote operations before editing configuration")


def secure_write(path: Path, content: str) -> None:
    descriptor, name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)

BUCKET_BACKENDS = {"s3", "b2", "google cloud storage", "azureblob", "swift", "storj"}


def state() -> dict[str, Any]:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(500, "Saved state cannot be read; restore a valid backup") from exc


def save_state(value: dict[str, Any]) -> None:
    with LOCK:
        secure_write(STATE, json.dumps(value, indent=2))


def kill_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_rclone(args: list[str], timeout: int = 120) -> str:
    with config_use(), RCLONE_SLOTS:
        try:
            process = subprocess.Popen(
                ["rclone", *args, "--config", str(CONFIG), "--log-level", "ERROR"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
                env={**os.environ, "RCLONE_CONFIG": str(CONFIG), "RCLONE_ASK_PASSWORD": "false"},
            )
        except OSError as exc:
            raise HTTPException(500, "Could not start rclone") from exc
        output = bytearray()
        diagnostics = deque(maxlen=32)
        overflow = threading.Event()

        def read_output():
            for chunk in iter(lambda: process.stdout.read(65536), b""):
                if len(output) + len(chunk) > 32 * 1024 * 1024:
                    overflow.set()
                    kill_process(process)
                    return
                output.extend(chunk)

        def read_errors():
            for chunk in iter(lambda: process.stderr.read(2048), b""):
                diagnostics.append(chunk)

        readers = [threading.Thread(target=read_output, daemon=True), threading.Thread(target=read_errors, daemon=True)]
        for reader in readers:
            reader.start()
        try:
            process.wait(timeout=timeout)
            for reader in readers:
                reader.join(timeout=5)
            if overflow.is_set():
                raise HTTPException(413, "Remote listing exceeds 32 MiB; browse a smaller directory")
            if process.returncode:
                # Raw provider diagnostics may contain credentials or signed URLs.
                raise HTTPException(400, "rclone request failed; check remote configuration and provider access")
            return output.decode("utf-8", errors="replace")
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(504, "rclone operation timed out") from exc
        finally:
            if process.poll() is None:
                kill_process(process)
            process.wait(timeout=5)
            for reader in readers:
                reader.join(timeout=5)
            process.stdout.close()
            process.stderr.close()


def parsed_config() -> configparser.ConfigParser:
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.optionxform = str
    try:
        parser.read(CONFIG, encoding="utf-8")
    except configparser.Error as exc:
        raise HTTPException(400, f"Invalid rclone config: {exc}") from exc
    return parser


def safe_remote(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}", name):
        raise HTTPException(400, "Remote name may contain letters, numbers, dot, underscore and dash")
    return name


def safe_relative(path: str) -> str:
    value = path.strip().replace("\\", "/")
    if len(value) > 4096 or value.startswith("/") or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise HTTPException(400, "Path must be relative to the remote root")
    parts = [p for p in value.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise HTTPException(400, "Parent traversal is not allowed")
    return "/".join(parts)


def remote_path(remote: str, path: str) -> str:
    safe_remote(remote)
    rel = safe_relative(path)
    config = parsed_config()
    if not config.has_section(remote):
        raise HTTPException(404, f"Remote '{remote}' does not exist")
    meta = state().get("local_roots", {}).get(remote) if config[remote].get("type") == "local" else None
    if meta:
        root = Path(meta).resolve()
        if not root.is_relative_to(TEST_ROOT):
            raise HTTPException(400, "Configured test remote root is outside test storage")
        target = (root / rel).resolve()
        if not target.is_relative_to(root):
            raise HTTPException(400, "Path escapes the test remote root")
        return str(target)
    return f"{remote}:{rel}" if rel else f"{remote}:"


def storage_location(remote: str, path: str, visited: frozenset[str] = frozenset()) -> tuple[str, str]:
    if remote in visited:
        raise HTTPException(400, "Remote alias cycle detected")
    config = parsed_config()
    remote_path(remote, path)  # Validate existence and confined symlinks.
    section = config[remote]
    root = state().get("local_roots", {}).get(remote) if section.get("type") == "local" else None
    if root:
        return "local", str((Path(root) / safe_relative(path)).resolve())
    if section.get("type") == "alias":
        base = section.get("remote", "")
        if ":" in base and not base.startswith("/"):
            target, _, prefix = base.partition(":")
            if config.has_section(target):
                return storage_location(target, "/".join(filter(None, [prefix.rstrip("/"), path])), visited | {remote})
        if base.startswith("/"):
            return "local", str((Path(base) / path).resolve())
        raise HTTPException(400, "Alias must reference a configured remote or an absolute local root")
    if section.get("type") == "local":
        return "local", str(Path(path).resolve())
    identity = json.dumps(dict(section), sort_keys=True)
    return identity, safe_relative(path)


def ensure_separate_locations(source_remote: str, source_path: str, destination_remote: str, destination_path: str):
    source_store, source = storage_location(source_remote, source_path)
    destination_store, destination = storage_location(destination_remote, destination_path)
    if source_store != destination_store:
        return
    source = source.rstrip("/")
    destination = destination.rstrip("/")
    if source == destination or not source or not destination or source.startswith(destination + "/") or destination.startswith(source + "/"):
        raise HTTPException(400, "Source and destination must not overlap on the same storage")


def job_destination_path(source_path: str, destination_remote: str, destination_path: str) -> str:
    destination = safe_relative(destination_path)
    if destination:
        return destination
    config = parsed_config()
    if config.has_section(destination_remote) and config[destination_remote].get("type", "").lower() == "s3":
        source = safe_relative(source_path)
        bucket_name = source.rsplit("/", 1)[-1]
        if not bucket_name:
            raise HTTPException(400, "To copy to an S3 root, select a named source folder or choose a destination bucket.")
        return bucket_name
    return destination


class RemoteInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=64)
    options: dict[str, str] = Field(default_factory=dict, max_length=200)
    test_root: bool = False


class ConfigInput(BaseModel):
    content: str = Field(max_length=1024 * 1024)


class TransferInput(BaseModel):
    source_remote: str = Field(min_length=1, max_length=64)
    source_path: str = Field(default="", max_length=4096)
    destination_remote: str = Field(min_length=1, max_length=64)
    destination_path: str = Field(default="", max_length=4096)
    mode: str = "move"


class JobInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    source_remote: str = Field(min_length=1, max_length=64)
    source_path: str = Field(default="", max_length=4096)
    destination_remote: str = Field(min_length=1, max_length=64)
    destination_path: str = Field(default="", max_length=4096)
    mode: str = "copy"
    cron: str | None = Field(default=None, max_length=128)
    schedule_enabled: bool = False
    schedule_sync_confirmed: bool = False


class RunInput(BaseModel):
    confirm_sync_deletions: bool = False


class DownloadSelectionInput(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=200)


class DeleteSelectionInput(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=200)


class BucketInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)


def parse_cron_field(value: str, minimum: int, maximum: int) -> set[int]:
    result: set[int] = set()
    for part in value.split(","):
        base, slash, step_text = part.partition("/")
        step = int(step_text) if slash else 1
        if step < 1:
            raise ValueError("Cron step must be positive")
        if base == "*":
            start, end = minimum, maximum
        elif "-" in base:
            left, right = base.split("-", 1)
            start, end = int(left), int(right)
        else:
            start = end = int(base)
        if start < minimum or end > maximum or start > end:
            raise ValueError(f"Cron value must be between {minimum} and {maximum}")
        result.update(range(start, end + 1, step))
    if not result:
        raise ValueError("Cron field cannot be empty")
    return result


def validate_cron(expression: str) -> list[set[int]]:
    if len(expression) > 128:
        raise ValueError("Cron expression exceeds 128 characters")
    fields = expression.split()
    if len(fields) != 5:
        raise ValueError("Use five cron fields: minute hour day month weekday")
    ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)]
    parsed = [parse_cron_field(value, low, high) for value, (low, high) in zip(fields, ranges)]
    if 7 in parsed[4]:
        parsed[4].add(0)
    return parsed


def cron_matches(expression: str, moment: datetime) -> bool:
    minute, hour, day, month, weekday = validate_cron(expression)
    fields = expression.split()
    return _cron_fields_match(fields, minute, hour, day, month, weekday, moment)


def _cron_fields_match(fields: list[str], minute: set[int], hour: set[int], day: set[int],
                       month: set[int], weekday: set[int], moment: datetime) -> bool:
    cron_weekday = (moment.weekday() + 1) % 7
    dom_match = moment.day in day
    dow_match = cron_weekday in weekday
    day_match = (dom_match or dow_match) if fields[2] != "*" and fields[4] != "*" else dom_match and dow_match
    return moment.minute in minute and moment.hour in hour and moment.month in month and day_match


def next_cron_run(expression: str, after: datetime | None = None) -> str | None:
    now = after or datetime.now(timezone.utc)
    return _next_cron_run(expression, now.replace(second=0, microsecond=0))


@lru_cache(maxsize=256)
def _next_cron_run(expression: str, now: datetime) -> str | None:
    fields = expression.split()
    minute, hour, day, month, weekday = validate_cron(expression)
    # Inspect days first, then only scheduled hours/minutes (not 2.6M minutes).
    candidate = now.replace(hour=0, minute=0)
    for offset in range(366 * 5):
        date = candidate + timedelta(days=offset)
        if not _cron_fields_match(fields, {0}, {0}, day, month, weekday, date):
            continue
        for h in sorted(hour):
            for m in sorted(minute):
                result = date.replace(hour=h, minute=m)
                if result > now:
                    return result.isoformat()
    return None


def operation_snapshot() -> list[dict[str, Any]]:
    with OPERATIONS_LOCK:
        cutoff = datetime.now(timezone.utc).timestamp() - 1800
        for operation_id, operation in list(OPERATIONS.items()):
            finished = operation.get("finished_at")
            if finished and datetime.fromisoformat(finished).timestamp() < cutoff:
                del OPERATIONS[operation_id]
                CANCEL_EVENTS.pop(operation_id, None)
        return [dict(value) for value in OPERATIONS.values()]


def rclone_size_bytes(value: str) -> int:
    match = re.fullmatch(r"\s*([\d,.]+)\s*([KMGT]?i?B|B)?\s*", value, re.IGNORECASE)
    if not match:
        return 0
    amount = float(match.group(1).replace(",", ""))
    unit = (match.group(2) or "B").lower()
    powers = {"b": 0, "kb": 1, "kib": 1, "mb": 2, "mib": 2,
              "gb": 3, "gib": 3, "tb": 4, "tib": 4}
    return int(amount * (1024 ** powers.get(unit, 0)))


def parse_rclone_stats_line(line: str) -> dict[str, Any] | None:
    percent_match = re.search(r"(?<![\w.])(\d{1,3}(?:\.\d+)?)%", line)
    if not percent_match:
        return None
    result: dict[str, Any] = {"percentage": min(100, round(float(percent_match.group(1))))}
    byte_match = re.search(r"([\d,.]+\s*(?:B|KiB|MiB|GiB|TiB|KB|MB|GB|TB))\s*/\s*([\d,.]+\s*(?:B|KiB|MiB|GiB|TiB|KB|MB|GB|TB))", line, re.IGNORECASE)
    if byte_match:
        result["bytes"] = rclone_size_bytes(byte_match.group(1))
        result["total_bytes"] = rclone_size_bytes(byte_match.group(2))
    count_match = re.search(r"(?:Transferred|Transfers|Checks):\s*(\d+)\s*/\s*(\d+)", line, re.IGNORECASE)
    if count_match:
        result["transfers"] = int(count_match.group(1))
        result["total_transfers"] = int(count_match.group(2))
    return result


def run_tracked(operation_id: str, args: list[str], job_id: str | None = None) -> None:
    with config_use():
        _run_tracked(operation_id, args, job_id)


def _run_tracked(operation_id: str, args: list[str], job_id: str | None = None) -> None:
    with OPERATIONS_LOCK:
        operation = OPERATIONS[operation_id]
        operation["status"] = "running"
        operation["started_at"] = datetime.now(timezone.utc).isoformat()
    command = ["rclone", *args, "--config", str(CONFIG), "--log-level", "ERROR", "--stats", "1s", "--stats-one-line", "--stats-log-level", "ERROR"]
    process = None
    reader = None
    try:
        if CANCEL_EVENTS[operation_id].is_set():
            raise RuntimeError("Operation cancelled")
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, start_new_session=True,
                                   env={**os.environ, "RCLONE_CONFIG": str(CONFIG), "RCLONE_ASK_PASSWORD": "false"})
        diagnostics = deque(maxlen=32)
        def read_progress() -> None:
            if not process.stderr:
                return
            for line in iter(lambda: process.stderr.readline(4096), ""):
                stats = parse_rclone_stats_line(line)
                if stats is None:
                    if line.strip():
                        diagnostics.append(line.strip()[-2000:])
                    continue
                with OPERATIONS_LOCK:
                    operation = OPERATIONS[operation_id]
                    operation.update(stats)
        reader = threading.Thread(target=read_progress, daemon=True)
        reader.start()
        try:
            deadline = time.monotonic() + 7200
            while process.poll() is None:
                if CANCEL_EVENTS[operation_id].wait(.2):
                    kill_process(process)
                    process.wait(timeout=5)
                    raise RuntimeError("Operation cancelled")
                if time.monotonic() > deadline:
                    kill_process(process)
                    process.wait(timeout=5)
                    raise RuntimeError("Operation exceeded the 2-hour limit")
        finally:
            if process.poll() is None:
                kill_process(process)
                process.wait(timeout=5)
        reader.join(timeout=2)
        if process.returncode:
            raise RuntimeError("rclone operation failed; check provider access and available space")
        with OPERATIONS_LOCK:
            OPERATIONS[operation_id].update({"status": "success", "percentage": 100, "message": "Operation completed", "finished_at": datetime.now(timezone.utc).isoformat()})
        if job_id:
            update_job_result(job_id, "success", "Completed successfully")
    except Exception as exc:
        with OPERATIONS_LOCK:
            OPERATIONS[operation_id].update({"status": "failed", "message": str(exc)[-3000:], "finished_at": datetime.now(timezone.utc).isoformat()})
        if job_id:
            update_job_result(job_id, "failed", str(exc)[-4000:])
    finally:
        if process is not None:
            if process.poll() is None:
                kill_process(process)
            process.wait(timeout=5)
            if reader is not None:
                reader.join(timeout=5)
            if process.stderr:
                process.stderr.close()


def update_job_result(job_id: str, status: str, result: str) -> None:
    with LOCK:
        data = state()
        job = next((item for item in data.get("jobs", []) if item.get("id") == job_id), None)
        if job:
            job.update({"status": status, "last_run": datetime.now(timezone.utc).isoformat(), "last_result": result})
            save_state(data)


def start_operations(specs: list[tuple[str, list[str], str | None]]) -> list[dict[str, Any]]:
    with OPERATIONS_LOCK:
        operation_snapshot()
        active = sum(op["status"] in ("queued", "running") for op in OPERATIONS.values())
        if active + len(specs) > MAX_PENDING_OPERATIONS:
            raise HTTPException(429, "Operation queue is full; retry after current work finishes")
        # Keep completed history bounded even under frequent small requests.
        for operation_id in list(OPERATIONS):
            if len(OPERATIONS) + len(specs) <= 512:
                break
            if OPERATIONS[operation_id]["status"] not in ("queued", "running"):
                OPERATIONS.pop(operation_id)
                CANCEL_EVENTS.pop(operation_id, None)
        rows = []
        for label, args, job_id in specs:
            operation_id = uuid.uuid4().hex
            operation = {"id": operation_id, "label": label, "status": "queued", "percentage": None,
                         "bytes": 0, "total_bytes": 0, "transfers": 0, "total_transfers": 0,
                         "speed": 0, "eta": None, "started_at": None, "message": "Queued"}
            OPERATIONS[operation_id] = operation
            CANCEL_EVENTS[operation_id] = threading.Event()
            EXECUTOR.submit(run_tracked, operation_id, args, job_id)
            rows.append(dict(operation))
        return rows


def start_operation(label: str, args: list[str], job_id: str | None = None) -> dict[str, Any]:
    return start_operations([(label, args, job_id)])[0]


@app.post("/api/operations/{operation_id}/cancel")
def cancel_operation(operation_id: str):
    with OPERATIONS_LOCK:
        if operation_id not in CANCEL_EVENTS:
            raise HTTPException(404, "Operation not found")
        CANCEL_EVENTS[operation_id].set()
    return {"cancelled": True}


def scheduler_loop() -> None:
    last_minute = ""
    while not SCHEDULER_STOP.is_set():
        now = datetime.now(timezone.utc)
        minute_key = now.strftime("%Y-%m-%d %H:%M")
        if minute_key != last_minute:
            last_minute = minute_key
            scheduled: list[tuple[dict[str, Any], str, str]] = []
            with LOCK:
                data = state()
                for job in data.get("jobs", []):
                    expression = job.get("cron")
                    if not job.get("schedule_enabled") or not expression or job.get("status") == "running":
                        continue
                    try:
                        due = cron_matches(expression, now)
                    except ValueError:
                        due = False
                    if due and job.get("last_scheduled_minute") != minute_key:
                        try:
                            source_relative = safe_relative(job["source_path"])
                            destination_relative = job_destination_path(
                                source_relative, job["destination_remote"], job["destination_path"]
                            )
                            ensure_separate_locations(job["source_remote"], source_relative, job["destination_remote"], destination_relative)
                            if job["mode"] == "sync" and not job.get("schedule_sync_confirmed"):
                                raise HTTPException(409, "Scheduled sync requires deletion consent")
                            source = remote_path(job["source_remote"], source_relative)
                            destination = remote_path(job["destination_remote"], destination_relative)
                        except HTTPException as exc:
                            job.update({"status": "failed", "last_result": str(exc.detail)[-4000:], "last_scheduled_minute": minute_key})
                            continue
                        job["destination_path"] = destination_relative
                        job["status"] = "running"
                        job["last_run"] = now.isoformat()
                        job["last_scheduled_minute"] = minute_key
                        scheduled.append((dict(job), source, destination))
                save_state(data)
            for job, source, destination in scheduled:
                try:
                    start_operation(f"Scheduled job: {job['name']}", [job["mode"], source, destination, "--create-empty-src-dirs"], job["id"])
                except HTTPException as exc:
                    update_job_result(job["id"], "failed", str(exc.detail))
        SCHEDULER_STOP.wait(5)


@app.on_event("startup")
def start_scheduler() -> None:
    global SCHEDULER_STARTED
    if not SCHEDULER_STARTED and os.environ.get("APP_DISABLE_SCHEDULER") != "1":
        SCHEDULER_STARTED = True
        with LOCK:
            data = state()
            changed = False
            for job in data.get("jobs", []):
                if job.get("status") == "running":
                    job.update({"status": "failed", "last_result": "Operation interrupted by an application restart."})
                    changed = True
            if changed:
                save_state(data)
        threading.Thread(target=scheduler_loop, daemon=True).start()


@app.on_event("shutdown")
def stop_operations() -> None:
    SCHEDULER_STOP.set()
    with OPERATIONS_LOCK:
        for event in CANCEL_EVENTS.values():
            event.set()
    EXECUTOR.shutdown(wait=True)


@app.get("/api/health")
def health():
    return {"status": "ok", "rclone": run_rclone(["version"]).splitlines()[0]}


@app.get("/api/providers")
def providers():
    try:
        raw = run_rclone(["config", "providers"], timeout=30)
        data = json.loads(raw)
        if isinstance(data, dict):
            data = data.get("Providers", data.get("providers", []))
        return {"providers": data if isinstance(data, list) else []}
    except (HTTPException, json.JSONDecodeError):
        # rclone builds differ in provider JSON support; keep local setup available.
        return {"providers": [{"Name": "local", "Description": "Local filesystem"}]}


def password_options_for(backend_type: str) -> set[str]:
    """Return provider options that rclone expects to be obscured in config."""
    try:
        data = json.loads(run_rclone(["config", "providers"], timeout=30))
    except (HTTPException, json.JSONDecodeError) as exc:
        raise HTTPException(500, "Could not load rclone provider options") from exc
    if isinstance(data, dict):
        data = data.get("Providers", data.get("providers", []))
    if not isinstance(data, list):
        raise HTTPException(500, "rclone returned an invalid provider catalog")
    provider = next((item for item in data if item.get("Name") == backend_type), None)
    if provider is None:
        return set()
    return {
        option["Name"]
        for option in provider.get("Options", [])
        if option.get("Name") and option.get("IsPassword")
    }


def obscure_password(value: str) -> str:
    try:
        result = subprocess.run(
            ["rclone", "obscure", "-"],
            capture_output=True,
            text=True,
            input=value,
            timeout=10,
            check=False,
            env={**os.environ, "RCLONE_ASK_PASSWORD": "false"},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(500, "Could not obscure remote password") from exc
    if result.returncode:
        # Do not include subprocess output here: it may contain the credential.
        raise HTTPException(500, "Could not obscure remote password")
    return result.stdout.strip()


def password_is_obscured(value: str) -> bool:
    try:
        result = subprocess.run(
            ["rclone", "reveal", "--", value],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
            env={**os.environ, "RCLONE_ASK_PASSWORD": "false"},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(500, "Could not inspect remote password format") from exc
    return result.returncode == 0


def normalize_config_passwords(content: str, parser: configparser.ConfigParser) -> str:
    password_options: dict[str, set[str]] = {}
    for section in parser.sections():
        backend_type = parser[section].get("type", "")
        if backend_type and backend_type not in password_options:
            password_options[backend_type] = password_options_for(backend_type)

    lines = content.splitlines(keepends=True)
    section = ""
    normalized: list[str] = []
    section_pattern = re.compile(r"^\s*\[([^\]]+)\]\s*(?:[#;].*)?(?:\r?\n)?$")
    option_pattern = re.compile(r"^(\s*)([^#;][^=:]*?)(\s*[=:]\s*)(.*?)(\r?\n)?$")
    for line in lines:
        section_match = section_pattern.match(line)
        if section_match:
            section = section_match.group(1)
            normalized.append(line)
            continue

        option_match = option_pattern.match(line)
        if not option_match or not section or not parser.has_section(section):
            normalized.append(line)
            continue
        key = option_match.group(2).strip()
        raw_value = option_match.group(4).strip()
        backend_type = parser[section].get("type", "")
        if key not in password_options.get(backend_type, set()) or not raw_value:
            normalized.append(line)
            continue
        if "\n" in parser[section].get(key, ""):
            raise HTTPException(400, f"Password option '{key}' must be on a single line")
        value = raw_value if password_is_obscured(raw_value) else obscure_password(raw_value)
        newline = option_match.group(5) or ""
        normalized.append(f"{option_match.group(1)}{option_match.group(2)}{option_match.group(3)}{value}{newline}")
    return "".join(normalized)


@app.get("/api/remotes")
def remotes():
    parser = parsed_config()
    roots = state().get("local_roots", {})
    return [{"name": name, "type": section.get("type", ""), "test": name in roots,
             "bucket_supported": section.get("type", "").lower() in BUCKET_BACKENDS}
            for name, section in parser.items() if name != "DEFAULT"]


@app.post("/api/remotes")
@locked
def create_remote(item: RemoteInput):
    name = safe_remote(item.name)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_. -]{0,63}", item.type):
        raise HTTPException(400, "Invalid backend type")
    with LOCK:
        require_config_idle()
        parser = parsed_config()
        existing = parser[name] if parser.has_section(name) and parser[name].get("type") == item.type else {}
        parser[name] = dict(existing)
        parser[name]["type"] = item.type
        password_options = password_options_for(item.type) if item.options else set()
        for key, value in item.options.items():
            if not re.fullmatch(r"[A-Za-z0-9_.-]+", key) or "\n" in value or "\r" in value:
                raise HTTPException(400, "Invalid option")
            if value:
                parser[name][key] = obscure_password(value) if key in password_options else value
        if item.test_root:
            if item.type != "local":
                raise HTTPException(400, "Only the local backend can be a confined test remote")
            root = (TEST_ROOT / name).resolve()
            if not root.is_relative_to(TEST_ROOT):
                raise HTTPException(400, "Invalid test remote root")
            root.mkdir(parents=True, exist_ok=True)
            values = state()
            values.setdefault("local_roots", {})[name] = str(root)
            save_state(values)
        else:
            values = state()
            values.get("local_roots", {}).pop(name, None)
            save_state(values)
        stream = io.StringIO()
        parser.write(stream)
        secure_write(CONFIG, stream.getvalue())
    return {"name": name, "type": item.type}


@app.get("/api/config")
@locked
def get_config():
    return {"content": CONFIG.read_text(encoding="utf-8")}


@app.put("/api/config")
@locked
def put_config(item: ConfigInput):
    if len(item.content.encode("utf-8")) > 1024 * 1024:
        raise HTTPException(413, "Config file exceeds 1 MiB")
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.optionxform = str
    try:
        parser.read_string(item.content)
    except configparser.Error as exc:
        raise HTTPException(400, f"Invalid INI config: {exc}") from exc
    for section in parser.sections():
        safe_remote(section)
        if not parser[section].get("type"):
            raise HTTPException(400, f"Remote '{section}' is missing its type")
    content = normalize_config_passwords(item.content, parser)
    with LOCK:
        require_config_idle()
        secure_write(CONFIG, content)
    return {"saved": True, "remotes": len(parser.sections())}


@app.get("/api/browse/{remote}")
def browse(remote: str, path: str = ""):
    target = remote_path(remote, path)
    result = run_rclone(["lsjson", target, "--dirs-only=false", "--hash=false"])
    try:
        entries = json.loads(result)
    except json.JSONDecodeError as exc:
        raise HTTPException(500, "rclone returned invalid listing data") from exc
    return {"remote": remote, "path": safe_relative(path), "entries": [
        {"name": e.get("Name", ""), "is_dir": bool(e.get("IsDir")), "size": e.get("Size", 0),
         "mod_time": e.get("ModTime", ""), "path": "/".join(filter(None, [safe_relative(path), e.get("Name", "")]))}
        for e in entries
    ]}


@app.post("/api/buckets/{remote}")
def create_bucket(remote: str, item: BucketInput):
    safe_remote(remote)
    name = item.name.strip()
    if not name or name in (".", "..") or not re.fullmatch(r"[^/:\\\x00-\x20\x7f]+", name):
        raise HTTPException(400, "Enter a valid bucket name without slashes or control characters.")

    config = parsed_config()
    if not config.has_section(remote):
        raise HTTPException(404, f"Remote '{remote}' does not exist")
    backend_type = config[remote].get("type", "").lower()
    if backend_type not in BUCKET_BACKENDS:
        raise HTTPException(400, f"Bucket creation is not supported for backend '{backend_type}'.")
    if remote in state().get("local_roots", {}):
        raise HTTPException(400, "Bucket creation is not available for local test remotes.")

    target = remote_path(remote, name)
    run_rclone(["mkdir", target], timeout=120)
    return {"remote": remote, "name": name, "created": True}


@app.post("/api/transfer")
@locked
def transfer(item: TransferInput):
    if item.mode not in ("move", "copy"):
        raise HTTPException(400, "Mode must be move or copy")
    src = remote_path(item.source_remote, item.source_path)
    dst = remote_path(item.destination_remote, item.destination_path)
    ensure_separate_locations(item.source_remote, item.source_path, item.destination_remote, item.destination_path)
    command = "moveto" if item.mode == "move" else "copyto"
    return start_operation(f"{item.mode.title()}: {item.source_path}", [command, src, dst])


@app.get("/api/operations")
def operations():
    return operation_snapshot()


class DownloadResponse(FileResponse):
    """Always release the spool and admission slot, including disconnected clients."""

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            Path(self.path).unlink(missing_ok=True)
            DOWNLOAD_SLOTS.release()


def copy_remote_to_stream(target: str, output, budget: int, deadline: float) -> int:
    diagnostics = deque(maxlen=16)
    with config_use():
        process = subprocess.Popen(
            ["rclone", "cat", target, "--config", str(CONFIG), "--log-level", "ERROR"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
            env={**os.environ, "RCLONE_CONFIG": str(CONFIG), "RCLONE_ASK_PASSWORD": "false"},
        )
        expired = threading.Event()

        def terminate():
            expired.set()
            if process.poll() is None:
                kill_process(process)

        timer = threading.Timer(max(.01, deadline - time.monotonic()), terminate)
        timer.daemon = True
        timer.start()

        def drain_errors():
            for chunk in iter(lambda: process.stderr.read(2048), b""):
                diagnostics.append(chunk)

        reader = threading.Thread(target=drain_errors, daemon=True)
        reader.start()
        total = 0
        try:
            while chunk := process.stdout.read(256 * 1024):
                if expired.is_set():
                    raise HTTPException(504, "Download exceeded the 5-minute limit")
                total += len(chunk)
                if total > budget:
                    raise HTTPException(413, "Downloads are limited to 1 GiB in total")
                if shutil.disk_usage(DOWNLOAD_ROOT).free < len(chunk) + 64 * 1024 * 1024:
                    raise HTTPException(507, "Insufficient temporary disk space")
                output.write(chunk)
            process.wait(timeout=5)
            if expired.is_set():
                raise HTTPException(504, "Download exceeded the 5-minute limit")
            if process.returncode:
                raise HTTPException(400, "Could not download remote file; check provider access")
            return total
        finally:
            timer.cancel()
            if process.poll() is None:
                kill_process(process)
            process.wait(timeout=5)
            reader.join(timeout=5)
            process.stdout.close()
            process.stderr.close()


def prepare_download(remote: str, paths: list[str], archive: bool):
    safe_remote(remote)
    relative_paths = list(dict.fromkeys(safe_relative(path) for path in paths))
    if any(not path for path in relative_paths):
        raise HTTPException(400, "A file path is required")
    if not DOWNLOAD_SLOTS.acquire(blocking=False):
        raise HTTPException(429, "Two downloads are already active; retry later")
    spool = None
    try:
        descriptor, filename = tempfile.mkstemp(prefix="download-", suffix=".zip" if archive else ".bin", dir=DOWNLOAD_ROOT)
        os.close(descriptor)
        spool = Path(filename)
        deadline = time.monotonic() + DOWNLOAD_TIMEOUT
        remaining = MAX_DOWNLOAD_BYTES
        files = []
        for path in relative_paths:
            if time.monotonic() >= deadline:
                raise HTTPException(504, "Download exceeded the 5-minute limit")
            target = remote_path(remote, path)
            try:
                metadata = json.loads(run_rclone(["lsjson", target, "--stat", "--hash=false"], timeout=max(1, int(deadline - time.monotonic()))))
            except json.JSONDecodeError as exc:
                raise HTTPException(500, "rclone returned invalid file metadata") from exc
            if metadata.get("IsDir"):
                if archive:
                    continue
                raise HTTPException(400, "Select a file to download")
            size = metadata.get("Size", -1)
            if size >= 0:
                remaining -= size
                if remaining < 0:
                    raise HTTPException(413, "Downloads are limited to 1 GiB in total")
            files.append((path, target))
        if not files:
            raise HTTPException(400, "Select at least one file to download")
        total = 0
        if archive:
            with zipfile.ZipFile(spool, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as output:
                for path, target in files:
                    # Retaining paths prevents duplicate basenames in the ZIP.
                    with output.open(path, "w") as member:
                        total += copy_remote_to_stream(target, member, MAX_DOWNLOAD_BYTES - total, deadline)
        else:
            with spool.open("wb") as output:
                copy_remote_to_stream(files[0][1], output, MAX_DOWNLOAD_BYTES, deadline)
        return DownloadResponse(spool, media_type="application/zip" if archive else "application/octet-stream",
                                filename=f"{remote}-files.zip" if archive else relative_paths[0].rsplit("/", 1)[-1])
    except BaseException:
        if spool:
            spool.unlink(missing_ok=True)
        DOWNLOAD_SLOTS.release()
        raise


@app.get("/api/download/{remote}")
def download(remote: str, path: str):
    return prepare_download(remote, [path], False)


@app.post("/api/download/{remote}/archive")
def download_archive(remote: str, item: DownloadSelectionInput):
    return prepare_download(remote, item.paths, True)


@app.post("/api/delete/{remote}")
def delete_items(remote: str, item: DeleteSelectionInput):
    safe_remote(remote)
    if not item.paths or len(item.paths) > 200:
        raise HTTPException(400, "Select between 1 and 200 items")
    paths = list(dict.fromkeys(safe_relative(path) for path in item.paths))
    if any(not path for path in paths):
        raise HTTPException(400, "The remote root cannot be deleted")
    targets: list[tuple[str, str, str]] = []
    for path in paths:
        target = remote_path(remote, path)
        try:
            metadata = json.loads(run_rclone(["lsjson", target, "--stat", "--hash=false"]))
        except json.JSONDecodeError as exc:
            raise HTTPException(500, "rclone returned invalid item metadata") from exc
        command = "purge" if metadata.get("IsDir") else "deletefile"
        targets.append((path, target, command))
    return {"operations": start_operations([(f"Delete: {Path(path).name}", [command, target], None)
                                            for path, target, command in targets])}


@app.get("/api/jobs")
def jobs():
    rows = state().get("jobs", [])
    for job in rows:
        if job.get("schedule_enabled") and job.get("cron"):
            try:
                job["next_run"] = next_cron_run(job["cron"])
            except ValueError:
                job["next_run"] = None
    return rows


@app.get("/api/cron/preview")
def cron_preview(expression: str):
    try:
        validate_cron(expression)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, f"Invalid cron expression: {exc}") from exc
    return {"next_run": next_cron_run(expression)}


@app.post("/api/jobs")
@locked
def create_job(item: JobInput):
    if item.mode not in ("copy", "sync"):
        raise HTTPException(400, "Mode must be copy or sync")
    if item.schedule_enabled and not item.cron:
        raise HTTPException(400, "A cron expression is required to enable scheduling")
    if item.schedule_enabled and item.mode == "sync" and not item.schedule_sync_confirmed:
        raise HTTPException(400, "Confirm scheduled sync runs because they can delete destination-only files")
    if item.cron:
        try:
            validate_cron(item.cron)
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, f"Invalid cron expression: {exc}") from exc
    safe_remote(item.source_remote); safe_remote(item.destination_remote)
    source_relative = safe_relative(item.source_path)
    destination_relative = job_destination_path(source_relative, item.destination_remote, item.destination_path)
    remote_path(item.source_remote, source_relative)
    remote_path(item.destination_remote, destination_relative)
    ensure_separate_locations(item.source_remote, source_relative, item.destination_remote, destination_relative)
    value = {"id": uuid.uuid4().hex[:12], "name": item.name.strip() or "Untitled job",
             "source_remote": item.source_remote, "source_path": source_relative,
             "destination_remote": item.destination_remote, "destination_path": destination_relative,
             "mode": item.mode, "status": "ready", "last_run": None, "last_result": None,
             "cron": item.cron.strip() if item.cron else None, "schedule_enabled": item.schedule_enabled,
             "schedule_sync_confirmed": item.schedule_sync_confirmed}
    data = state(); data.setdefault("jobs", []).insert(0, value); save_state(data)
    return value


@app.put("/api/jobs/{job_id}")
@locked
def update_job(job_id: str, item: JobInput):
    data = state()
    job = next((x for x in data.get("jobs", []) if x["id"] == job_id), None)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("status") == "running":
        raise HTTPException(409, "A running job cannot be edited")
    if item.mode not in ("copy", "sync"):
        raise HTTPException(400, "Mode must be copy or sync")
    if item.schedule_enabled and not item.cron:
        raise HTTPException(400, "A cron expression is required to enable scheduling")
    if item.schedule_enabled and item.mode == "sync" and not item.schedule_sync_confirmed:
        raise HTTPException(400, "Confirm scheduled sync runs because they can delete destination-only files")
    if item.cron:
        try:
            validate_cron(item.cron)
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, f"Invalid cron expression: {exc}") from exc
    safe_remote(item.source_remote); safe_remote(item.destination_remote)
    source_relative = safe_relative(item.source_path)
    destination_relative = job_destination_path(source_relative, item.destination_remote, item.destination_path)
    remote_path(item.source_remote, source_relative)
    remote_path(item.destination_remote, destination_relative)
    ensure_separate_locations(item.source_remote, source_relative, item.destination_remote, destination_relative)
    job.update({"name": item.name.strip() or "Untitled job", "source_remote": item.source_remote,
                "source_path": source_relative, "destination_remote": item.destination_remote,
                "destination_path": destination_relative, "mode": item.mode,
                "cron": item.cron.strip() if item.cron else None, "schedule_enabled": item.schedule_enabled,
                "schedule_sync_confirmed": item.schedule_sync_confirmed})
    save_state(data)
    return job


@app.delete("/api/jobs/{job_id}")
@locked
def delete_job(job_id: str):
    data = state()
    job = next((x for x in data.get("jobs", []) if x["id"] == job_id), None)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("status") == "running":
        raise HTTPException(409, "A running job cannot be deleted")
    data["jobs"] = [item for item in data.get("jobs", []) if item["id"] != job_id]
    save_state(data)
    return {"deleted": True, "id": job_id}


@app.post("/api/jobs/{job_id}/run")
@locked
def run_job(job_id: str, item: RunInput):
    data = state()
    job = next((x for x in data.get("jobs", []) if x["id"] == job_id), None)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["mode"] == "sync" and not item.confirm_sync_deletions:
        raise HTTPException(409, "Sync makes the destination identical and may delete destination-only files. Confirm to continue.")
    if job.get("status") == "running":
        raise HTTPException(409, "Job is already running")
    source_relative = safe_relative(job["source_path"])
    destination_relative = job_destination_path(source_relative, job["destination_remote"], job["destination_path"])
    ensure_separate_locations(job["source_remote"], source_relative, job["destination_remote"], destination_relative)
    source = remote_path(job["source_remote"], source_relative)
    destination = remote_path(job["destination_remote"], destination_relative)
    with LOCK:
        data = state()
        job = next((x for x in data.get("jobs", []) if x["id"] == job_id), job)
        job["destination_path"] = destination_relative
        job["status"] = "running"; job["last_run"] = datetime.now(timezone.utc).isoformat(); save_state(data)
    try:
        operation = start_operation(f"Job: {job['name']}", [job["mode"], source, destination, "--create-empty-src-dirs"], job_id)
    except HTTPException as exc:
        update_job_result(job_id, "failed", str(exc.detail))
        raise
    return {**job, "operation_id": operation["id"]}


FRONTEND = Path(os.environ.get("FRONTEND_DIST", "/app/frontend/dist"))
if FRONTEND.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        candidate = FRONTEND / path
        if path and candidate.is_file() and candidate.resolve().is_relative_to(FRONTEND.resolve()):
            return FileResponse(candidate)
        return FileResponse(FRONTEND / "index.html")
