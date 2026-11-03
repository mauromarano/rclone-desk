# Security policy

Rclone Desk is experimental, single-administrator software. It has no built-in authentication. Keep it on a trusted network or behind an authenticated HTTPS reverse proxy, and do not expose the upstream app port directly.

## Reporting a vulnerability

If this repository is hosted on GitHub and **Private vulnerability reporting** is enabled, use the repository's **Security → Report a vulnerability** action. This provides a private channel to the maintainers. Do not open a public issue for an unpatched vulnerability.

If private reporting is unavailable, contact the repository maintainers through a private channel listed on the hosting profile, if one is provided. Do not include credentials, configuration exports, or private user data in a report. There is no dedicated security email address at this time.

Please include the affected version or commit, impact, steps to reproduce with sanitized data, and any relevant logs with secrets removed. The maintainers will acknowledge reports when practical, investigate, and coordinate a fix and disclosure. No response-time guarantee is currently offered.

## Supported versions

The 0.1 series is experimental. Reports against the current default branch and the latest prerelease are welcome. No long-term or version-specific support window is promised.
