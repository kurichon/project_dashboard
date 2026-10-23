# Changelog

## 1.4.0 — development candidate (not a published store release)

- Prepare a separate Chrome Web Store ZIP with root manifest and bundled app icons, without the offline updater.
- Add browser-managed update event handling and manual store update requests only after GitHub announces a newer release.
- Add settings-only JSON export/import for migrations between extension IDs; exclude access tokens, cached project data, and account hints.
- Preserve existing Project Pulse storage identities and local fallback updater for one-time developer migration.
- Add browser simulation, source validation, packaging contracts and store release guidance.



## 1.3.0 — Development candidate (unreleased)

- Rebrand Project Pulse as **Project Dashboard**, preserving legacy browser
  storage keys and a supported in-place update from the old manifest name.
- Configure your own private Google Sheet URL/ID and optional tab mappings.
- Store local settings separately from distributable source files.
- Add GitHub public-release notification and a manual update check; no automatic
  installation or remote code execution.
- Add source isolation, malformed-history handling, and migration smoke checks.
- Add source-only MIT licensing, privacy/security documentation and CI checks.

This is not a verified production release until the real Brave v1.2 → 1.3
upgrade, OAuth and local update helper are exercised on the intended Windows PC.
