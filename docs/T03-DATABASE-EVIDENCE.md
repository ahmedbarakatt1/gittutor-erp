# T03 database evidence

Local evidence recorded on 2026-11-11. This supplements `IMPLEMENTATION-STATUS.md`; it does not mark later booking, money, export or provider acceptance cases complete.

## Implementation and boundaries

The pinned Supabase CLI 3.1.0 generated the additive migration files `20261111120545_catalog_policy.sql`, `20261111121628_catalog_command_grants.sql`, `20261111123015_catalog_transport_contract.sql`, and `20261111123430_catalog_policy_integer_validation.sql`. Previously applied migrations were preserved. The actual isolated Supabase project on loopback ports 54321/54322 supplies Auth, PostgREST and PostgreSQL; the native PostgreSQL T01 baseline remains separate.

Pricing bundles and policy versions have immutable approved content, approver identity, approval/effective instants, environment provenance, schema version, content hash and optional source-manifest lineage. Published offer bindings are immutable. New explicitly approved pricing versions may change rates without repricing an earlier offer. The canonical seed preserves group customer prices 57,500/55,000/50,000 minor units and the supplied private compensation ranges.

Compensation JSON is stored in `finance_private.pricing_compensation` and `finance_private.policy_compensation_terms`. Customer queries use explicit field projections; customer terms hashes are computed from that customer projection, never private compensation. Only `list_public_offers` and `get_public_tutor` are executable by `anon`. Authenticated browser roles have no base-table access, including admin sessions. Privileged RPCs recheck the current database admin role and actual Auth session before consulting an idempotent result. Mutations atomically persist the request hash, result, audit event and outbox event.

`pg_jsonschema` validates a versioned database snapshot of `contracts/runtime/catalog-schemas.json`; private SQL semantic validators additionally enforce complete approval requirements and cross-field rules. Drafts can be incomplete but reject unknown fields and malformed supplied values. Explicit zero and false remain meaningful. The shared malformed vectors compare TypeScript and actual PostgreSQL behavior. The Supabase [extension documentation](https://supabase.com/docs/guides/database/extensions/pg_jsonschema) was consulted for `jsonb_matches_schema(schema json, instance jsonb)`; the isolated PostgreSQL image provides extension version 0.3.3.

The nested package contract's `package_policy_version_id` is derived from its owning policy row. Supplied mismatching IDs are rejected; a matching saved ID may be echoed. Draft offers may refer to draft policies, allowing package eligibility to be selected before approval. Approval validates eligibility references and freezes the resulting content. Publication requires all referenced commercial versions to be approved, compatible and valid for the persisted server environment. Production rejection is tested against the same private gate without changing the shared disposable environment marker.

Tutor publication approves an exact profile version. Editing or rejecting a later draft leaves the previous approved public biography intact. Sensitive profile approval requires a current admin and current tutor role.

## Synthetic seed

`tools/catalog-seed.ts` is invoked by `tools/supabase-local.ts seed`. It first requires the ignored project-local connection manifest and the persisted `test` / `git-tutor-supabase-local-v1` marker. It authenticates the real synthetic admin, serializes seeds with a database advisory lock and inserts only absent deterministic drafts. Existing rows must match canonical identity, content hash and provenance; conflicts stop rather than overwrite user work. Draft inserts are audited and enqueue unique synthetic events. Genuine actor RPCs perform all commercial approval and publication.

The seed publishes two pricing bundles, four policies and eight offers across Calculus, Computer Science, Engineering, Business and Business Intelligence. Calculus group offers retain target sizes 2/3/4 with capacity 4; group2/3 packages are disabled, and group4 carries the canonical package contract. The remaining offers reuse the approved private bundle and policy. The default tutor is published only from the exact canonical draft. An unknown pending draft is preserved and rejected, and an already approved profile is preserved. Final database-state checks reject a misleading success report if a canonical record has been retired.

The fixed seed clock and deterministic UUID namespace make repeated seeds stable. `source_manifest_version` records the supplied policy source version. Credentials remain only in ignored local files; no credential or email-token values are evidence artifacts.

## Executed checks

| Command | Observed result |
|---|---|
| `pnpm exec tsx tools/catalog-seed.ts` | Exit 0; initial four canonical published offers established. |
| `pnpm exec vitest run tests/integration/catalog-privacy.test.ts -t 'catalog seed'` before the subject extension | RED: 1 failed, 11 filtered tests; expected eight canonical offers, observed four. `.local/t03-seed-red.log`. |
| Same seed regression after the extension | GREEN: 1 passed, 11 filtered tests. Runs the seed twice, checks eight published offers and four required subject names, compares immutable offer snapshots and audit count. `.local/t03-seed-green.log`. |
| `pnpm exec vitest run tests/integration/catalog-privacy.test.ts tests/integration/catalog-transport.test.ts` | 18/18 passed before the final integer-range parity addition; 20.98 seconds. `.local/t03-database-green.log`. |
| `pnpm exec eslint tools/catalog-seed.ts tools/supabase-local.ts tests/integration/catalog-privacy.test.ts` | Exit 0, no diagnostics. |
| `pnpm typecheck` | Exit 0. |
| `pnpm exec tsx tools/supabase-local.ts verify` | Exit 0: nine migrations, 25 private RLS tables, 69 function boundaries. |
| `pnpm exec vitest run tests/unit/pricing.test.ts tests/unit/policies.test.ts tests/integration/catalog-privacy.test.ts tests/integration/catalog-transport.test.ts` after the final parity fixes | 134/134 passed across four files: 116 unit checks, 12 catalog integration checks and six transport integration checks; 10.52 seconds. The SQL parity check includes 71 policy and 15 pricing vectors. `.local/t03-parity-combined-green.log`, independently read after the tooling owner executed it. |

The initial command-wrapper grant ordering defect was observed in actual PostgREST calls and corrected by the separate grants migration. Independent review then reproduced six failing transport tests: new creates returned 200, and updates committed but failed strict result parsing. The transport migration now returns 201 for new creates, 200 for replays, and the documented update projection, including safe projection of old saved results without rewriting command history. Its real RPC/module suite passed 6/6. Both the optimistic-version race and idempotent replay use actual independent HTTP/database transactions.

The last review reproduced an integer-range SQL cast overflow and a TypeScript development-provenance mismatch. These were corrected additively, with shared negative vectors. The final combined check in the table passed after these fixes.

## Acceptance scope and remaining work

The executed catalog cases cover GT-1602 explicit values/completeness, GT-1604 deterministic catalog seed behavior, GT-1608 local synthetic provenance, the T03 portions of GT-1211 immutable commercial versions and GT-1212 customer confidentiality, and the T03 exact-fee validation foundation of GT-1203/GT-1204. These are not claims that the complete later acceptance scenarios have passed.

Actual occurrence fee agreement records and scheduling are T04. Public availability truthfully reports zero scheduled occurrences and no next start until that work exists; date-filtered availability returns no matches. Booking quote snapshots, payments, entitlement conservation, cancellation remedies, email/export/download confidentiality and T04–T06 integrated acceptance remain later milestones. Hosted deployment still requires configured live infrastructure and a nonsynthetic approved commercial policy; local publication is not live-provider readiness.
