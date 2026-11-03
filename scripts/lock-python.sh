#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
docker run --rm --platform linux/amd64 \
  -v "$repo_root/backend:/work" -w /work \
  python:3.12-slim-trixie@sha256:b18b261e1b4974b4f321451ad5251ded85abb22c2b8b262da527dda1d031ab30 \
  sh -eu -c 'python -m pip install --no-cache-dir --upgrade pip==26.3 && python -m pip install --no-cache-dir pip-tools==7.6.2 && pip-compile --generate-hashes --strip-extras --output-file=requirements.lock requirements.txt'
