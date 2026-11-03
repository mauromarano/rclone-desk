from __future__ import annotations

import configparser
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
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

DATA = Path(os.environ.get("APP_DATA", "/data")).resolve()
TEST_ROOT = (DATA / "test-remotes").resolve()
CONFIG = DATA / "rclone.conf"
STATE = DATA / "state.json"
LOCK = threading.RLock()
OPERATIONS: dict[str, dict[str, Any]] = {}
OPERATIONS_LOCK = threading.RLock()
SCHEDULER_STARTED = False
DATA.mkdir(parents=True, exist_ok=True)
TEST_ROOT.mkdir(parents=True, exist_ok=True)

if not CONFIG.exists():
    CONFIG.write_text("", encoding="utf-8")
if not STATE.exists():
    STATE.write_text(json.dumps({"local_roots": {}, "jobs": []}), encoding="utf-8")

app = FastAPI(title="Rclone Desk")

BUCKET_BACKENDS = {"s3", "b2", "google cloud storage", "azureblob", "swift", "storj"}


def state() -> dict[str, Any]:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"local_roots": {}, "jobs": []}


def save_state(value: dict[str, Any]) -> None:
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2), encoding="utf-8")
    temp.replace(STATE)


def run_rclone(args: list[str], timeout: int = 3600) -> str:
    try:
        result = subprocess.run(
            ["rclone", *args, "--config", str(CONFIG), "--log-level", "ERROR"],
            capture_output=True, text=True, timeout=timeout, check=False,
            env={**os.environ, "RCLONE_CONFIG": str(CONFIG), "RCLONE_ASK_PASSWORD": "false"},
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "rclone operation timed out") from exc
    except OSError as exc:
        raise HTTPException(500, f"Could not start rclone: {exc}") from exc
    if result.returncode:
        message = (result.stderr or result.stdout or "rclone failed").strip()
        raise HTTPException(400, message[-3000:])
    return result.stdout


def parsed_config() -> configparser.ConfigParser:
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.optionxform = str
    try:
        parser.read(CONFIG, encoding="utf-8")
    except configparser.Error as exc:
        raise HTTPException(400, f"Invalid rclone config: {exc}") from exc
    return parser


