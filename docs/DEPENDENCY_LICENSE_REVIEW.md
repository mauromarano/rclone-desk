# Public GitHub readiness: licenses and dependencies

> Historical assessment of the pre-hardening repository. Findings below describe that baseline, not the current release. See [release validation](RELEASE_VALIDATION.md) for implementation status and remaining limits.

**Scope:** static review of the checked-in source and build configuration in this repository on 2026-11-03. This is a readiness review, not legal advice or a complete bill of materials for a built image.

## Assessment

The repository is not yet ready to communicate clear reuse terms: no root `LICENSE` file is tracked. A public GitHub repository without a license remains subject to default copyright rules; GitHub users may view and fork it under GitHub's terms, but that does not grant general permission to reuse, redistribute, or make derivative works ([GitHub: Licensing a repository](https://docs.github.com/en/enterprise-cloud%40latest/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)). The project owner should select and add a license before inviting public reuse.

### License choice to make

| Option | Practical signal | Tradeoff to weigh |
|---|---|---|
| MIT | Broadly permits reuse, modification, redistribution, sublicensing, and commercial use with copyright and license notices retained. | Minimal conditions; does not itself require publishing modified source. [OSI MIT text](https://opensource.org/license/mit) |
| Apache-2.0 | Also permissive, with express patent language and conditions including preserving notices and handling any `NOTICE` file. | More explicit terms and notice handling than MIT. [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), [ASF guidance](https://www.apache.org/foundation/license-faq.html) |
| AGPL-3.0 | Strong copyleft, including source-offer obligations for a modified version used to provide a service over a network. | Better matches an intent to keep networked modified versions under the same license, but is a materially stronger obligation. [GNU AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html), [Choose a License summary](https://choosealicense.com/licenses/agpl-3.0/) |

Choose based on the project's reuse and network-service goals. The review cannot determine whether the combined container and separately invoked rclone executable constitute a particular kind of combined work; get qualified legal advice if that distinction drives the choice.

## Third-party software and notices

- The Dockerfile downloads and ships the **rclone executable** in the final image. rclone identifies its license as MIT ([rclone license page](https://github.com/rclone/rclone/blob/master/docs/content/licence.md)). MIT's text requires the copyright and permission notice in copies or substantial portions. The current Dockerfile copies only the executable and does not visibly retain rclone's `COPYING` notice. Include the notice in the image and any image distribution, and make it easy for image recipients to find.
- The committed npm lockfile records 50 packages: MIT (34), MPL-2.0 (12, including platform-specific optional Lightning CSS packages), ISC (2), Apache-2.0 (1), and BSD-3-Clause (1). The final image contains the generated frontend bundle, not the Node build environment. Confirm which package code/notices are actually present in the published bundle/image and ship required third-party notices for distributed components. Mozilla describes MPL 2.0 as file-level copyleft and distinguishes source delivered in an executable from code merely used on a web server ([MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)).
- The checked-in visual assets are `.impeccable/review/desktop.png` and `mobile.png`; no license/attribution metadata was found alongside them. Confirm the project has rights to publish them. `.impeccable/questions/roll.json` contains remote inspiration URLs, not bundled image files.
- The npm package metadata says `private: true`; this prevents npm publication intent but does not license the source repository.

## Dependency and build hygiene

- `frontend/package-lock.json` is present (lockfile v3), but the Dockerfile runs `npm install`. Use `npm ci` in image builds so the committed lockfile is installed as a frozen tree; npm documents that `npm ci` fails on manifest/lock mismatch and does not rewrite the lock ([npm ci](https://docs.npmjs.com/cli/v8/commands/npm-ci/)). Replace `latest` ranges for `react`, `react-dom`, and `@vitejs/plugin-react` with deliberate ranges or exact versions. The lock currently captures resolved versions, but loose ranges make dependency refreshes implicit and less reviewable.
- `backend/requirements.txt` pins FastAPI and Uvicorn top-level versions only. Their transitive graph is not locked. Commit a fully resolved Python lock (for example `uv.lock`) and build from it; uv documents that its lock records exact resolved versions for consistent installations ([uv lockfiles](https://docs.astral.sh/uv/guides/projects/)).
- `node:22-alpine` and `python:3.12-slim` are mutable tags. Pin images to reviewed digests and automate digest updates so security fixes continue to flow ([Docker build best practices](https://docs.docker.com/build/building/best-practices/)).
- The Dockerfile fetches `rclone-current-linux-amd64.zip`, which moves over time, and does not verify a checksum or signature. Pin a named rclone release and verify its published checksum/signature before extracting it. Pin or otherwise control the versions of OS packages installed by `apt` as part of the same reproducibility work.
- Add automated dependency and image checks to CI: enable GitHub dependency graph and Dependabot alerts/updates, scan lockfiles for known vulnerabilities (for example [OSV-Scanner](https://github.com/google/osv-scanner)), and scan the built container for OS and application packages. Generate and retain an SBOM for release images; include the downloaded rclone binary in inventory because it is invisible to package-manager manifests. Scanners improve visibility but do not prove absence of vulnerabilities or resolve license interpretation.
- No CI workflow, Dependabot configuration, or security/scan policy was found in the tracked repository files reviewed.

## Advisory check performed

`npm audit --package-lock-only --ignore-scripts --json` returned **0 known advisories** across 50 lockfile entries on 2026-11-03. This is a point-in-time registry audit of the npm lockfile only; it does not cover Python's unresolved transitive dependency set, the base images, apt packages, or the separately downloaded rclone binary. No full Python or container scan was performed.

An additional **manifest-level Python finding** is confirmed: [FastAPI 0.115.12 metadata](https://pypi.org/pypi/fastapi/0.115.12/json) requires `starlette>=0.40.0,<0.47.0`. This entire range is affected by [GHSA-7f5h-v6xp-fcq8 / CVE-2025-62727](https://github.com/Kludex/starlette/security/advisories/GHSA-7f5h-v6xp-fcq8), a denial of service in `FileResponse` Range handling, fixed in Starlette 0.49.1. The app uses both `FileResponse` and `StaticFiles`, so the affected feature is present. Upgrade FastAPI to a maintained release compatible with a currently reviewed Starlette version and resolve the full graph; do not force an incompatible Starlette override. This is a constraint/advisory match, not a statement about a running image or a completed exploit test. Other advisories still require a complete scan.

## Sources

- [GitHub: Licensing a repository](https://docs.github.com/en/enterprise-cloud%40latest/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
- [rclone license](https://github.com/rclone/rclone/blob/master/docs/content/licence.md)
- [OSI: MIT License](https://opensource.org/license/mit)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) and [ASF FAQ](https://www.apache.org/foundation/license-faq.html)
- [GNU AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html)
- [Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [npm `ci`](https://docs.npmjs.com/cli/v8/commands/npm-ci/) and [uv project lockfiles](https://docs.astral.sh/uv/guides/projects/)
- [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- [OSV-Scanner supported artifacts and lockfiles](https://github.com/google/osv-scanner/blob/main/docs/supported_languages_and_lockfiles.md)
