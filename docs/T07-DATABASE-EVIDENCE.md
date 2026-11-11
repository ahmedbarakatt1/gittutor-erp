# T07 private files — executed local evidence

The user explicitly prioritized advancing into T07 while broader T06 regression remained open. This evidence records the implemented local file slice; it does not close the T04–T06 checkpoint or claim live-provider readiness.

`20261111200236_private_file_pipeline.sql` was generated with pinned Supabase CLI 3.1.0 and applied through `pnpm exec tsx tools/supabase-local.ts migrate`. The first application rejected a PL/pgSQL CASE expression before committing the migration; the unapplied body was corrected and the CLI then reported successful application. Existing migration checksums and existing evidence rows were preserved.

The migration adds immutable upload intents, authorization tickets, upload attempts/object observations, scan attempts/results and publication history, plus separate controlled lifecycle/access projections. Current verified session and domain scope precede every command replay. Only restricted worker functions receive or attest Storage descriptors. Browser clients receive application paths; private objects use opaque generated keys and no overwrite. Downloads reauthorize before and after the actual Storage read. Raw tables remain unexposed with RLS, explicit command-owner permissions and no browser base grants.

`file_is_clean` is now the current evidence predicate used by payment evidence assertion, receipt selectors and plan-authority reads. Legacy `synthetic_development_metadata_no_bytes` rows remain isolated test/development fixtures and cannot download. New actual objects keep immutable legacy metadata `scan_state=pending`; the scan-result projection supplies current access without rewriting source history.

Executed using Node 24.22.1:

- Initial `pnpm exec vitest run tests/unit/files-validation.test.ts tests/integration/files.test.ts` failed as expected on missing validation module and missing actual Auth RPC (`.local/t07-files-red.log`).
- `pnpm exec vitest run tests/integration/files.test.ts`: initial scoped intent/idempotence check passed 1/1 (`.local/t07-files-first.log`).
- `pnpm exec vitest run tests/integration/files.test.ts tests/unit/files-validation.test.ts`: passed 8/8, 5.59s (`.local/t07-files-storage-first.log`). Actual private Supabase Storage bytes, concurrent identity retry/adoption, no public download, scan-gated content, lost worker acknowledgement/reclaimed lease with one immutable result, current tutor revocation, guardian materials access, unrelated learner denial, explicit shared publication/withdrawal and actual receipt submission were exercised. Infected fake scan results remained quarantined and nondownloadable.
- Byte checks exercised mismatched size/hash, deceptive HTML MIME, invalid filenames, receipt size bounds and bounded PPTX directory/entry/inflate/CRC checks, including traversal, macros and external relationship rejection. No uploaded active content is rendered on the application origin.

The fake scanner reads actual stored bytes and reports `integration_state=simulated`; this is not a live malware-scan attestation. The synthetic teaching `.txt` scenario was represented by a bounded valid-header/EOF PDF fixture, preserving the documented MIME allowlist. PPTX technical limits are 2,000 entries, 100 MiB aggregate expanded bytes, 20 MiB per entry and 200:1 maximum compression ratio, with no filesystem extraction.

Official documentation consulted on 11 November 2026: [Supabase changelog](https://supabase.com/changelog.md), [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), and [non-overwriting uploads](https://supabase.com/docs/reference/javascript/storage-from-upload). Existing SDK 2.119.0 and CLI 3.1.0 remain pinned. The implementation uses built-in Node ZIP inspection/zlib instead of acquiring a new archive dependency.

Browser results, calendar evidence, live ClamAV signature/admission checks, provider credentials, notification delivery and production retention remain separately owned evidence. No whole acceptance-case pass is inferred from these focused checks.

The explicit scan retry regression was then executed separately: `pnpm exec vitest run tests/integration/files.test.ts -t "scanner outage"` first failed because a new retry returned the old completed result (`.local/t07-scan-retry-red.log`). Additive migration `20261111202319_explicit_file_scan_retry.sql` preserves the original observation and creates a new scan generation/job for a fresh retry key; the same original key still replays. The focused check passed 1/1 in 1.30s (`.local/t07-scan-retry-green.log`). `pnpm exec tsx tools/supabase-local.ts verify` passed with 114 migrations, 154 private RLS tables and 521 function boundaries (`.local/t07-files-verify.log`). These counts are the executed point-in-time result, before subsequent independent milestones.

