# Privacy — Project Dashboard

Project Dashboard is an open-source, local-first Brave/Chromium new-tab extension.

**Your data:** The extension reads only a user-selected Google Spreadsheet using
`spreadsheets.readonly`. It does not create or modify Sheets or enumerate your
Google Drive files. Project rows are cached in that browser profile for offline
use, and the cache is cleared on changing the data source or Google account.
Browser profile access can expose cached statuses; do not use a shared profile
for sensitive project data.

**Settings portability:** A user may explicitly export a JSON backup containing the configured Spreadsheet ID, Google OAuth public client ID, tab names, and release repository. The backup is downloaded locally and may identify the user's projects. It never contains an access token, account selection hint, cached project rows or History content. Treat the file as private. Import requires the user's confirmation, reauthentication, and clearing the current offline cache.

**Configuration:** The selected Spreadsheet ID, Google OAuth Web Client ID,
tab names and chosen release repository are stored in `chrome.storage.local`.
The OAuth access token is held in `chrome.storage.session`. Tokens are not
included in release packages, and the extension does not collect telemetry.

**Updates:** The extension can check published stable release metadata from the public GitHub API without sending your Sheet ID, project data, or tokens. It cannot install updates itself. If you separately launch the Windows updater, that local script contacts GitHub for a release ZIP and checksum and updates the existing unpacked extension directory. The updater remembers only your chosen local installation path under `%LOCALAPPDATA%` and does not access your Google account.

**External services:** Google supplies OAuth and the Sheets API; GitHub supplies
optional public release metadata. Their respective service policies apply.

**Scope:** A public source repository never contains personal configuration,
project history, or user data. Please do not post private Sheet IDs or tokens in
GitHub issues or pull requests.
