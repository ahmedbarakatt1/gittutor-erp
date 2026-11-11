import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateEvidenceManifest } from "../../tools/validate-evidence";

describe("GT-1603 acceptance execution evidence", () => {
  let rootDir: string;
  const now = new Date("2026-11-11T12:00:00.000Z");
  const metadata = {
    run_id: "84d00032-8053-4de2-9a96-bce7f6cd0710",
    test_command: "pnpm exec vitest run tests/unit/accepted.test.ts",
    git_commit: "a".repeat(40),
    environment: "isolated_test",
    started_at: "2026-11-11T10:00:00.000Z",
    finished_at: "2026-11-11T10:00:01.000Z",
    exit_code: 0,
    provider_mode: "none",
    database_migration_version: null as string | null,
  };

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "git-tutor-evidence-"));
    mkdirSync(join(rootDir, "tests/unit"), { recursive: true });
    mkdirSync(join(rootDir, "artifacts"));
    writeFileSync(join(rootDir, "tests/unit/accepted.test.ts"),
      'it("GT-1603 real assertion", () => { expect(1).toBe(1); });');
  });
  afterEach(() => rmSync(rootDir, { recursive: true, force: true }));

  function fixture(layer = "unit", supporting: string[] = []) {
    const evidence = { ...metadata, artifact_path: "artifacts/run.json", artifact_sha256: "" };
    const result = {
      case_id: "GT-1603", test_file: "tests/unit/accepted.test.ts", status: "passed",
      assertion_count: 1,
      layers: [layer, ...supporting].map((name) => ({
        layer: name, environment: metadata.environment, provider_mode: metadata.provider_mode,
        database_migration_version: metadata.database_migration_version,
      })),
    };
    const artifact = { schema_version: 1, ...metadata, test_results: [result] };
    const testCase = {
      id: "GT-1603", layer, supporting_layers: supporting,
      test_file: "tests/unit/accepted.test.ts", implementation_status: "implemented",
      execution_status: "passed", execution_evidence: evidence,
    };
    const manifest = { cases: [testCase] };
    function saveArtifact() {
      const bytes = JSON.stringify(artifact);
      writeFileSync(join(rootDir, evidence.artifact_path), bytes);
      evidence.artifact_sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    saveArtifact();
    return { evidence, result, artifact, testCase, manifest, saveArtifact };
  }
  function validate(manifest: unknown) {
    return validateEvidenceManifest(manifest, { rootDir, now });
  }

  it("accepts a bound, executed unit result without mutating the manifest", () => {
    const { manifest } = fixture();
    const before = JSON.stringify(manifest);
    expect(validate(manifest)).toMatchObject({ valid: true, passed: 1, errors: [] });
    expect(JSON.stringify(manifest)).toBe(before);
  });

  it("preserves the supplied catalogue's planned/not_run status", () => {
    const manifest = JSON.parse(readFileSync("fixtures/acceptance-cases.json", "utf8"));
    const before = JSON.stringify(manifest);
    expect(validate(manifest)).toMatchObject({ valid: true, passed: 0, not_run: 147 });
    expect(JSON.stringify(manifest)).toBe(before);
  });

  it("rejects a passed declaration with no execution evidence", () => {
    const { manifest, testCase } = fixture();
    Object.assign(testCase, { execution_evidence: null });
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "EVIDENCE_REQUIRED" }));
  });

  it.each(["planned", "stubbed"])("rejects %s implementation marked passed", (status) => {
    const { manifest, testCase } = fixture();
    testCase.implementation_status = status;
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "NOT_IMPLEMENTED" }));
  });

  it("requires an existing test file containing its case identity", () => {
    const { manifest } = fixture();
    writeFileSync(join(rootDir, "tests/unit/accepted.test.ts"), "export {};");
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "TEST_CASE_MISSING" }));
    rmSync(join(rootDir, "tests/unit/accepted.test.ts"));
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "TEST_FILE_MISSING" }));
  });

  it.each([
    ["git_commit", "abc123"], ["test_command", " "], ["environment", ""],
    ["provider_mode", "live"], ["exit_code", 1], ["exit_code", "0"],
    ["started_at", "2026-02-30T10:00:00Z"], ["started_at", "2026-11-11T12:00:00+02:00"],
    ["finished_at", "2026-11-11"], ["run_id", ""], ["artifact_sha256", "abc"],
  ])("rejects malformed evidence field %s=%s", (key, value) => {
    const { manifest, evidence } = fixture();
    Object.assign(evidence, { [key]: value });
    expect(validate(manifest).valid).toBe(false);
  });

  it("rejects reversed and future execution intervals", () => {
    const { manifest, evidence } = fixture();
    evidence.finished_at = "2026-11-11T09:00:00.000Z";
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "TIME_ORDER" }));
    evidence.finished_at = "2026-11-12T10:00:00.000Z";
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "FUTURE_EVIDENCE" }));
  });

  it("rejects absent, modified, or non-JSON artifacts", () => {
    const { manifest, evidence } = fixture();
    writeFileSync(join(rootDir, evidence.artifact_path), "not a report");
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "ARTIFACT_HASH_MISMATCH" }));
    evidence.artifact_sha256 = createHash("sha256").update("not a report").digest("hex");
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "ARTIFACT_INVALID" }));
    rmSync(join(rootDir, evidence.artifact_path));
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "ARTIFACT_MISSING" }));
  });

  it.each(["run_id", "test_command", "git_commit", "environment", "started_at", "provider_mode"])(
    "rejects an artifact from a different recorded run (%s)", (key) => {
      const { manifest, artifact, saveArtifact } = fixture();
      Object.assign(artifact, { [key]: "different-run" });
      saveArtifact();
      expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "RUN_MISMATCH" }));
    },
  );

  it("rejects wrong case, skipped results and empty assertion counts", () => {
    const { manifest, result, saveArtifact } = fixture();
    result.case_id = "GT-1604";
    saveArtifact();
    expect(validate(manifest).valid).toBe(false);
    result.case_id = "GT-1603";
    result.status = "skipped";
    saveArtifact();
    expect(validate(manifest).valid).toBe(false);
    result.status = "passed";
    result.assertion_count = 0;
    saveArtifact();
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "NO_ASSERTIONS" }));
  });

  it("requires every primary and supporting layer, without duplicate substitutes", () => {
    const { manifest, result, saveArtifact } = fixture("unit", ["e2e"]);
    result.layers[1].layer = "unit";
    saveArtifact();
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "LAYER_MISSING" }));
  });

  it("rejects layer environment and provider evidence inconsistent with the run", () => {
    const { manifest, result, saveArtifact } = fixture();
    result.layers[0].environment = "production";
    result.layers[0].provider_mode = "approved_live";
    saveArtifact();
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "LAYER_RUN_MISMATCH" }));
  });

  it("requires database migration evidence on SQL and authorization layers", () => {
    for (const layer of ["sql_integration", "sql_concurrency", "http_authorization", "recovery"]) {
      const { manifest } = fixture(layer);
      expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "MIGRATION_REQUIRED" }));
    }
  });

  it("accepts database evidence only with matching migration and target metadata", () => {
    const { manifest, evidence, artifact, result, saveArtifact } = fixture("sql_integration");
    evidence.database_migration_version = "20261111000000";
    artifact.database_migration_version = "20261111000000";
    result.layers[0].database_migration_version = "20261111000000";
    saveArtifact();
    expect(validate(manifest).valid).toBe(true);
    result.layers[0].database_migration_version = "20261110000000";
    saveArtifact();
    expect(validate(manifest).valid).toBe(false);
  });

  it("does not accept a provider-contract result with provider mode none", () => {
    const { manifest } = fixture("provider_contract");
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "PROVIDER_REQUIRED" }));
  });

  it("rejects evidence paths escaping the selected workspace", () => {
    const { manifest, evidence } = fixture();
    evidence.artifact_path = "../outside.json";
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_PATH" }));
  });

  it("rejects malformed catalogues and duplicate case identifiers", () => {
    expect(validate(null).valid).toBe(false);
    expect(validate({ cases: [null] }).valid).toBe(false);
    const { manifest } = fixture();
    manifest.cases.push(manifest.cases[0]);
    expect(validate(manifest).errors).toContainEqual(expect.objectContaining({ code: "DUPLICATE_CASE" }));
  });
});
