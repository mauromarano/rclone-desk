# Roadmap

Rclone Desk is experimental. These are possible improvements, not delivery commitments.

- Durable operation history and scheduling safe across multiple processes.
- Sync dry-run preview and clearer overwrite handling.
- Detect storage overlap across more provider-specific aliases and wrapper backends.
- Provider-specific credential onboarding and cloud integration coverage.
- More complete Italian translations for server-side errors and provider messages.
- Reproducible cross-platform release checks and regular dependency/image refreshes.

The current product remains a single-admin, single-backend-worker application without built-in authentication. See [release validation](docs/RELEASE_VALIDATION.md) for verified behavior and limits.
