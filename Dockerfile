# Reviewed multi-architecture index digests, updated by Dependabot.
FROM node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS frontend
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build \
    && mkdir -p /web/dist/licenses \
    && for package in i18next lucide-react react react-dom react-i18next scheduler; do \
         cp "node_modules/$package/LICENSE" "/web/dist/licenses/$package.LICENSE"; \
       done

FROM python:3.12-slim-trixie@sha256:b18b261e1b4974b4f321451ad5251ded85abb22c2b8b262da527dda1d031ab30 AS rclone-source
RUN python - <<'PY'
import hashlib
import pathlib
import tarfile
import urllib.request

version = "1.75.2"
artifacts = {
    f"rclone-v{version}.tar.gz": "fa64537e7276196310dbb0bcea6330f03b40e5790197b88f14cce6a19f40eb67",
}
destination = pathlib.Path("/tmp/rclone-src")
destination.mkdir(parents=True, exist_ok=True)
for filename, expected in artifacts.items():
    url = f"https://downloads.rclone.org/v{version}/{filename}"
    request = urllib.request.Request(url, headers={"User-Agent": "rclone-desk-build/0.1.0"})
    data = urllib.request.urlopen(request).read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise SystemExit(f"rclone source checksum mismatch for {filename}: {actual}")
    archive = pathlib.Path("/tmp") / filename
    archive.write_bytes(data)
    with tarfile.open(archive, "r:gz") as tf:
        tf.extractall(destination, filter="data")
PY

FROM --platform=$BUILDPLATFORM golang:1.26.10-bookworm@sha256:23ce71337b726608afb1bc00986e630a05034a87a87ea1fc2cd1ae5cf33387eb AS rclone
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY --from=rclone-source /tmp/rclone-src/ ./
COPY build/rclone/go.mod build/rclone/go.sum /src/rclone-v1.75.2/
WORKDIR /src/rclone-v1.75.2
COPY --chmod=0755 scripts/collect-go-licenses.sh /usr/local/bin/collect-go-licenses
RUN export GOMAXPROCS=2 CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" GOFLAGS=-mod=readonly \
    && go build -p 2 -trimpath -buildvcs=false \
       -ldflags="-s -X github.com/rclone/rclone/fs.Version=v1.75.2-desk.1" \
       -o /out/rclone . \
    && /usr/local/bin/collect-go-licenses /out/licenses \
    && unset GOFLAGS \
    && go clean -cache -modcache

FROM python:3.12-slim-trixie@sha256:b18b261e1b4974b4f321451ad5251ded85abb22c2b8b262da527dda1d031ab30 AS runtime
WORKDIR /app
COPY backend/requirements.lock ./requirements.lock
RUN python -m pip install --no-cache-dir --upgrade pip==26.3 \
    && python -m pip install --no-cache-dir --require-hashes -r requirements.lock \
    && python -m pip uninstall --yes pip \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data \
    && chown 10001:10001 /data \
    && chmod 0700 /data
COPY backend/ ./backend/
COPY --from=frontend /web/dist ./frontend/dist
COPY --from=rclone --chmod=0755 /out/rclone /usr/local/bin/rclone
COPY --from=rclone /out/licenses/ /usr/share/doc/rclone/dependency-licenses/
COPY --from=rclone-source --chmod=0644 /tmp/rclone-src/rclone-v1.75.2/COPYING /usr/share/doc/rclone/COPYING
COPY THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY LICENSE ./LICENSE
ENV APP_DATA=/data \
    FRONTEND_DIST=/app/frontend/dist \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=UTC
LABEL org.opencontainers.image.title="Rclone Desk" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/mauromarano/rclone-desk"
EXPOSE 8000
USER 10001:10001
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--limit-concurrency", "32", "--timeout-keep-alive", "5"]
