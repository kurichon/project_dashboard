# Project Dashboard — Chrome Web Store release procedure

**State:** v1.4.0 development candidate. Preparing a package is not publication or release qualification.

## Distribution authority

- GitHub `kurichon/project_dashboard` stores source, tests, MIT license, changelog, and tagged source releases.
- The **Chrome Web Store** owns distribution of the installed extension and automatic browser updates. Never fetch/run executable scripts from GitHub at runtime.
- GitHub release metadata is optional release *news*, not an installer or proof that a store update is live. Ideally publish the GitHub announcement only when the Web Store update is accepted and visible.
- `tools/upgrade-local.ps1` remains a legacy **development-only** migration tool. It is never inside the Web Store ZIP.

## Owner-controlled prerequisites

1. Register a Chrome Web Store developer account and complete its one-time registration payment if required. Enable account 2-step verification.
2. Build `python tools/package-release.py --out dist`; upload **only** `dist/project-dashboard-webstore-vX.Y.Z.zip` to the developer dashboard. Its `manifest.json` is at the ZIP root.
3. Set a publisher identity and listing. Use the 128×128 icon, a screenshot of the app with **synthetic** project rows, description, and a link to the current [public privacy policy](https://github.com/kurichon/project_dashboard/blob/main/PRIVACY.md).
4. Complete the accurate Chrome Web Store privacy declarations: this extension reads user-selected Google Sheets with the read-only Sheets OAuth scope, caches project summaries in the user's browser profile, and optionally reads GitHub release metadata. No advertising, telemetry, or data sales.
5. Before submitting, verify the extension's store-assigned ID and the exact OAuth redirect `https://<STORE_EXTENSION_ID>.chromiumapp.org/`. Each user's OAuth Web client must authorize the redirect used by their installed extension. Do not upload OAuth secrets or a private manifest key.
6. Run real Brave/Chrome install, OAuth, settings import, update, failure recovery, and persistence tests on a **private/unlisted test channel**, where applicable. Do not call a review approval or green CI a browser migration test.
7. Submit for review. Following approval and a verified staged installation, announce a stable release on GitHub. Chrome Web Store handles upgrades for installations made through that store.

## Migrate a current unpacked Project Pulse / Project Dashboard installation

Store extension identity may differ from the unpacked extension. Settings in `chrome.storage.local` do **not** automatically cross that boundary.

1. **Keep the original extension installed.** Upgrade that unpacked installation to this version *in place* with the legacy local updater if necessary (no removal/reinstallation). This is the final local migration helper step, not the public update method.
2. Open the original extension's Settings and click **Export settings**. Store the file privately. It contains the Spreadsheet ID and OAuth Client ID, but **not** tokens, Google account authentication state, or project cache/history.
3. Install the separately published Project Dashboard from the Chrome Web Store. Verify publisher and extension ID.
4. In the store-installed extension, use **Import settings** and select the backup file. Confirm replacement, then **Connect Google**. The store installation's redirect URL may need to be newly authorized with the Google OAuth client.
5. Compare project cards and history with the original extension. After the store copy is verified, **disable** the unpacked copy to avoid two extensions overriding the browser new-tab page. Do not remove it until a backup and successful real migration are established.
6. Future releases update automatically through the browser. The in-app **Check updates** button compares GitHub release news; if a new version is confirmed, it may ask the browser to check the store. An unpacked extension never obtains store updates automatically.

**No way around identity:** Putting a ZIP on GitHub or keeping the unpacked folder path stable does not migrate storage to a different store extension ID. Do not promise otherwise.

## Release verification gates

- Sanitation check: source and release ZIP contain no Sheet data, auth tokens, account IDs, or private keys; distributed `config.js` is blank.
- Store ZIP includes root `manifest.json`, three PNG icon sizes, packaged scripts and CSS; no updater, no dev fixtures, no build infrastructure, and no external executable code.
- Correct declared Chrome permissions: `identity`, `storage`, and only the required Sheets/GitHub host permissions.
- Settings export is a whitelisted config-only JSON; import rejects unknown formats, unexpected fields, invalid IDs and oversized files without replacing the current state.
- Settings and selected Sheet survive a store update in the same extension ID. New extension ID migration works via explicit export/import with a new OAuth session.
- GitHub newer-than-installed vs store not-yet-available is represented accurately, never as an installed update.
- Real Chrome Web Store browser installation and rollout validation is required before public v1.0 or later release qualification.

## Not in scope

- Automatic GitHub ZIP installation, self-updating JavaScript, local native helper in public distribution, a service to sync private project rows, or a Drive folder-browsing permission.
