# Changelog

## Unreleased

- Use `./data` as the default host bind mount, configurable through `RCLONE_DESK_DATA_DIR`.
- Add a data-directory preparation helper, bind-based CI smoke checks, and backup/migration instructions for existing named volumes.

## 0.1.0 — 2026-11-03

Initial experimental public release preparation.

- Browse, configure, and transfer files between rclone remotes; download and delete selections; create supported buckets; manage manual/scheduled copy and sync jobs.
- English-first interface and documentation with an optional Italian UI.
- Localhost-only default deployment, browser host/origin boundary, private persistence, and non-root container runtime.
- Atomic job transactions, bounded/cancellable operations, bounded temporary downloads, and faster UTC cron previews.
- Locked dependencies, verified rclone source build, pinned build images, third-party notices, and GitHub checks/release workflows.
- Original SVG identity, favicon/app icons, screenshots with synthetic data, and social preview.

This is single-admin experimental software, without built-in authentication, multi-worker support, or a durable transfer queue.
