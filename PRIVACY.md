# Privacy — Project Dashboard

Project Dashboard is an open-source, local-first Brave/Chromium new-tab extension.

**Your data:** The extension reads only a user-selected Google Spreadsheet using
`spreadsheets.readonly`. It does not create or modify Sheets or enumerate your
Google Drive files. Project rows are cached in that browser profile for offline
use, and the cache is cleared on changing the data source or Google account.
Browser profile access can expose cached statuses; do not use a shared profile
for sensitive project data.

**Configuration:** The selected Spreadsheet ID, Google OAuth Web Client ID,
tab names and chosen release repository are stored in `chrome.storage.local`.
The OAuth access token is held in `chrome.storage.session`. Tokens are not
included in release packages, and the extension does not collect telemetry.

**Updates:** When enabled, a release check contacts GitHub's public API for
the configured repository; it sends no Sheet ID or project rows. This is a
notification/check mechanism, **not** an automatic installer.

**External services:** Google supplies OAuth and the Sheets API; GitHub supplies
optional public release metadata. Their respective service policies apply.

**Scope:** A public source repository never contains personal configuration,
project history, or user data. Please do not post private Sheet IDs or tokens in
GitHub issues or pull requests.