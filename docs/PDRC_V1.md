# PDRC v1 read-only migration candidate

This document covers the **unreleased candidate** on the PDRC integration branch.
The existing v1.4.1 Google Sheets reader remains supported and is not removed by this work.

## Source selection

The new-tab extension uses the current read-only `spreadsheets.readonly` OAuth scope;
no Drive-wide or write permissions are requested.

**Legacy source:** Select the original master Google Sheet and `Projects` /
`History` tabs. Existing settings, account-selection logic and cache keys remain valid.

**PDRC source:** Select the *standardized master registry* Google Sheet and
set **Projects or Registry tab = Registry**. The extension recognizes the registry's
headers, resolves each enabled project's `source_ref` as a Google Sheet URL, and
reads the standardized project workbook. The legacy History tab setting is ignored
in this mode.

No project or account ID is bundled into the public repository or the release.
Never commit personal OAuth client IDs, Sheet URLs, or cached project records.

## Master Registry

The required tab has these headers:

`project_id | name | source_type | source_ref | contract_version | enabled`

Optional columns include `profile`, `migration_state`. IDs must be stable,
lowercase, unique and URL-safe. `enabled` accepts `TRUE` or `FALSE` (and 1/0 or yes/no).
Current candidate supports only `source_type=google_sheets` and `contract_version=1.0`.
Unknown or invalid sources are displayed as unavailable rather than fetched.
Requests to arbitrary domains or database endpoints are not permitted.

The extension limits the registry to 100 records and reads at most three linked
Google Sheets concurrently. All source reads use browser-memory OAuth tokens
and the established Google Sheets API hostname.

## Standardized project workbook

Each project source contains five tabs with stable headers, even when optional
record sets are empty:

* `Overview`: identity, lifecycle, phase, status, next action, update timestamp
* `Deliverables`: features, milestones, tasks, gates and optional verification details
* `History`: stable event IDs, project association, timestamps and progress updates
* `Evidence`: optional references supporting specific deliverables or validations
* `Source`: contract version, identity and *upstream provenance*

The `Source.source_ref` points to the **origin** (for example the original Project
Pulse Sheet or GitHub feature register). It is intentionally different from the
standardized Sheet URL stored in the Registry.

The reader rejects project ID or contract mismatches, duplicate deliverables and
invalid or future history events. It never assumes that "implemented" means
operationally verified. Missing evidence, lifecycle or deliverable data is
unknown, not failed, zero-percent or completed.

## Updates and migration cutover

This branch is a **read-only consumer**. It never modifies project workbooks.
Migrated staging records have `Source.snapshot_kind=snapshot`; the dashboard
labels them as imported snapshots so a successful fetch cannot be mistaken for
a fresh progress update.

External systems (ChatGPT, scheduled jobs, GitHub, Codex or other authorized
writers) must be switched to write the standardized source before live tracking
becomes authoritative. Keep the old writer and old workbook in place until:
1. The PDRC browser path is verified against disposable and staged data.
2. Identity and history totals reconcile, including migrated malformed rows.
3. Writers have switched and a newly written source event appears correctly.
4. The old workbook has a retained recovery copy and no further active writer.

No automatic duplication, merge or migration of private sheets occurs in the
extension. It reads current versions and caches successful results locally.
An inaccessible linked source leaves other projects usable and displays a
matching cached snapshot, if present. Changing Google account or source clears
both legacy and PDRC caches to prevent cross-account project disclosure.

## Verification

`node --test tests/*.test.cjs` checks schemas and existing auth/release behavior.

`python tests/browser-pdrc-smoke.py` exercises the actual new-tab JavaScript
and DOM with synthetic Google responses (no Google credentials), including
details, partial Sheet failures and account switching.

Real-world OAuth permissions, the user's installed Brave extension, and
live external-writer cutover are **separate unverified gates**.
