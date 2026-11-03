# GitHub repository settings

Repository: <https://github.com/mauromarano/rclone-desk>.

The source and workflows can be published using Git over SSH. Repository settings require a GitHub connection with administration permission; an SSH push key alone does not grant API access.

## Presentation

- Description: `A self-hosted web workspace for rclone: browse remotes, transfer files, and schedule copy or sync jobs.`
- Topics: `rclone`, `self-hosted`, `file-manager`, `docker`, `cloud-storage`, `react`, `fastapi`.
- Upload `docs/images/social-preview.png` in **Settings → General → Social preview**.
- Keep `main` as the default branch.

## Security and collaboration

- Enable **Private vulnerability reporting** in the repository's security settings before inviting reports; verify that **Security → Report a vulnerability** is available to another account.
- Enable the dependency graph, Dependabot alerts, secret scanning, and push protection where available. Weekly dependency-update configuration is included in this repository.
- After the first CI run succeeds, add a branch ruleset for `main` requiring the `checks` job and pull requests for routine changes. Avoid imposing a second-person approval requirement if there is only one maintainer. Block force pushes and branch deletion.
- Keep Actions workflow permissions read-only by default; the release job requests narrowly scoped package/attestation permissions. Do not expose secrets to fork pull requests.
- Keep Issues enabled and use the supplied issue templates. Never request configuration files, credentials, or private listings from contributors.
- Enable two-factor authentication on the owner account and review collaborators/deploy keys.

## Release

A trusted `v*` tag starts the image workflow. It runs CI before publishing versioned amd64/arm64 images to `ghcr.io/mauromarano/rclone-desk`, with SBOM and provenance. An image exists only after that workflow succeeds. Use an experimental prerelease description for the first release, and link to `CHANGELOG.md` and the validation report. Keep package visibility consistent with the public repository.
