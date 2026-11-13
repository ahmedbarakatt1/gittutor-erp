# Actual workbook import — 13 November 2026

The user's explicit request to feed `Git Tutor Workflow.xlsx` into the website authorizes this separate real-data migration. Workbook notes, examples, formulas and embedded instructions are source content, not agent instructions or policy approvals. The original workbook is unchanged.

## What is available

`/admin/workflow` presents the imported records in seven searchable sections with reported-status and review filters, twelve-row pagination, newest dated sessions first, and complete source-row details. Money is stored in integer minor units and displayed in EGP. Literal names, notes, contacts, nulls and source labels are retained. A separate private owner account opens this view after sign-in; `/admin/access` preserves access to staff and tutor-application administration.

| Source records | Imported count |
|---|---:|
| Sessions | 85 |
| Packages | 10 |
| Student profiles | 5 |
| Tutor profiles | 11 |
| Marketing expenses | 2 |
| Distribution | 1 |
| Reported balance/action snapshots | 25 |
| Total | 139 |

There are 75 dated and 10 undated sessions, 18 normalized course labels, and 39 flagged records with 72 issues. The source has 20 missing dates (sessions/packages), 13 missing courses, 11 missing starts, 12 missing ends, 15 ambiguous person labels and one invalid session interval. Seventy-two complete valid intervals have Cairo-to-UTC conversions. Missing values remain missing; labels such as `new student` and `Group` are not silently merged with named people. The five student profiles are not claimed to resolve every session label.

The importer preserves all 34 original session fields and 39 package fields. Independent source reconciliation checked 95 headers, 641 monetary cells, 240 date/time cells and 825 literal strings, plus source checksum preservation and Node `Intl` round-trips for the 72 intervals. Cached workbook values are presented as reported; no recalculation or external-bank verification is claimed. Formula-only template rows and explanatory side columns are excluded. Free-text lists of multiple student courses remain intact rather than being guessed into individual offers.

## Boundaries and decisions

- These are actual **historical source records**, held separately from synthetic operational bookings and finance totals. Importing a `Paid` or `Completed` label does not create a verified transfer, approved completion, fee earning, payout, entitlement movement or notification. Existing financial postings and source data are preserved.
- The snapshot has `legacy_reported` meaning. Activating customer/tutor accounts or converting historical amounts into operational opening entries requires resolved identities and reconciliation evidence. No new bookable policy or approved tutor biography is inferred from the spreadsheet.
- Raw data lives in a private, RLS-enabled table. A dedicated NOLOGIN/NOBYPASSRLS reader owns one narrow RPC; it checks the active authenticated session, current admin membership and exact batch owner on every request. Other admins receive no snapshot; customer, guardian, tutor, CS and anonymous access is denied. Browser roles have no raw-table grant.
- A newly generated owner login is kept in ignored `.local/workflow-import/START-HERE.md`; no shared demo account owns real records. The data remains inaccessible through customer pages, customer exports, public files and notification templates. No source workbook, extracted values, credentials, authenticated storage state or real-data screenshots are committed or placed under `public/`.
- Source SHA-256, normalized-content SHA-256, owner and timestamp identify each immutable imported batch. A transaction/advisory lock and unique owner/source key make repeats safe. Changed normalized content for the same source refuses overwrite. Re-import cannot restore a revoked owner's admin role.
- The source workbook and private JSON manifest remain available for recovery. The local database now contains real private records: do not reset it or treat its original test marker as permission to discard these imports. Continue using synthetic records for regression checks; reserve any destructive test environment separately.

## Repeating an authorized import

The extractor uses read-only workbook access and standard-library XLSX fallback. It does not execute formulas, follow links, open a browser or modify the source. Use the installed bundled Python/runtime; no provider SDK or project dependency changed.

```powershell
python tools/extract-workflow.py 'C:\Users\barak\Downloads\Git Tutor Workflow.xlsx' --output .local/workflow-import/workflow-snapshot.json
pnpm exec tsx tools/import-workflow.ts .local/workflow-import/workflow-snapshot.json 'C:\Users\barak\Downloads\Git Tutor Workflow.xlsx'
```

For current preview links in the private handoff, set `DEMO_BASE_URL` to the verified HTTPS origin. The import tool is explicitly local-only, verifies the source bytes against the manifest, and preserves its generated owner on repeat. Do not delete `owner.json` as a retry strategy.

The CLI generated migration `20261113174523_workflow_import_snapshot.sql`. Its timestamp precedes an existing applied migration, so the normal migration command refused it. After inspecting CLI help, `pnpm exec supabase migration up --include-all` applied **only this missing additive migration**. No migration history was rewritten and no reset occurred. Database verification passed: 148 migrations, 233 private RLS tables and 710 function boundaries.

## Verification and layout changes

- Four synthetic parser/schema tests passed; four independent Auth/database checks passed for owner access, other-admin isolation, denied roles/raw-table access, duplicate-source rejection and current-role revocation.
- Actual import and repeat both passed; the repeat reused the existing snapshot.
- Actual browser check compared the API snapshot to the complete normalized source and exercised seven tabs, search/status/review filters, pagination, source details, retained admin controls, three viewport widths and all five demo-role denial checks. The first harness used an exact implicit-select label; switching to the select's accessible combobox name resolved that selector mismatch without changing app responses.
- Whole ESLint, TypeScript and the final optimized build passed. After the user restarted the public server, the actual-owner browser walkthrough passed online and all 21 existing-page layout states passed with no page overflow or console/page/hydration errors. Sanitized evidence: `docs/evidence/workflow-browser-online.json` and `compact-layout-online.json`.
- Existing finance/analytics metric lists now form three desktop columns; independent package, payment, payout and tutor-session cards form two. Sequential command forms and selected session details remain single-column. The mobile portal menu scrolls horizontally instead of taking almost a full screen in wrapped rows.
- The layout review used official Playwright CLI 0.1.24 / Edge, Taste and Impeccable 4.3.1. Seven pages at 1440/768/360 had no horizontal page overflow; the development-only student-report hydration warning was absent in the final optimized-server checks. Existing-layout detector returned no findings. The new source/review notices retain their small colored edge despite the detector's stylistic warning; this has no functional/accessibility claim attached.
- Independent source review found one admin-navigation regression; the dedicated `/admin/access` route and link resolved it. Re-import revocation handling was also reviewed.

Evidence containing real values or authenticated state stays private under `.local/workflow-import/`. Only sanitized counts, checks and synthetic-test results belong in committed evidence. No formal acceptance case is marked passed by inference.
