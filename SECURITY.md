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