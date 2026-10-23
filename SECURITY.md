# Security policy

Report suspected security vulnerabilities privately via the repository's
GitHub private vulnerability reporting feature when enabled, or contact the
maintainer through a nonpublic channel. Never put access tokens, private Sheets,
or personal project data into a public issue.

The extension uses bundled scripts and read-only Google Sheets OAuth, and makes
optional public GitHub release-metadata requests. It does **not** fetch or
execute updates remotely. A user-controlled `config.js` from an old installation
is preserved by the local in-place updater; public packages ship the blank shim.

Browser profile access can reveal local cached project data. Deleting the
extension or browser profile can erase user configuration. Keep independent
backups and do not remove/reinstall to upgrade.

This repository does not claim to have completed real-browser release
qualification. See the README for current limitations and manual checks.

## GitHub-only distribution

Release ZIPs use an explicit file allowlist and ship blank personal configuration. They contain `extension/` source and the user-triggered Windows updater; the extension cannot execute that updater. The updater downloads public stable GitHub release assets only from the fixed official repository, validates the published SHA-256, preserves local `config.js` and the installed manifest identity, and creates a recovery backup. A release from a compromised GitHub account could alter both the ZIP and its checksum, so users should verify the publisher and release page. Never commit private `.pem` files, OAuth tokens, Spreadsheet data, or exported settings.

GitHub Actions prepares **draft releases** and does not publish the stable version without a maintainer decision and real Brave/OAuth validation. A working mock UI is not equivalent to a verified production installation.