def safe_remote(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", name):
        raise HTTPException(400, "Remote name may contain letters, numbers, dot, underscore and dash")
    return name


def safe_relative(path: str) -> str:
    value = path.strip().replace("\\", "/")
    if value.startswith("/") or "\x00" in value:
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
    meta = state().get("local_roots", {}).get(remote)
    if meta:
        root = Path(meta).resolve()
        if not root.is_relative_to(TEST_ROOT):
            raise HTTPException(400, "Configured test remote root is outside test storage")
        target = (root / rel).resolve()
        if not target.is_relative_to(root):
            raise HTTPException(400, "Path escapes the test remote root")
        return str(target)
    return f"{remote}:{rel}" if rel else f"{remote}:"


def job_destination_path(source_path: str, destination_remote: str, destination_path: str) -> str:
    destination = safe_relative(destination_path)
    if destination:
        return destination
    config = parsed_config()
    if config.has_section(destination_remote) and config[destination_remote].get("type", "").lower() == "s3":
        source = safe_relative(source_path)
        bucket_name = source.rsplit("/", 1)[-1]
        if not bucket_name:
            raise HTTPException(400, "Per copiare nella radice di un remote S3, seleziona una cartella sorgente con nome oppure scegli un bucket di destinazione.")
        return bucket_name
    return destination


class RemoteInput(BaseModel):
    name: str
    type: str
    options: dict[str, str] = Field(default_factory=dict)
    test_root: bool = False


class ConfigInput(BaseModel):
    content: str


class TransferInput(BaseModel):
    source_remote: str
    source_path: str = ""
    destination_remote: str
    destination_path: str = ""
    mode: str = "move"


class JobInput(BaseModel):
    name: str
    source_remote: str
    source_path: str = ""
    destination_remote: str
    destination_path: str = ""
    mode: str = "copy"
    cron: str | None = None
    schedule_enabled: bool = False
    schedule_sync_confirmed: bool = False


class RunInput(BaseModel):
    confirm_sync_deletions: bool = False


class DownloadSelectionInput(BaseModel):
    paths: list[str]


class DeleteSelectionInput(BaseModel):
    paths: list[str]


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
    now = after or datetime.now().astimezone()
    fields = expression.split()
    minute, hour, day, month, weekday = validate_cron(expression)
    candidate = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(60 * 24 * 366 * 5):
        if _cron_fields_match(fields, minute, hour, day, month, weekday, candidate):
            return candidate.isoformat()
        candidate += timedelta(minutes=1)
    return None


def operation_snapshot() -> list[dict[str, Any]]:
    with OPERATIONS_LOCK:
        cutoff = datetime.now(timezone.utc).timestamp() - 1800
        for operation_id, operation in list(OPERATIONS.items()):
            finished = operation.get("finished_at")
            if finished and datetime.fromisoformat(finished).timestamp() < cutoff:
                del OPERATIONS[operation_id]
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
    with OPERATIONS_LOCK:
        operation = OPERATIONS[operation_id]
        operation["status"] = "running"
        operation["started_at"] = datetime.now(timezone.utc).isoformat()
    command = ["rclone", *args, "--config", str(CONFIG), "--log-level", "ERROR", "--stats", "1s", "--stats-one-line", "--stats-log-level", "ERROR"]
    try:
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
                                   env={**os.environ, "RCLONE_CONFIG": str(CONFIG), "RCLONE_ASK_PASSWORD": "false"})
        diagnostics: list[str] = []
        def read_progress() -> None:
            if not process.stderr:
                return
            for line in process.stderr:
                stats = parse_rclone_stats_line(line)
                if stats is None:
                    if line.strip():
                        diagnostics.append(line.strip())
                    continue
                with OPERATIONS_LOCK:
                    operation = OPERATIONS[operation_id]
                    operation.update(stats)
        reader = threading.Thread(target=read_progress, daemon=True)
        reader.start()
        try:
            process.wait(timeout=7200)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise RuntimeError("L’operazione ha superato il limite di 2 ore")
        reader.join(timeout=2)
        if process.returncode:
            raise RuntimeError(("\n".join(diagnostics) or "rclone operation failed")[-3000:])
        with OPERATIONS_LOCK:
            OPERATIONS[operation_id].update({"status": "success", "percentage": 100, "message": "Operazione completata", "finished_at": datetime.now(timezone.utc).isoformat()})
        if job_id:
            update_job_result(job_id, "success", "Completed successfully")
    except Exception as exc:
        with OPERATIONS_LOCK:
            OPERATIONS[operation_id].update({"status": "failed", "message": str(exc)[-3000:], "finished_at": datetime.now(timezone.utc).isoformat()})
        if job_id:
            update_job_result(job_id, "failed", str(exc)[-4000:])


def update_job_result(job_id: str, status: str, result: str) -> None:
    with LOCK:
        data = state()
        job = next((item for item in data.get("jobs", []) if item.get("id") == job_id), None)
        if job:
            job.update({"status": status, "last_run": datetime.now(timezone.utc).isoformat(), "last_result": result})
            save_state(data)


def start_operation(label: str, args: list[str], job_id: str | None = None) -> dict[str, Any]:
    operation_id = uuid.uuid4().hex[:12]
    operation = {"id": operation_id, "label": label, "status": "queued", "percentage": None,
                 "bytes": 0, "total_bytes": 0, "transfers": 0, "total_transfers": 0,
                 "speed": 0, "eta": None, "started_at": None, "message": "In attesa"}
    with OPERATIONS_LOCK:
        OPERATIONS[operation_id] = operation
    threading.Thread(target=run_tracked, args=(operation_id, args, job_id), daemon=True).start()
    return dict(operation)


