#!/usr/bin/env python3
"""Ensure direct backend pins match the hash-locked transitive graph."""

from __future__ import annotations

import re
import sys
from pathlib import Path


PIN = re.compile(r"^([A-Za-z0-9_.-]+)(?:\[[^]]+\])?==([^\s;\\]+)")
LOCKED = re.compile(r"^([A-Za-z0-9_.-]+)==([^\s\\]+)")


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def read_versions(path: Path, pattern: re.Pattern[str]) -> dict[str, str]:
    versions: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        match = pattern.match(line)
        if match:
            versions[normalize(match.group(1))] = match.group(2)
    return versions


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: check-python-lock.py requirements.txt requirements.lock")

    manifest = read_versions(Path(sys.argv[1]), PIN)
    locked = read_versions(Path(sys.argv[2]), LOCKED)
    missing = {name: version for name, version in manifest.items() if name not in locked}
    changed = {
        name: (version, locked[name])
        for name, version in manifest.items()
        if name in locked and locked[name] != version
    }
    if missing or changed:
        if missing:
            print(f"Direct dependencies missing from lock: {missing}", file=sys.stderr)
        if changed:
            print(f"Direct dependency pins differ from lock: {changed}", file=sys.stderr)
        return 1
    print(f"Verified {len(manifest)} direct dependency pins against the lock.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
