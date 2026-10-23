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

## Store distribution

Public Web Store ZIPs contain only extension source and bundled assets, never the legacy PowerShell updater, downloaded executable code, tokens, private extension keys, Sheet exports, or local settings backups. Never upload your personal configuration or `.pem` to GitHub or the Chrome Web Store. New extension IDs require explicit settings export/import and OAuth redirect review.