def scheduler_loop() -> None:
    last_minute = ""
    while True:
        now = datetime.now().astimezone()
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
                            if job["source_remote"] == job["destination_remote"] and source_relative == destination_relative:
                                raise HTTPException(400, "Source and destination must differ")
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
                start_operation(f"Job programmato: {job['name']}", [job["mode"], source, destination, "--create-empty-src-dirs"], job["id"])
        time.sleep(5)


@app.on_event("startup")
def start_scheduler() -> None:
    global SCHEDULER_STARTED
    if not SCHEDULER_STARTED:
        SCHEDULER_STARTED = True
        with LOCK:
            data = state()
            changed = False
            for job in data.get("jobs", []):
                if job.get("status") == "running":
                    job.update({"status": "failed", "last_result": "Operazione interrotta dal riavvio dell’app."})
                    changed = True
            if changed:
                save_state(data)
        threading.Thread(target=scheduler_loop, daemon=True).start()


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
def create_remote(item: RemoteInput):
    name = safe_remote(item.name)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", item.type):
        raise HTTPException(400, "Invalid backend type")
    with LOCK:
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
        with CONFIG.open("w", encoding="utf-8") as stream:
            parser.write(stream)
    return {"name": name, "type": item.type}


@app.get("/api/config")
def get_config():
    return {"content": CONFIG.read_text(encoding="utf-8")}


@app.put("/api/config")
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
        CONFIG.write_text(content, encoding="utf-8")
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
        raise HTTPException(400, "Inserisci un nome bucket valido, senza slash o caratteri di controllo.")

    config = parsed_config()
    if not config.has_section(remote):
        raise HTTPException(404, f"Remote '{remote}' non esiste")
    backend_type = config[remote].get("type", "").lower()
    if backend_type not in BUCKET_BACKENDS:
        raise HTTPException(400, f"La creazione di bucket non è supportata per il backend '{backend_type}'.")
    if remote in state().get("local_roots", {}):
        raise HTTPException(400, "La creazione di bucket non è disponibile sui remote locali di test.")

    target = remote_path(remote, name)
    run_rclone(["mkdir", target], timeout=120)
    return {"remote": remote, "name": name, "created": True}


@app.post("/api/transfer")
def transfer(item: TransferInput):
    if item.mode not in ("move", "copy"):
        raise HTTPException(400, "Mode must be move or copy")
    src = remote_path(item.source_remote, item.source_path)
    dst = remote_path(item.destination_remote, item.destination_path)
    if src == dst:
        raise HTTPException(400, "Source and destination are the same")
    command = "moveto" if item.mode == "move" else "copyto"
    return start_operation(f"{item.mode.title()}: {item.source_path}", [command, src, dst])


@app.get("/api/operations")
def operations():
    return operation_snapshot()


@app.get("/api/download/{remote}")
def download(remote: str, path: str):
    target = remote_path(remote, path)
    filename = safe_relative(path).rsplit("/", 1)[-1]
    if not filename:
        raise HTTPException(400, "A file path is required")
    try:
        metadata = json.loads(run_rclone(["lsjson", target, "--stat", "--hash=false"]))
    except json.JSONDecodeError as exc:
        raise HTTPException(500, "rclone returned invalid file metadata") from exc
    if metadata.get("IsDir"):
        raise HTTPException(400, "Select a file to download")
    try:
        process = subprocess.Popen(["rclone", "cat", target, "--config", str(CONFIG), "--log-level", "ERROR"],
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env={**os.environ, "RCLONE_CONFIG": str(CONFIG), "RCLONE_ASK_PASSWORD": "false"})
    except OSError as exc:
        raise HTTPException(500, f"Could not start rclone: {exc}") from exc

    def stream_file():
        try:
            while chunk := process.stdout.read(1024 * 256):
                yield chunk
        finally:
            process.stdout.close()
            process.wait()

    return StreamingResponse(stream_file(), media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})


