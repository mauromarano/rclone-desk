# Release validation

Date: 2026-11-03. Target: experimental Rclone Desk 0.1.0, single administrator and one backend worker.

The earlier [release review](PUBLIC_RELEASE_REVIEW.md) and [dependency/license review](DEPENDENCY_LICENSE_REVIEW.md) record the pre-hardening baseline. This document describes the implementation and checks for the public repository.

## Changes implemented

- Compose binds only `127.0.0.1`, drops container capabilities, and sets no-new-privileges, and caps memory/CPU/PIDs. The image uses UID/GID 10001 and private data/config/state permissions.
- Trusted hosts and same-origin write checks guard browser requests. Bodies are bounded before JSON parsing, with a receive deadline; API responses are not cached. Security response headers include frame protection and a CSP. These controls are not authentication: remote access requires the documented authenticated HTTPS proxy.
- Job state transactions share one lock, replacements are atomic/private, simultaneous runs cannot both claim one job, and known overlapping local/alias locations are rejected. Corrupt state is preserved and reported rather than silently reset.
- Operations run in four workers with a bounded 256-item admission limit and a bounded recent history. Queue admission for a deletion batch is atomic; queued/running work can be cancelled. Subprocess groups are killed/reaped on cancellation or deadline, and diagnostic output/listings have bounds. Configuration edits are rejected while remote work uses it.
- Downloads are prepared in isolated temporary storage before sending. They retain paths in ZIP files, cap total content at 1 GiB, cap generation at five minutes, admit two concurrent responses, check free disk space, and release files/slots on failure or disconnection. Orphan spools are cleaned at startup.
- Cron previews inspect days instead of millions of minutes, cache bounded results, and use UTC. Previews search up to five years; missed runs are not replayed. Interrupted jobs are marked failed on restart.
- MIT licensing, original logo/icon assets, dependency notices, English-first documentation, translation improvements, contribution/security guidance, and issue/PR templates are included.
- npm versions and Python runtime graph are locked; Python packages require hashes. Build images are digest-pinned. rclone v1.75.2-desk.1 is built from checksummed v1.75.2 source using Go 1.26.10 and a frozen security overlay (chi 5.4.0 and x/net 0.62.0), with a read-only module graph and collected dependency license texts. Build caches are cleaned in the compile layer.
- GitHub workflows build, lint, test, scan, and gate tag-triggered multi-architecture image publishing, SBOM/provenance, and experimental prereleases. Consult repository Actions history for results on the exact published commit.

## Checks

| Check | Result / scope |
|---|---|
| Backend regressions | 26 tests passed in an isolated non-root Docker container. Includes actual local rclone copy, move, consented sync, archive contents, request boundary, traversal/symlinks, concurrency, cancellation, deadline termination, and disconnected-download cleanup. No cloud credentials used. |
| Python static checks | Compilation and Ruff F/E9 checks passed. Direct manifest pins match the hash lock. |
| Dependency audits | npm audit and pip-audit reported no known advisories in their reviewed lock graphs on this date. |
| Secrets | Gitleaks 8.30.1 full local history (five existing commits) and working-tree scans reported no leaks before the release commit. Later release commits are also scanned in CI. |
| Compose | Configuration validates and publishes the service on IPv4 loopback only. |
| Authenticated proxy | Disposable Caddy 2.11.7 on local HTTPS: unauthenticated request 401, authenticated config request 200, authenticated cross-origin mutation 403. Used Caddy's internal CA with certificate verification bypassed for the test only; public DNS/ACME not tested. |
| Backup/restore | Disposable named volumes and Alpine 3.24: synthetic file hashes preserved, stale destination contents removed, ownership restored to 10001:10001 with private config permissions, readable by the runtime UID. |
| Frontend | Frozen dependency build and Impeccable detector passed. Desktop/mobile browser inspection and final captures use synthetic local remotes. No JavaScript errors or mobile horizontal overflow were detected; the English loading state, user filename preservation, and remote-name validation were checked. No claims about real-provider integration follow from screenshots. |
| Final image / SBOM | Trivy 0.75.0 completed on the final source-built image; CycloneDX SBOM contains 353 components. See the result below. |

## Image scan outcome

Final scanned local image: `sha256:df77ad5a65ef4d564f73fd686d5e102f1c653693efe5f73e47aadd5435625906` (Linux amd64).

| Severity | Findings |
|---|---:|
| CRITICAL | 0 |
| HIGH | 45 |
| MEDIUM | 72 |
| LOW | 61 |
| UNKNOWN | 8 |

