# Project Dashboard

**A lightweight, privacy-first new-tab dashboard for project status and next actions.**

Project Dashboard runs as a local Brave/Chromium Manifest V3 extension. You
choose a private Google Sheet for your projects; neither your data nor account
configuration belongs in this public repository.

**Release state:** v1.3.0 is a *development candidate*, not yet a qualified
public release. It is built from the functional Project Pulse v1.2.0 baseline.

## What it does

- Reads project status, next action and updated time from a chosen private
  Google Spreadsheet; displays history activity over the last seven days.
- Stores display/source settings in browser storage, separate from source code.
- Uses read-only Google Sheets OAuth with session-only access tokens.
- Keeps a source-specific offline cache and validates spreadsheet headers.
- Checks published **stable** GitHub release metadata (daily or via a button)
  and links to the release page. **Checking is not installing.**

## Set up a new installation

1. Extract the repository or release package to a permanent folder.
2. Go to `brave://extensions`, enable **Developer mode**, select **Load unpacked**
   and choose the `extension/` folder.
3. Open a new tab and choose **Settings**. Copy the displayed extension redirect URL.
4. For your own sideloaded build, configure a Google Cloud OAuth *Web application*
   client with that exact redirect URL, enable Sheets API, and authorize the Google
   account permitted to view your Sheet. Do not embed a Web client secret.
5. Enter your OAuth **client ID**, private Spreadsheet URL or ID, and optionally
   customize the `Projects` and `History` tab names. Click **Save settings**,
   then **Connect Google**.

Existing project sheet headers:

- Projects: `Project | Status | Next | Updated`
- History: `Timestamp | Project` (optional; blank History tab setting disables counts)

A Drive **folder** picker is not included: it would require broader permissions
than reading a single selected Sheet. Other users can use their own Spreadsheet
URL or ID without publishing its contents.

## Upgrade an existing Project Pulse installation

**Do not uninstall, remove or load a second copy**. Upgrade the existing unpacked
extension directory to preserve the browser's extension identity and local settings.

1. Retain your currently installed extension folder and current browser profile.
2. Obtain a verified release ZIP containing `extension/` and `tools/`.
3. With Windows PowerShell, run:

   ```powershell
   powershell.exe -NoProfile -File "<extracted>\tools\upgrade-local.ps1" -InstallDir "<YOUR_INSTALLED_EXTENSION_FOLDER>" -Package "<RELEASE_ZIP>"
   ```

4. The helper retains the existing extension manifest `key` (if one exists),
   your original local `config.js`, and a dated recovery copy of application
   files. In `brave://extensions`, select **Reload** on the *same* extension.
5. Verify Sheets access, cards, history counts, settings and update notice.

The in-place helper allows either the legacy manifest name **Project Pulse** or
**Project Dashboard** and refuses unrelated extensions. Older `projectPulse*`
storage keys are intentionally kept for migration; they are **not** a branding bug.

If upgrading without a stable extension identity, verify the existing extension
ID and Chrome OAuth redirect before/after. Replacing files in the same unpacked
folder is not equivalent to uninstalling. Real Brave/OAuth behavior must be
verified on your device.

## Project structure

- `extension/` — installable unpacked extension code; `config.js` is a blank
  migration compatibility shim.
- `tools/upgrade-local.ps1` — offline, user-triggered Windows in-place updater.
- `tools/package-release.py` — deterministic sanitized ZIP + SHA-256 creation.
- `tests/` — unit, browser-mocked and Windows-updater tests.
- `.github/workflows/ci.yml` — static/unit and updater regression checks.

## Developing and checking changes

```sh
node --test tests/pulse-core.test.cjs
node --check extension/newtab.js
node --check extension/pulse-core.js
python tools/package-release.py --out dist
```

`python tests/browser-smoke.py` exercises the UI against intercepted network
responses and simulated extension APIs, provided Playwright and Chromium are
installed. It does **not** validate real OAuth, extension installation, or
Brave runtime behavior. Release qualification remains a separate gate.

## Privacy and open source

The source is MIT-licensed (see [LICENSE](LICENSE)). Read [PRIVACY.md](PRIVACY.md)
and [SECURITY.md](SECURITY.md). Never commit credentials, tokens, actual Sheet
IDs, projects/history exports or generated browser settings. The default release
repository is this public, code-only GitHub repository.

**Known limitation:** Each sideloaded user needs an OAuth Web client permitted
for their installed redirect URL. A broadly distributed one-click installation
requires separately qualified OAuth and browser-store distribution. The updater
is notification-first, not an automatic executable downloader.