@app.post("/api/download/{remote}/archive")
def download_archive(remote: str, item: DownloadSelectionInput):
    safe_remote(remote)
    if not item.paths or len(item.paths) > 200:
        raise HTTPException(400, "Select between 1 and 200 files")
    paths = list(dict.fromkeys(safe_relative(path) for path in item.paths))
    temp = tempfile.NamedTemporaryFile(prefix="rclone-download-", suffix=".zip", dir=DATA, delete=False)
    archive_path = Path(temp.name)
    temp.close()
    try:
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for path in paths:
                target = remote_path(remote, path)
                try:
                    metadata = json.loads(run_rclone(["lsjson", target, "--stat", "--hash=false"]))
                except json.JSONDecodeError as exc:
                    raise HTTPException(500, "rclone returned invalid file metadata") from exc
                if metadata.get("IsDir"):
                    continue
                process = subprocess.Popen(["rclone", "cat", target, "--config", str(CONFIG), "--log-level", "ERROR"],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           env={**os.environ, "RCLONE_CONFIG": str(CONFIG), "RCLONE_ASK_PASSWORD": "false"})
                with archive.open(Path(path).name, "w") as target_file:
                    while chunk := process.stdout.read(1024 * 256):
                        target_file.write(chunk)
                _, error = process.communicate()
                if process.returncode:
                    raise HTTPException(400, (error or b"Could not download selected file").decode("utf-8", "replace")[-2000:])
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise
    return FileResponse(archive_path, media_type="application/zip", filename=f"{remote}-files.zip",
                        background=BackgroundTask(archive_path.unlink, missing_ok=True))


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
    return {"operations": [start_operation(f"Elimina: {Path(path).name}", [command, target])
                           for path, target, command in targets]}


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
        raise HTTPException(400, f"Espressione cron non valida: {exc}") from exc
    return {"next_run": next_cron_run(expression)}


@app.post("/api/jobs")
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
    if item.source_remote == item.destination_remote and source_relative == destination_relative:
        raise HTTPException(400, "Source and destination must differ")
    value = {"id": uuid.uuid4().hex[:12], "name": item.name.strip() or "Untitled job",
             "source_remote": item.source_remote, "source_path": source_relative,
             "destination_remote": item.destination_remote, "destination_path": destination_relative,
             "mode": item.mode, "status": "ready", "last_run": None, "last_result": None,
             "cron": item.cron.strip() if item.cron else None, "schedule_enabled": item.schedule_enabled,
             "schedule_sync_confirmed": item.schedule_sync_confirmed}
    data = state(); data.setdefault("jobs", []).insert(0, value); save_state(data)
    return value


@app.put("/api/jobs/{job_id}")
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
    if item.source_remote == item.destination_remote and source_relative == destination_relative:
        raise HTTPException(400, "Source and destination must differ")
    job.update({"name": item.name.strip() or "Untitled job", "source_remote": item.source_remote,
                "source_path": source_relative, "destination_remote": item.destination_remote,
                "destination_path": destination_relative, "mode": item.mode,
                "cron": item.cron.strip() if item.cron else None, "schedule_enabled": item.schedule_enabled,
                "schedule_sync_confirmed": item.schedule_sync_confirmed})
    save_state(data)
    return job


@app.delete("/api/jobs/{job_id}")
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
    if job["source_remote"] == job["destination_remote"] and source_relative == destination_relative:
        raise HTTPException(400, "Source and destination must differ")
    source = remote_path(job["source_remote"], source_relative)
    destination = remote_path(job["destination_remote"], destination_relative)
    with LOCK:
        data = state()
        job = next((x for x in data.get("jobs", []) if x["id"] == job_id), job)
        job["destination_path"] = destination_relative
        job["status"] = "running"; job["last_run"] = datetime.now(timezone.utc).isoformat(); save_state(data)
    operation = start_operation(f"Job: {job['name']}", [job["mode"], source, destination, "--create-empty-src-dirs"], job_id)
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
