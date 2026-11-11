import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;
export type EvidenceIssue = { code: string; path: string; message: string };
export type EvidenceValidation = {
  valid: boolean;
  passed: number;
  not_run: number;
  errors: EvidenceIssue[];
};

const layers = new Set([
  "unit", "e2e", "http_authorization", "provider_contract", "recovery",
  "sql_concurrency", "sql_integration",
]);
const databaseLayers = new Set(["sql_concurrency", "sql_integration", "http_authorization", "recovery"]);
const providerModes = new Set(["none", "fake", "sandbox", "approved_live"]);
const executionStates = new Set(["not_run", "passed", "failed", "blocked", "skipped"]);
const metadataFields = [
  "run_id", "test_command", "git_commit", "environment", "started_at", "finished_at",
  "exit_code", "provider_mode", "database_migration_version",
] as const;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function utcTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  // Date.parse normalizes some invalid days, so compare calendar components too.
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? time : null;
}
function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Validates recorded evidence, never executes tests or changes catalogue status. */
export function validateEvidenceManifest(
  manifest: unknown,
  options: { rootDir: string; now?: Date },
): EvidenceValidation {
  const errors: EvidenceIssue[] = [];
  let passed = 0;
  let notRun = 0;
  const issue = (code: string, path: string, message: string) => errors.push({ code, path, message });
  const finish = () => ({ valid: errors.length === 0, passed, not_run: notRun, errors });
  let root: string;
  try { root = realpathSync(options.rootDir); }
  catch { issue("ROOT_MISSING", "$", "The selected workspace does not exist."); return finish(); }
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) {
    issue("INVALID_CLOCK", "$", "Validation requires a valid current instant.");
    return finish();
  }
  if (!object(manifest) || !Array.isArray(manifest.cases)) {
    issue("MANIFEST_INVALID", "$", "Expected a manifest object with a cases array.");
    return finish();
  }

  function readFile(path: unknown, at: string, missingCode: string): Buffer | null {
    if (!nonempty(path) || path.includes("\0") || isAbsolute(path) || !inside(root, resolve(root, path))) {
      issue("UNSAFE_PATH", at, "Use a relative file path inside the selected workspace.");
      return null;
    }
    try {
      const resolved = realpathSync(resolve(root, path));
      if (!inside(root, resolved)) {
        issue("UNSAFE_PATH", at, "The path resolves outside the selected workspace.");
        return null;
      }
      const stat = statSync(resolved);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) {
        issue(missingCode, at, "Expected a regular evidence file no larger than 20 MiB.");
        return null;
      }
      return readFileSync(resolved);
    } catch {
      issue(missingCode, at, "The declared file is absent or unreadable.");
      return null;
    }
  }

  const seen = new Set<string>();
  for (const [index, item] of manifest.cases.entries()) {
    const at = `cases[${index}]`;
    const errorsBeforeCase = errors.length;
    if (!object(item) || typeof item.id !== "string" || !/^GT-\d{3,4}$/.test(item.id)) {
      issue("CASE_INVALID", at, "Each case needs a stable GT identifier.");
      continue;
    }
    if (seen.has(item.id)) issue("DUPLICATE_CASE", `${at}.id`, "Case identifiers must be unique.");
    seen.add(item.id);
    if (typeof item.execution_status !== "string" || !executionStates.has(item.execution_status)) {
      issue("STATUS_INVALID", `${at}.execution_status`, "Unknown execution status.");
      continue;
    }
    if (item.execution_status === "not_run") notRun++;
    // Evidence for a failed or blocked run is retained, never upgraded by validation.
    if (item.execution_status !== "passed") continue;
    if (item.implementation_status !== "implemented") {
      issue("NOT_IMPLEMENTED", `${at}.implementation_status`, "A passing case must be implemented.");
    }
    const source = readFile(item.test_file, `${at}.test_file`, "TEST_FILE_MISSING");
    if (source && !new RegExp(`\\b${item.id}\\b`).test(source.toString("utf8"))) {
      issue("TEST_CASE_MISSING", `${at}.test_file`, "The test source must identify this acceptance case.");
    }
    const requiredLayers: string[] = [];
    const requestedLayers = [item.layer, ...(Array.isArray(item.supporting_layers) ? item.supporting_layers : [])];
    if (!Array.isArray(item.supporting_layers)) {
      issue("LAYERS_INVALID", `${at}.supporting_layers`, "Supporting layers must be an array.");
    }
    for (const name of requestedLayers) {
      if (typeof name !== "string" || !layers.has(name) || requiredLayers.includes(name)) {
        issue("LAYERS_INVALID", at, "Required layers must be known and unique.");
      } else requiredLayers.push(name);
    }
    const evidence = item.execution_evidence;
    if (!object(evidence)) {
      issue("EVIDENCE_REQUIRED", `${at}.execution_evidence`, "A passed declaration requires run evidence.");
      continue;
    }
    for (const field of metadataFields) {
      if (!Object.hasOwn(evidence, field)) issue("FIELD_REQUIRED", `${at}.execution_evidence.${field}`, "Required run metadata is missing.");
    }
    for (const field of ["run_id", "test_command", "environment"] as const) {
      if (!nonempty(evidence[field])) issue("FIELD_INVALID", `${at}.execution_evidence.${field}`, "Expected a nonempty string.");
    }
    if (typeof evidence.git_commit !== "string" || !/^[a-f0-9]{40}$/i.test(evidence.git_commit)) {
      issue("COMMIT_INVALID", at, "Record the full 40-character Git commit ID.");
    }
    if (evidence.exit_code !== 0) issue("EXIT_CODE_INVALID", at, "A passed run must have integer exit code zero.");
    if (typeof evidence.provider_mode !== "string" || !providerModes.has(evidence.provider_mode)) {
      issue("PROVIDER_INVALID", at, "Provider mode must be none, fake, sandbox, or approved_live.");
    }
    const migration = evidence.database_migration_version;
    if (migration !== null && !nonempty(migration)) issue("MIGRATION_INVALID", at, "Migration version must be a nonempty string or null.");
    if (requiredLayers.some((name) => databaseLayers.has(name)) && !nonempty(migration)) {
      issue("MIGRATION_REQUIRED", at, "Database layers require their applied migration version.");
    }
    if (requiredLayers.includes("provider_contract") && evidence.provider_mode === "none") {
      issue("PROVIDER_REQUIRED", at, "Provider contract checks need fake, sandbox, or approved live evidence.");
    }
    const start = utcTimestamp(evidence.started_at);
    const end = utcTimestamp(evidence.finished_at);
    if (start === null || end === null) issue("TIMESTAMP_INVALID", at, "Run timestamps must be valid UTC RFC3339 instants ending in Z.");
    else {
      if (end < start) issue("TIME_ORDER", at, "Finish time cannot precede start time.");
      if (start > now || end > now) issue("FUTURE_EVIDENCE", at, "An execution result cannot be dated in the future.");
    }
    const bytes = readFile(evidence.artifact_path, `${at}.execution_evidence.artifact_path`, "ARTIFACT_MISSING");
    if (!bytes) continue;
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (typeof evidence.artifact_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(evidence.artifact_sha256) || hash !== evidence.artifact_sha256.toLowerCase()) {
      issue("ARTIFACT_HASH_MISMATCH", at, "Artifact SHA-256 does not match its recorded bytes.");
      continue;
    }
    let artifact: unknown;
    try { artifact = JSON.parse(bytes.toString("utf8")); }
    catch { issue("ARTIFACT_INVALID", at, "Expected a JSON run report."); continue; }
    if (!object(artifact) || artifact.schema_version !== 1 || !Array.isArray(artifact.test_results)) {
      issue("ARTIFACT_INVALID", at, "Expected a version 1 run report with test_results.");
      continue;
    }
    for (const field of metadataFields) {
      if (!Object.hasOwn(artifact, field) || artifact[field] !== evidence[field]) {
        issue("RUN_MISMATCH", `${at}.execution_evidence.${field}`, "The artifact does not belong to this recorded run.");
      }
    }
    const matches = artifact.test_results.filter((result) => object(result) && result.case_id === item.id);
    if (matches.length !== 1 || !object(matches[0])) {
      issue("RESULT_MISSING", at, "The artifact must aggregate this acceptance case exactly once.");
      continue;
    }
    const result = matches[0];
    if (result.test_file !== item.test_file || result.status !== "passed") {
      issue("RESULT_NOT_PASSED", at, "The executed test file and passing result must match this case.");
    }
    if (typeof result.assertion_count !== "number" || !Number.isSafeInteger(result.assertion_count) || result.assertion_count < 1) {
      issue("NO_ASSERTIONS", at, "The case must have executed at least one assertion.");
    }
    if (!Array.isArray(result.layers)) {
      issue("LAYER_MISSING", at, "Executed layer evidence is missing.");
      continue;
    }
    const observedLayers = new Set<string>();
    for (const layer of result.layers) {
      if (!object(layer) || typeof layer.layer !== "string" || !layers.has(layer.layer) || observedLayers.has(layer.layer)) {
        issue("LAYER_INVALID", at, "Executed layers must be known and unique.");
        continue;
      }
      observedLayers.add(layer.layer);
      for (const field of ["environment", "provider_mode", "database_migration_version"] as const) {
        if (!Object.hasOwn(layer, field) || layer[field] !== evidence[field]) {
          issue("LAYER_RUN_MISMATCH", at, "Layer environment, provider and migration must match the recorded run.");
        }
      }
    }
    for (const name of requiredLayers) {
      if (!observedLayers.has(name)) issue("LAYER_MISSING", at, `Required ${name} layer has no executed result.`);
    }
    if (errors.length === errorsBeforeCase) passed++;
  }
  return finish();
}

export function evidenceCli(args: string[]): number {
  const manifestPath = args[0] ?? "fixtures/acceptance-cases.json";
  if (args.length > 1 && (args.length !== 3 || args[1] !== "--root")) {
    console.error("Usage: tsx tools/validate-evidence.ts [manifest.json] [--root workspace]");
    return 2;
  }
  try {
    const report = validateEvidenceManifest(JSON.parse(readFileSync(resolve(manifestPath), "utf8")), {
      rootDir: resolve(args[2] ?? "."),
    });
    console.log(JSON.stringify(report, null, 2));
    return report.valid ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, error: error instanceof Error ? error.message : "Could not read manifest" }));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = evidenceCli(process.argv.slice(2));
}
