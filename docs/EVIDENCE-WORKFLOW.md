# Acceptance execution evidence

The original `fixtures/acceptance-cases.json` catalogue is a plan. Leave its `planned` and `not_run` values intact until a real execution supports an update. A passing unit test for this validator does not pass the acceptance cases it inspects.

`tools/validate-evidence.ts` exports `validateEvidenceManifest(manifest, { rootDir, now? })` for runners and CI. Its CLI accepts a manifest path and optional workspace root:

```powershell
pnpm exec tsx tools/validate-evidence.ts fixtures/acceptance-cases.json
pnpm exec tsx tools/validate-evidence.ts artifacts/acceptance-results.json --root .
```

The CLI reads without rewriting the catalogue or artifacts, prints a JSON validation report, and exits nonzero on invalid evidence. Zero passed cases is a valid unexecuted catalogue, **not** release approval. The owning milestone still requires all its in-scope cases to pass.

## Recording a run

An execution runner must capture the actual command, checked-out full Git commit ID, environment, provider mode, UTC start/end instants, migration version, exit code and case results. It must record failed runs too; write a new immutable run artifact for a subsequent attempt instead of overwriting the failure. Do not fill in a passing result manually from expectations or a source review.

Each `passed` case needs the contract fields under `execution_evidence`, plus `run_id` and `artifact_sha256`. The artifact is a UTF-8 JSON report. `artifact_sha256` hashes the artifact's exact file bytes after final serialization. `artifact_path` and the declared `test_file` must resolve to files inside the selected workspace, including after resolving symlinks.

Artifact schema version `1` contains the same run metadata as the case's evidence and a `test_results` array. Aggregate each acceptance case exactly once. An aggregate can say `passed` only if all its required tests and parameter variants actually executed and passed. Skips, empty assertion bodies and mock-only substitutes for database/browser/provider layers do not qualify.

```typescript
type RunMetadata = {
  run_id: string;
  test_command: string;
  git_commit: string; // full 40-character hexadecimal commit ID
  environment: string;
  started_at: string; // UTC RFC3339, ending in Z
  finished_at: string; // UTC RFC3339, ending in Z
  exit_code: number;
  provider_mode: "none" | "fake" | "sandbox" | "approved_live";
  database_migration_version: string | null;
};
type RunArtifact = RunMetadata & {
  schema_version: 1;
  test_results: Array<{
    case_id: string;
    test_file: string;
    status: "passed" | "failed" | "blocked" | "skipped";
    assertion_count: number; // count supplied by actual executed test results
    layers: Array<{
      layer: string;
      environment: string;
      provider_mode: RunMetadata["provider_mode"];
      database_migration_version: string | null;
    }>;
  }>;
};
```

Every primary and supporting layer must be present exactly once for the case. Layer environment, provider mode and migration version must match that recorded run. SQL integration, SQL concurrency, HTTP authorization and recovery layers require a nonempty migration version because the pack defines those boundaries against persisted state. Provider-contract evidence cannot use provider mode `none`. A database-backed browser or provider test should declare its required SQL supporting layer in the case rather than concealing the dependency.

The validator checks provenance consistency and artifact integrity; it cannot prove a fabricated JSON report is truthful. The runner and retained test output remain the source of execution evidence. `approved_live` is a descriptive evidence value, not authorization to contact live providers or proof of provider readiness.

## Four financial release cases

Dispatch **Local application verification** with `financial_acceptance_revision` set to the full Git commit to test. A blank input runs the ordinary verification suite. The financial job checks out the requested revision, creates its own synthetic Supabase stack, runs GT-1317, GT-1403, GT-1405 and GT-1510, and uploads one sanitized JSON artifact, including on test failure. Catalogue changes require review of the resulting tests against each case.

On an existing marked disposable stack, run `node tools/evidence/record-financial.mjs . <full-commit>` from the checkout. The artifact records UTC times, the queried database migration, test outcomes and the assertion count captured from Vitest inside each executing worker. It includes full-file SHA-256 hashes for the test sources, local imports and instrumentation. Raw Vitest output stays in the ignored local directory. The isolated alternate-port harness validates its two loopback port substitutions against the committed helper.

GT-1317 retains its separate formal limitation. Its test demonstrates one real cancellation restoring a credit before class in a savepoint, followed by completion and a stale cancellation competing for the same reservation. The application requires different occurrence versions for those two terminal commands. A green regression is recorded independently of that acceptance decision.

The 19 November local attempt failed at synthetic sign-in before any case reached its assertions. A direct Auth check returned HTTP 504 while PostgreSQL remained reachable. The failed run remains available in the [original immutable report](evidence/acceptance/a4c588b8-ef3d-4707-86c2-960a55abb994.json).

## Validator verification, 2026-11-11

- `pnpm exec vitest run tests/unit/evidence.test.ts`: RED against the intentional stub, **33 failed**, exit 1; retained local output `.local/evidence-red.log`. This confirmed unsupported passes were not yet rejected.
- The same command after implementation: **33 passed**, exit 0; output `.local/evidence-green.log`.
- `pnpm exec eslint tools/validate-evidence.ts tests/unit/evidence.test.ts`: exit 0.
- `pnpm exec tsc --noEmit`: exit 0; output `.local/evidence-typecheck.log`.
- `pnpm exec tsx tools/validate-evidence.ts fixtures/acceptance-cases.json`: exit 0, `valid: true`, `passed: 0`, `not_run: 147`.

These checks verify the validator component. They do not change the catalogue or assert that the complete GT-1603 manifest/fixture acceptance case has passed.
