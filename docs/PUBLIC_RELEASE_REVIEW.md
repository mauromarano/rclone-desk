# Public release review

> Historical assessment of the pre-hardening repository. Findings below describe that baseline, not the current release. See [release validation](RELEASE_VALIDATION.md) for implementation status and remaining limits.

Date: 2026-11-03. Source baseline: `66910a8`.

## Recommendation

Publish initially as an **experimental, single-admin, self-hosted file manager** after completing the release gates below. The current default deployment should not be advertised as ready for internet exposure. Public source visibility and safe application deployment are separate decisions: publishing code does not require building a multi-user authentication system, but the shipped installation should be safe by default and describe its trust model accurately.

The existing Docker packaging, named persistent volume, English/Italian interface, explicit manual sync confirmation, argument-list subprocess calls, and relative-path checks are useful foundations. The main gaps are unauthenticated network exposure, a dependency advisory, reproducibility, licensing, and automated regression checks for destructive operations.

## Scope and evidence

- Reviewed backend routes, process execution, configuration handling, scheduling, frontend localization, Docker files, manifests, lockfile, documentation, and tracked assets.
- Delegated three bounded tasks to GPT-6 Luna: English README, repository/history hygiene, and dependency/license inventory. Findings were integrated into this review.
- Local Git history is not shallow. Five commits reachable through the local branches were reviewed by the hygiene task using credential patterns and path inspection. No obvious committed credentials were reported. This is not a dedicated secret-scanner clearance and does not cover remote-only branches, GitHub issues, logs, artifacts, or deleted external history.
- npm lockfile audit reported zero known advisories on the review date. Python package metadata and a maintainer advisory were compared separately; see the confirmed dependency finding below.
- No production requests, exploit attempts, container rebuild, cloud-provider operations, or image vulnerability scan were performed. This review establishes source-level findings and a release plan, not a security certification.

## Release gates

| Priority | Finding and evidence | Required action and completion criterion |
|---|---|---|
| P0 | Compose publishes `0.0.0.0:${PORT:-8000}:8000`; the API has no authentication. `GET /api/config` returns the credential-bearing configuration; writes, downloads, transfer, delete, and job routes are also unprotected. See `docker-compose.yml:5`, `backend/main.py:40`, `:553`, `:558`, `:614`, `:697`. | Default the host binding to `127.0.0.1`; document an authenticated HTTPS reverse proxy or private tunnel for remote access, with no bypass to the upstream port. Protect every API route as well as the UI. Verify access from outside the intended boundary is denied. Keep Uvicorn's internal container bind at `0.0.0.0` so container networking works. |
| P0 | `fastapi==0.115.12` requires Starlette `>=0.40.0,<0.47.0`, entirely within the affected range of CVE-2025-62727. The app serves files through the affected response class. | Upgrade the compatible FastAPI/Starlette graph, lock it, and scan the resolved environment/image. Verify static UI serving and archive downloads. Do not override Starlette outside FastAPI's declared compatibility range. |
| P0 | No repository license is declared. The image copies rclone's executable but discards the archive's notices. | Choose a project license and correct copyright holder; verify rights to contributed/copied code and assets. Include required third-party license notices in distributed bundles/images. Do not describe the project as open source until reuse terms are declared. |
| P0 | No root `.gitignore`, `.dockerignore`, or dedicated secret scan. Existing history inspection found no obvious secrets, but does not establish completeness. | Add ignores; run a dedicated full-history scan before publication, review screenshots and commit author metadata, and inspect any GitHub logs/artifacts if changing an existing repo's visibility. Revoke any discovered credentials before cleaning history. |
| P1 | Build uses `npm install`, `latest` dependency specs, mutable image tags, a moving `rclone-current` download without integrity verification, and no Python transitive lock. | Use `npm ci`, deliberate dependency versions, a resolved Python lock, reviewed image digests, and a versioned rclone download with checksum/signature verification. Automate updates. Build successfully from a fresh clone. |
| P1 | Runtime image has no `USER`, so it runs as root. App creates/writes configuration without enforcing restrictive permissions. See `Dockerfile`, `backend/main.py:36`, `:548`, `:574`. | Run as a dedicated non-root UID; give it ownership of `/data`. Restrict directory/config permissions, including replacement files; document volume migration for existing installs. Drop unneeded capabilities and enable no-new-privileges. Validate rclone operations under that UID. |
| P1 | No CI, contribution instructions, or private vulnerability reporting route. | Add the small checks/workflows and community files below. Enable private reporting and verify the chosen contact actually works. |

