from __future__ import annotations

import configparser
import json
import os
import re
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DATA = Path(os.environ.get("APP_DATA", "/data")).resolve()
TEST_ROOT = (DATA / "test-remotes").resolve()
CONFIG = DATA / "rclone.conf"
STATE = DATA / "state.json"
LOCK = threading.RLock()
DATA.mkdir(parents=True, exist_ok=True)
TEST_ROOT.mkdir(parents=True, exist_ok=True)

if not CONFIG.exists():
    CONFIG.write_text("", encoding="utf-8")
if not STATE.exists():
    STATE.write_text(json.dumps({"local_roots": {}, "jobs": []}), encoding="utf-8")

app = FastAPI(title="Rclone Desk")


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


class RunInput(BaseModel):
    confirm_sync_deletions: bool = False


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


@app.get("/api/remotes")
def remotes():
    parser = parsed_config()
    roots = state().get("local_roots", {})
    return [{"name": name, "type": section.get("type", ""), "test": name in roots}
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
        for key, value in item.options.items():
            if not re.fullmatch(r"[A-Za-z0-9_.-]+", key) or "\n" in value or "\r" in value:
                raise HTTPException(400, "Invalid option")
            if value:
                parser[name][key] = value
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
    with LOCK:
        CONFIG.write_text(item.content, encoding="utf-8")
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


@app.post("/api/transfer")
def transfer(item: TransferInput):
    if item.mode not in ("move", "copy"):
        raise HTTPException(400, "Mode must be move or copy")
    src = remote_path(item.source_remote, item.source_path)
    dst = remote_path(item.destination_remote, item.destination_path)
    if src == dst:
        raise HTTPException(400, "Source and destination are the same")
    command = "moveto" if item.mode == "move" else "copyto"
    run_rclone([command, src, dst], timeout=3600)
    return {"transferred": True, "mode": item.mode, "source": item.source_path, "destination": item.destination_path}


@app.get("/api/jobs")
def jobs():
    return state().get("jobs", [])


@app.post("/api/jobs")
def create_job(item: JobInput):
    if item.mode not in ("copy", "sync"):
        raise HTTPException(400, "Mode must be copy or sync")
    safe_remote(item.source_remote); safe_remote(item.destination_remote)
    remote_path(item.source_remote, item.source_path)
    remote_path(item.destination_remote, item.destination_path)
    if item.source_remote == item.destination_remote and item.source_path == item.destination_path:
        raise HTTPException(400, "Source and destination must differ")
    value = {"id": uuid.uuid4().hex[:12], "name": item.name.strip() or "Untitled job",
             "source_remote": item.source_remote, "source_path": safe_relative(item.source_path),
             "destination_remote": item.destination_remote, "destination_path": safe_relative(item.destination_path),
             "mode": item.mode, "status": "ready", "last_run": None, "last_result": None}
    data = state(); data.setdefault("jobs", []).insert(0, value); save_state(data)
    return value


@app.post("/api/jobs/{job_id}/run")
def run_job(job_id: str, item: RunInput):
    data = state()
    job = next((x for x in data.get("jobs", []) if x["id"] == job_id), None)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["mode"] == "sync" and not item.confirm_sync_deletions:
        raise HTTPException(409, "Sync makes the destination identical and may delete destination-only files. Confirm to continue.")
    job["status"] = "running"; job["last_run"] = datetime.now(timezone.utc).isoformat(); save_state(data)
    try:
        args = [job["mode"], remote_path(job["source_remote"], job["source_path"]),
                remote_path(job["destination_remote"], job["destination_path"]), "--create-empty-src-dirs"]
        output = run_rclone(args, timeout=7200)
        job["status"] = "success"; job["last_result"] = output[-4000:] or "Completed successfully"
    except HTTPException as exc:
        job["status"] = "failed"; job["last_result"] = str(exc.detail)[-4000:]
    job["last_run"] = datetime.now(timezone.utc).isoformat()
    save_state(data)
    return job


FRONTEND = Path(os.environ.get("FRONTEND_DIST", "/app/frontend/dist"))
if FRONTEND.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        candidate = FRONTEND / path
        if path and candidate.is_file() and candidate.resolve().is_relative_to(FRONTEND.resolve()):
            return FileResponse(candidate)
        return FileResponse(FRONTEND / "index.html")
