# GitHub Releases — Project Dashboard

**Current distribution:** GitHub-only; Chrome Web Store support is deferred. Only the source and public release package belong in this repository. Google Sheets and user configuration stay private.

## Publish a release (maintainer)

1. Merge an accepted change to `main`, confirm the source and Windows-updater CI jobs pass, and run a real Windows/Brave in-place upgrade with a disposable copy before calling a release stable. CI and browser mocks do not replace this real test.
2. Ensure `extension/manifest.json` has the version you intend to publish. Verify the release ZIP has no private manifest key, OAuth client ID, Sheet ID or user data.
3. In **Actions → Prepare GitHub release → Run workflow**, enter `vX.Y.Z` matching the extension manifest version, choose **main**, and run it. The workflow reruns source/package checks and Windows upgrade checks, builds the deterministic ZIP and `SHA256SUMS.txt`, and creates a **draft** GitHub release containing both assets. It does not publish automatically.
4. Inspect the draft assets, SHA-256 and release notes. If real Brave verification is still missing, keep it as a draft. Publish the verified version when the owner approves it; only stable, published releases appear in the extension's update check.
5. For a preview without a stable announcement, publish the draft with **Set as a pre-release**, and do not label it a stable update. The GitHub latest-stable endpoint excludes prereleases.

Do **not** modify or force-push a published release tag. Make a new version for corrections. A GitHub release publishes public code and assets; never commit personal settings backups.

## Install for the first time

Download the published `project-dashboard-vX.Y.Z.zip` asset and the accompanying `SHA256SUMS.txt`. Verify its hash before extracting if installing manually. Extract into a **permanent** directory. In Brave navigate to `brave://extensions`, enable Developer mode, choose **Load unpacked** and select the `extension/` directory. Connect your own private Google Spreadsheet through Settings. Keep the installation directory and browser profile.

## Update an existing unpacked extension

**Never click Remove or load a second extension as a substitute for an upgrade.**

- If you downloaded the newest ZIP manually, extract it and run `tools/upgrade-local.ps1` with the existing installation path, the release ZIP, and the SHA-256 from `SHA256SUMS.txt`. The helper preserves the local `config.js`, embedded manifest key (when present), extension folder, and recovery backup.
- For subsequent updates on Windows, keep a copy of **Update Project Dashboard.cmd** and the adjacent `tools/` scripts in a safe, permanent directory. Double-click the launcher. On first run, select the original installed extension directory. It remembers only the local path under `%LOCALAPPDATA%\ProjectDashboard`, contacts the public GitHub latest-stable Release API, downloads the ZIP and checksums, verifies the SHA-256, and invokes the same in-place updater. On later runs, it reuses the saved path. An updater run is always initiated by the user, not by the extension.
- After success, open `brave://extensions` and choose **Reload** on the same extension. Check that its ID is unchanged and the Sheet, preferences, and cards are still correct. Google login may need to be renewed after a reload.
- If a downloaded ZIP cannot be verified, the script refuses to install it. If an upgrade fails during replacement, the upgrade helper attempts restoration from its recovery backup.

This is **not silent auto-installation**: Chromium/Brave unpacked extensions do not have permission to launch a local updater or replace their own extension files. A GitHub-only package does not create browser-managed auto-updates on Windows.

## Release checks

- Tag must be `vX.Y.Z` and match the numeric `manifest.json` version.
- GitHub Actions default token: read-only except for the release-draft job, which has `contents: write`.
- No release builds on unreviewed PRs or unverified tags; a published stable release is an owner decision after real-environment testing.
- Offline/invalid-metadata cases must retain the existing installation and settings.
