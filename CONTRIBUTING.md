# Contributing

Thanks for helping improve Rclone Desk. It is an experimental, single-admin application with one backend worker. Keep that operating model in mind when changing scheduling, in-memory operation tracking, or persisted state.

## Development

Build and run the complete application with Docker Compose:

```sh
./scripts/prepare-data.sh
docker compose up --build
```

The image builds the frontend and backend; host Node.js, Python, and rclone are not needed. The app listens on port 8000 inside the container and persists app data under `/data`, bind-mounted from `./data` in the repository by default. Run the helper once before the first Compose start to prepare that directory for runtime UID 10001. To use another location, export `RCLONE_DESK_DATA_DIR` before running the helper and Compose. Compose binds to localhost by default. Use `PORT` to change the host port.

The frontend source is in `frontend/src`; the FastAPI application is in `backend/main.py`. Keep user-facing copy in both English and Italian localization files. Preserve remote names, file names, and provider values as user data rather than translating them.

## Verification

Build the image, then run the regression suite against disposable storage:

```sh
docker build -t rclone-desk:test .
docker run --rm --cap-drop=ALL --security-opt=no-new-privileges \
  -e APP_DISABLE_SCHEDULER=1 \
  -v "$PWD/backend:/app/backend:ro" \
  rclone-desk:test python -m unittest discover -v -s backend/tests
```

The tests include real rclone copy, move, sync, and download operations, using only temporary confined local remotes. The GitHub workflow also checks lockfiles, credentials, and the built container. Update Python locks with `scripts/lock-python.sh`; review the resulting changes before committing.

## Before opening a pull request

- Run `docker compose build` and `docker compose config` for build/configuration changes.
- Describe any manual verification and its limits. Do not claim a check was run if it was not.
- For file-operation, sync, deletion, or scheduler changes, use disposable local test remotes and synthetic files. Never test destructive behavior against personal or production remotes.
- Include the user-visible impact, relevant screenshots for UI changes, and any required configuration or migration notes.
- Keep changes focused and explain security implications, especially around credentials, network access, subprocesses, and data deletion.

## Safe reports and patches

Do not attach `rclone.conf`, provider credentials, access tokens, unredacted logs, real file listings, or private data to issues or pull requests. See [SECURITY.md](SECURITY.md) for private vulnerability reporting and [SUPPORT.md](SUPPORT.md) for help requests.
