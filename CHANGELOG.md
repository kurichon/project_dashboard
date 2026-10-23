# Changelog

## 1.4.1 — Account selection repair candidate

- Fix Connect Google reusing a rejected, unexpired account token instead of opening the chooser.
- Keep Change account available after sign-in failures and cancellations.
- Clear rejected sessions, account hints and old-account caches while preserving configuration.
- Require an explicit initial account choice; only renew a previously selected account silently.
- Add failed-account, chooser, cancellation, retry and privacy regression tests, plus rendered Chromium UI checks with simulated authorization.
- Preserve the read-only scope, existing OAuth client/redirect and GitHub-only update workflow. Live Google/Brave validation remains pending.

## 1.4.0 — GitHub-only development candidate (not a stable release)

- Keep Google Sheets, existing UI and migration behavior from Project Pulse; preserve the `projectPulse*` settings/cache keys.
- User-configurable private spreadsheet and tab names; optional configuration-only backup/import with no tokens or project rows.
- Version display plus an in-extension GitHub stable-release check and direct release-page notification. No browser-store update request, service worker or remote executable code.
- One versioned GitHub release ZIP with a standalone Windows in-place upgrade helper, guided GitHub downloader, checksums, and recovery backup.
- Add a maintainer-controlled GitHub Actions workflow that prepares a **draft** release from the reviewed default branch after CI; stable publication requires owner approval and actual Brave migration verification.
- Retire the unshipped Chrome Web Store package path (retained in Git history for future reconsideration).

## 1.3.0 — Unreleased development candidate

- Rename Project Pulse to Project Dashboard, with an unchanged legacy storage identity.
- Add custom Google Sheet URL/ID, optional tab mapping, local settings and GitHub release notices.
- Introduce an in-place helper that preserves private configuration and backup on Windows.
