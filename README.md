# Project Dashboard

**A lightweight, privacy-first browser new-tab dashboard for project status and next actions.**

Project Dashboard reads a **user-selected private Google Sheet**. The open-source repository and release ZIP contain no personal spreadsheets, OAuth IDs, tokens, or projects. Licensed under MIT.

**Distribution:** [GitHub Releases](https://github.com/kurichon/project_dashboard/releases), without the Chrome Web Store. The latest v1.4.1 source is a candidate until verified in a real Brave installation.

## Features

- Compact cards for each project: current status, next action, last update, and recent activity.
- Select your own Spreadsheet URL/ID and Projects/History tabs; read-only Google Sheets OAuth.
- Settings stored in Chromium profile storage, separate from the app source; Sheet-specific offline cache and malformed-history warnings.
- Settings export/import for recovery and browser migration (contains private Sheet/OAuth IDs; **never share backup files**). No tokens or cached project data are exported.
- Version display and daily/on-demand checks for **published stable GitHub releases**. Notification links to the release download page; unpacked extensions cannot run installers themselves.
- Optional Windows in-place updater, with release SHA-256 verification, backup, identity preservation and no uninstall.

## First-time installation

1. Download the ZIP and checksum from [GitHub Releases](https://github.com/kurichon/project_dashboard/releases). Verify the ZIP against `SHA256SUMS.txt`.
2. Extract to a permanent folder. In Brave open `brave://extensions` → Developer mode → **Load unpacked** → choose `extension/`.
3. In the new tab, open Settings. Provide your Google Spreadsheet URL/ID, the tab names (`Projects` / `History` by default), and a Google OAuth Web client ID authorized for the exact redirect URL displayed. No client secret is used.
4. Click **Save settings**, then **Connect Google**. The Sheets API must be enabled and the selected Google account must have access to the Sheet.

Required Projects headers: `Project | Status | Next | Updated`. Optional History headers: `Timestamp | Project`. A Google Drive folder picker is out of scope; only a selected Sheet is read.

## Google account selection

**Connect Google** and **Change account** always request a fresh Google account chooser;
neither button reuses a previously cached token. **Change account** remains available
after denied or cancelled sign-ins. A first connection waits for your click rather
than silently trying the browser's default Google account. Rejected access clears
only the session, account hint and cached rows, not your Sheet/OAuth configuration.

Silent renewal is allowed only after an explicit selection with a returned Google
account slot; otherwise click Connect Google again. No additional OAuth scopes are
requested. The v1.4.1 fix is regression-tested with simulated Google responses;
real Google/Brave account selection still needs confirmation on the user's device.

## Update without uninstalling

The extension checks GitHub for new releases but **does not install them automatically**.

**Windows — easiest after first setup:** keep `Update Project Dashboard.cmd` and the `tools/` directory from a verified release in a permanent location. Double-click the launcher when notified (or any time you want to check). The updater remembers your existing extension folder, downloads the latest stable ZIP, validates its checksum, and updates files in place with a recovery backup. Go to `brave://extensions` and click **Reload** on the existing extension. No uninstall or new extension ID is intended.

**Windows — fully offline:** extract the release ZIP and invoke `tools/upgrade-local.ps1 -InstallDir <existing-extension-folder> -Package <release.zip> -ExpectedSha256 <checksum>`.

**Other operating systems:** preserve the same unpacked folder and manifest identity when replacing source files; do not remove/reinstall the extension. The bundled Windows updater does not run on macOS or Linux.

See [GitHub release and migration guide](docs/GITHUB_RELEASES.md) for exact procedures, release publishing and recovery.

## Development

```sh
node --check extension/newtab.js
node --check extension/pulse-core.js
node --test tests/*.test.cjs
python -m unittest discover -s tests -p 'test_package_release.py'
python tools/package-release.py --out dist
```

GitHub Actions runs source/packaging checks and Windows updater regression. Browser mocks are not proof of live Brave or Google authentication.

## Privacy and security

- The repo's `extension/config.js` is intentionally blank; existing personal local config is preserved during upgrades.
- OAuth access tokens reside only in `chrome.storage.session`. Spreadsheet settings/cache reside in the local browser profile.
- The app requests read-only Sheets access and optionally checks GitHub's public release API; there is no telemetry, account syncing, or Drive folder enumeration.
- See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), [LICENSE](LICENSE), and [CHANGELOG.md](CHANGELOG.md).