There are **zero fixable HIGH/CRITICAL findings**. All HIGH findings have no fixed version listed by this scanner database. The only fixable entry is UNKNOWN-severity [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932), the advisory about unmaintained `golang.org/x/crypto/openpgp`. The selected rclone command paths do not import that deprecated OpenPGP package; this is a source inspection finding, not a complete call-graph proof. The app uses rclone's CLI and does not start its RC/HTTP server or self-update commands. See `THIRD_PARTY_NOTICES.md` for tracking.

The reachable x/net HTML parser finding, chi finding, and Go TLS finding are absent from the final scan. The image's rclone binary is `v1.75.2-desk.1`, with a frozen, reviewed module overlay. License checks found no missing module root licenses and all six expected frontend notices are shipped.

The first image revealed a vulnerable Go TLS certificate-verification library in the official rclone binary; rebuilding v1.75.2 using Go 1.26.10 addresses the [Go maintainer advisory GO-2026-6809](https://pkg.go.dev/vuln/GO-2026-6809). The reachable [x/net HTTP listing parser issue](https://pkg.go.dev/vuln/GO-2026-6860) was addressed by the x/net 0.62.0 overlay. The old FastAPI/Starlette constraint was also replaced with a reviewed current graph. The base image moved from Debian Bookworm to Trixie, and runtime pip was removed after installation.

A clean npm/Python audit is not a zero-vulnerability claim for the entire image. CI prints the full image report, including upstream-unfixed OS findings, then separately fails on known **fixable HIGH/CRITICAL** image findings. Unfixed entries must remain visible in scan output and be revisited on image refresh; no blanket vulnerability exclusions are configured.

## Remaining limits and administration

- No built-in authentication, multi-user isolation, durable transfer queue/history, or multi-worker scheduler. Configuration is an administrator capability and may reference container files or reachable services.
- Provider-specific aliases/wrapper backends can refer to the same underlying storage without being detectable from generic configuration. Review destinations, keep backups, and use narrow provider permissions. Cancellation is not a rollback.
- Real cloud OAuth/token-refresh behavior and provider-specific failures remain outside local coverage. App config writes are blocked during active work, but rclone owns provider token refresh and external config editing is unsupported while the app runs.
- Italian translations of backend/provider errors are incomplete. English is primary.
- Git history contains author metadata; no history rewrite was performed. No credential values were printed in the reports.
- GitHub settings require repository administration access. See [the settings checklist](github-settings.md) for private reporting, description/topics, social preview, and branch protection. An SSH push key alone cannot configure those settings.
- No existing deployed application, real credentials, or production data volume was modified during validation. Test containers/volumes are separate and removed after checks.

## Published release

The [main CI run](https://github.com/mauromarano/rclone-desk/actions/runs/41623243056) and [v0.1.0 publication workflow](https://github.com/mauromarano/rclone-desk/actions/runs/41623905532) both succeeded for source commit `f89bc3d1fb45b510fb8bb93f51da76685cbcc5b8`. The [experimental prerelease](https://github.com/mauromarano/rclone-desk/releases/tag/v0.1.0) is public. Anonymous manifest access to `ghcr.io/mauromarano/rclone-desk:v0.1.0` was verified; it includes Linux amd64 and arm64 plus attestation manifests. Published index digest: `sha256:64cf480d2f94981af8aa15b7d4400fe997e2724c8318c074c4fb282a5a45462a`.

A final sourcemap inventory found seven frontend runtime packages. The seventh, `use-sync-external-store` 1.7.0, has a license byte-identical to React's shipped notice (both SHA-256 `da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93`). The lockfile integrity of both package archives was verified. Babel runtime and the HTML parser were tree-shaken out of this bundle; build-only modules are not part of the shipped frontend.

## Bind-mount follow-up

The current Compose setup stores data in `./data` (or `RCLONE_DESK_DATA_DIR`) via an explicit bind mount with automatic host-directory creation disabled. `scripts/prepare-data.sh` initializes private UID/GID 10001 storage and refuses a nonempty directory owned by another user. The published v0.1.0 image is compatible with this storage change; no new runtime image is required.

Checks on disposable data verified Compose output, directory ownership/mode, repeated preparation, HTTP startup, and remote persistence after container recreation. A separate fixture verified migration from a legacy named volume without modifying its source, refusal to overwrite a nonempty bind destination, and a mode-600 backup readable by the host owner. Existing application containers and real data were not migrated or removed. CI smoke checks now use a temporary bind directory.
