# Rclone Desk 0.1.0

First experimental public prerelease of an independent, self-hosted web workspace for rclone.

Browse remotes, copy or move files, download/delete selections, create supported object-storage buckets, and manage manual or scheduled copy/sync jobs. The interface defaults to English and includes Italian.

This release prepares safer defaults: loopback-only Compose publishing, a non-root runtime, host/origin checks, private state files, atomic job changes, bounded/cancellable work, and bounded temporary downloads. It includes locked dependencies, a verified rclone source build, dependency notices, and automated build/security checks.

**Deployment:** there is no built-in authentication. Keep the upstream app private and use an authenticated HTTPS reverse proxy for remote access. See the deployment and backup guides before upgrading an existing root-run installation.

**Data safety:** move, sync, and delete can remove or overwrite data. Cancellation does not undo work already completed. Use a single backend worker and keep backups.

**Validation and limits:** see `docs/RELEASE_VALIDATION.md`. Local confined remotes were used for file-operation tests; real cloud-provider credentials and production TLS/DNS were not part of verification. Unfixed OS advisories remain documented. This is not a production-readiness or zero-vulnerability claim.

The release workflow publishes versioned multi-architecture images to `ghcr.io/mauromarano/rclone-desk:v0.1.0` with SBOM and provenance when all required checks succeed. Source code and original brand assets are MIT-licensed; third-party components retain their own licenses.