P0 means “resolve before recommending a public installation”; it does not assign a formal CVSS score. P1 work belongs in the first usable public release rather than being hidden behind a generic production-ready claim.

The Python advisory and dependency constraint are primary-source evidence: [FastAPI metadata](https://pypi.org/pypi/fastapi/0.115.12/json), [Starlette maintainer advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-7f5h-v6xp-fcq8). The network and permission findings above follow from this repository's code, not an external scan.

## Security and reliability work for the first release

### Define the trust boundary

Treat configuration access as administrator access. Arbitrary rclone configuration can point backends at container files or network services reachable by the container. Confined test remotes protect only those specific test roots; they do not sandbox the whole application or all provider configurations. Avoid mounting the host root, Docker socket, or unrelated secrets. Use provider credentials with the smallest required scope.

Choose and document one supported authentication arrangement. An authenticated reverse proxy is sufficient for an initial single-admin deployment if the upstream cannot be reached directly. Built-in login is a separate feature, with session expiry, secure cookies, credential handling, rate limits, and CSRF protection designed together. CORS configuration alone is not authentication.

Add an explicit allowed-host policy and appropriate Origin/CSRF protections for browser mutations, especially with cookie-based proxy authentication. The current app has no host-validation middleware; DNS rebinding is a threat to assess even when changing to a loopback bind. This was not exploited during the review. [Starlette documents TrustedHostMiddleware](https://www.starlette.io/middleware/#trustedhostmiddleware). Put TLS and security headers at the supported proxy, including frame protection and a tested CSP; avoid caching credential-bearing configuration responses.

rclone obscuring is reversible and does not protect credentials from someone who reads the config. Use file/volume protection and backup protection; whole-config encryption would require explicit integration because the app currently reads and writes INI directly. [rclone explains obscuring](https://rclone.org/commands/rclone_obscure/) and [configuration handling](https://rclone.org/docs/).

### Bound resources and clean up processes

- `start_operation` starts a thread/process per request with no queue or concurrency cap (`backend/main.py:330`). Add bounded concurrency, request quotas, cancellation, and limits for retained operation output. The diagnostic list in `run_tracked` grows before its final message is truncated.
- ZIP downloads limit file count but not total bytes or duration (`backend/main.py:663`). Add disk-space checks, a size budget, deadlines, orphan-temp cleanup at startup, and process termination on failure/disconnect. Avoid putting unlimited temporary downloads in the same volume as credentials and state.
- Single downloads wait for subprocess completion without a deadline (`backend/main.py:650`); ZIP creation drains stdout before stderr (`:681`), which may block if stderr fills. Manage both streams and terminate/reap children reliably.
- `next_cron_run` may scan about 2.6 million minutes for an impossible/sparse schedule (`backend/main.py:228`). Replace the brute-force search or bound/cancel it; cache previews and avoid recalculating expensive schedules per jobs request.
- Limit body sizes before fully parsing them, lengths/counts of model fields, request durations, and subprocess output. The config's 1 MiB check currently happens after JSON deserialization.

### Preserve data and job state

- Several job mutations read/modify/write `state.json` without a consistent lock. `save_state` uses one fixed temporary filename. Concurrent requests or the scheduler can lose updates or collide. Use a single transaction/locking strategy or SQLite (`backend/main.py:52`, `:740`, `:770`, `:804`).
- `run_job` checks running status before acquiring the update lock; simultaneous calls may both launch a destructive job (`backend/main.py:818`). Make check-and-mark atomic, including scheduled/manual interactions.
- App config writes are direct truncating writes; rclone may also update OAuth tokens. Plan atomic persistence, backups, and coordination with rclone's own writes. Python thread locks do not coordinate separate rclone processes.
- Keep exactly one backend instance/worker until scheduling and state become safe across processes. Multiple workers would create independent schedulers and operation registries.
- Validate overlapping source/destination paths and backend aliases, not just equal strings, before copy/move/sync. Add a dry-run/preview for sync as a subsequent improvement. Never rely only on the confirmation dialog for data safety.
- ZIP entries use only each basename, so selecting `a/report.txt` and `b/report.txt` creates duplicate archive names. Preserve relative paths or resolve collisions predictably.
- Make timezone explicit (UTC is a clear default); document cron semantics, daylight-saving behavior if applicable, skipped runs during downtime, restart behavior, and the lack of a durable operation queue/history.

These are static findings and risks to address with targeted regression checks, not claims that production data has already been corrupted.

## Licensing decision

My default recommendation for a broadly reusable personal self-hosted tool is **MIT**, provided the rights inventory supports it. Choose **Apache-2.0** if express patent terms matter; choose **AGPL-3.0** only if requiring source availability for modified network-served versions is an intentional goal. A separate rclone process does not itself require choosing rclone's license for your original code. Legal obligations still depend on what is copied and distributed.

Before choosing, verify original authorship, employment/client ownership, copied snippets, fonts/icons, screenshots, and any earlier upstream basis. Confirm actual shipped dependency licenses rather than inferring them from only direct dependencies. Preserve rclone's notice and bundle notices for included frontend code; inventory Python, OS, and Go dependencies in the image. Optional MPL-licensed build packages in the npm lock do not by themselves mean the React app must be MPL; evaluate distribution and modifications at the relevant files. See [the dependency/license review](DEPENDENCY_LICENSE_REVIEW.md) for sources and limitations.

Keep `private: true` in `frontend/package.json` if the app is not intended for npm publication. It does not prevent public GitHub hosting and does not declare a source license. After the license decision, align package license metadata, README, notices, release assets, and image labels.

## Repository and GitHub checklist

### Files

- Root `.gitignore`: credentials/config exports, `.env` variants (allow a sanitized `.env.example`), local data, archives, logs, Python virtualenv/caches, editor/OS files, and frontend build/dependency directories. Do not ignore dependency lockfiles. Ignores do not remove already tracked history.
- Root `.dockerignore`: `.git`, credentials/data, caches, `node_modules`, `dist`, private notes, and design-review artifacts. Preserve all files the build actually needs.
- `LICENSE` and third-party notices after the maintainer's decision.
- `SECURITY.md`: supported versions, trust model, private report channel, and a realistic response policy. Prefer GitHub private vulnerability reporting over an invented email address.
- `CONTRIBUTING.md`: Docker development steps, architecture, verification commands, style/translation conventions, and a warning to use disposable local remotes for destructive-operation checks.
- Issue templates for bugs/features and a short PR template. Ask for versions and sanitized reproduction steps; explicitly discourage uploading config files, tokens, private logs, and real file listings.
- `CHANGELOG.md`, a small roadmap, and an initial prerelease such as `v0.1.0`. The current npm `1.0.0` alone is not evidence of a released stable product.
- `CODE_OF_CONDUCT.md` if opening a community, with a real enforcement contact; `SUPPORT.md` if needed to route operational questions.

Keep `PRODUCT.md` and `DESIGN.md` if useful to contributors. Move deliberate screenshot/demo assets into `docs/images` with a provenance note; `.impeccable` is implementation tooling and can be omitted from the public presentation. Current review screenshots appear to contain synthetic local test data, but should be refreshed before marketing the present feature set. No need to rewrite history solely because design-tool files are present.

### Automation and settings

1. CI on pull requests: frozen frontend build, Python static/lint checks, Compose validation, and a Docker build/smoke check. Add focused tests for traversal/symlinks, credentials/auth boundary, copy versus move versus sync, job concurrency, schedule handling, and failed/disconnected downloads using disposable remotes. No real cloud credentials in PR CI.
2. Dependency updates for npm, Python, Docker, and Actions. Run secret scanning, dependency scanning, and built-image scanning; produce an SBOM that includes the manually downloaded rclone executable.
3. Give Actions minimal permissions, pin third-party Actions to reviewed commit SHAs, and avoid privileged execution of untrusted fork code. Publish packages only from trusted release events.
4. Protect the main branch using rulesets/required checks as appropriate; enable Dependabot alerts, secret scanning/push protection and private vulnerability reporting where available. Use owner-account 2FA.
5. Publish release images only after verified builds. Prefer GHCR with version tags plus digests, OCI source/license/revision labels, SBOM and provenance. Sign if supported by the release process. Do not make `latest` the only reproducibility reference.
6. The Dockerfile hardcodes the Linux amd64 rclone archive. Declare amd64-only support initially, or implement and verify architecture-specific downloads before advertising arm64/Raspberry Pi support.
7. Before changing visibility, review remote branch history, author emails, Actions logs/artifacts, releases, issues/PRs, and private organization references. [GitHub notes that Actions history/logs become visible](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility). [Secret scanning covers repository history and more](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning).

## English as the primary language

The README has been rewritten in English and describes current features and limitations. Use English for community files, issues/PR templates, release notes, GitHub description/topics, and primary screenshots. Keep Italian as an optional UI locale; default initialization already selects English unless Italian was saved.

Complete the translation audit before calling the English UI complete. Current localization translates Italian strings and regular-expression patterns through `LocalizeTree`; newly added loading strings (`Lettura…`, `Sto leggendo i file di `), interpolated item counts, and several backend errors/statuses do not all have complete English mappings. The previous loading-animation change introduced untranslated strings. Prefer explicit translation keys with interpolation/plurals, keep remote names and filenames untranslated, and use stable error codes plus localized frontend messages for backend failures.

README follow-ups once release decisions are made: actual clone URL, one current English screenshot with synthetic data, architecture diagram, tested versions/platforms, tested authenticated deployment example, backup/restore instructions, development guide, license link, release/image links, and troubleshooting for permissions/provider authentication. Add badges only for real workflows/releases. Add “Independent project; not affiliated with the rclone project.” as clear project positioning.

## Name and GitHub presentation

**Recommended repository slug: `rclone-desk`. Product name: Rclone Desk.** This is already consistent across UI, package metadata, HTML, and documentation, and covers browsing, transfers, and scheduled jobs.

Suggested GitHub description:

> A self-hosted web workspace for rclone: browse remotes, transfer files, and schedule copy or sync jobs.

Suggested topics: `rclone`, `self-hosted`, `file-manager`, `docker`, `cloud-storage`, `react`, `fastapi`.

Alternatives: `rclone-remote-desk` (clearer but longer), `rclone-file-desk` (file management emphasis), or `rclone-transfer-desk` (transfer emphasis). Avoid using generic `rclone-webui` as the public identity because it is easily confused with the existing [rclone/rclone-webui-react project](https://github.com/rclone/rclone-webui-react). These are naming recommendations, not availability or trademark clearance. Check the intended GitHub owner/slug and any future domain before committing to a new identity. Do not imply official affiliation.

## Logo direction and generation brief

Use a small original geometric mark that joins two file panes with a clear connection. Match the existing blue `#2459D6` and ink `#172033`; keep one-color and reversed variants. Keep amber/red for operational warnings in the product. Avoid copying the rclone logo or cloud-provider marks, and avoid details that disappear at favicon scale.

For a simple product mark, author the final **SVG** directly. Image generation is useful for exploring concepts, followed by manual vector reconstruction and inspection. A raster generator does not deliver a reliable production SVG merely because a prompt requests one. Do not auto-trace an elaborate generated illustration into the favicon.

English exploration prompt:

> Create three distinct original logo concepts for “Rclone Desk”, an independent self-hosted file manager for rclone. Explore two adjacent file panes connected by one simple directional gesture, with generous negative space and a practical, calm character. Flat geometric shapes, no gradients, no shadows, no cloud-provider or rclone brand symbols, no mascots, no mockup backgrounds. Primary blue #2459D6 with ink #172033. Show the symbol alone and a clean wordmark separately. The symbol must remain legible at 16 px and work in one color. Use a transparent background for the delivered raster concepts.

Deliverables after concept selection: `logo.svg`, monochrome/inverse SVGs, favicon SVG/ICO with 16/32 px exports, 180 px touch icon, optional 192/512 px app icons, and a GitHub social preview at 1280×640. Test light/dark backgrounds and small sizes. Record authorship/source, generation tool/date if used, font license, and the logo's reuse policy. Code licensing and trademark/brand policy can differ, but must be stated clearly.

## Suggested execution order

1. Confirm code/asset ownership, choose license, add notices, complete history/metadata clearance.
2. Fix default network exposure and upgrade the vulnerable Python dependency graph.
3. Freeze/review builds, run as non-root, secure persisted secrets, add basic CI and private reporting.
4. Fix destructive-job concurrency and download/resource issues; verify with disposable local data.
5. Complete English UI/docs, refresh screenshots, create the small SVG identity, and set GitHub metadata.
6. Perform one fresh-clone build and documented quickstart/backup/restore check; review remaining scan findings; publish an experimental tagged release.

This review changes documentation only. Application fixes, GitHub settings, license selection, image/logo generation, commits, and publication remain subsequent work.
