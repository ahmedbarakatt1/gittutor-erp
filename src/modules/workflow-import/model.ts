import { z } from "zod";

export const workflowTables = ["sessions", "packages", "students", "tutors", "marketing", "distributions", "balances"] as const;
export type WorkflowTable = typeof workflowTables[number];

const valueSchema = z.union([z.string().max(20000), z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), z.boolean(), z.null()]);
const columnSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  label: z.string().min(1).max(2000),
  type: z.enum(["text", "money", "date", "time", "number", "boolean"]),
}).strict();
const rowSchema = z.object({
  source_row: z.number().int().positive().max(1048576),
  values: z.record(z.string(), valueSchema),
  issues: z.array(z.string().min(1).max(200)).max(200),
}).strict();

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

const tableSchema = z.object({ columns: z.array(columnSchema).max(100), rows: z.array(rowSchema).max(10000) }).strict().superRefine((table, context) => {
  const keys = table.columns.map((column) => column.key);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "Duplicate source column" });
  if (new Set(table.rows.map((row) => row.source_row)).size !== table.rows.length) context.addIssue({ code: "custom", message: "Duplicate source row" });
  for (const [index, row] of table.rows.entries()) {
    if (Object.keys(row.values).length !== keys.length || Object.keys(row.values).some((key) => !keys.includes(key))) {
      context.addIssue({ code: "custom", message: "Values must match declared columns", path: ["rows", index, "values"] });
    }
    for (const column of table.columns) {
      const value = row.values[column.key];
      if (value === null) continue;
      // Preserve source errors and malformed source literals only with an explicit field flag.
      const sourceException = typeof value === "string" && row.issues.some((issue) =>
        /^(source_error|invalid_[a-z_]+):/.test(issue) && issue.endsWith(`:${column.key}`));
      let valid = sourceException;
      if (column.type === "text") valid ||= typeof value === "string";
      if (column.type === "money") valid ||= typeof value === "number" && Number.isSafeInteger(value);
      if (column.type === "number") valid ||= typeof value === "number" && Number.isFinite(value);
      if (column.type === "boolean") valid ||= typeof value === "boolean";
      if (column.type === "date") valid ||= typeof value === "string" && isDate(value);
      if (column.type === "time") valid ||= typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
      if (!valid) context.addIssue({ code: "custom", message: `Invalid ${column.type} source value`, path: ["rows", index, "values", column.key] });
    }
  }
});

/** Private workbook observations. This contract does not attest identity, payment or delivery verification. */
export const workflowSnapshotSchema = z.object({
  version: z.literal(1),
  source_name: z.string().min(1).max(255),
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  as_of: z.string().refine(isDate, "Expected an explicit source business date").nullable(),
  tables: z.object({
    sessions: tableSchema, packages: tableSchema, students: tableSchema, tutors: tableSchema,
    marketing: tableSchema, distributions: tableSchema, balances: tableSchema,
  }).strict(),
  courses: z.array(z.string().min(1).max(2000)).max(10000).refine((courses) =>
    new Set(courses.map((course) => course.trim().replace(/\s+/g, " ").toLocaleLowerCase("en"))).size === courses.length, "Duplicate normalized course"),
}).strict();

export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;

export function summarizeWorkflow(snapshot: WorkflowSnapshot) {
  const counts = Object.fromEntries(workflowTables.map((name) => [name, snapshot.tables[name].rows.length])) as Record<WorkflowTable, number>;
  const rows = workflowTables.flatMap((name) => snapshot.tables[name].rows);
  const dateColumn = snapshot.tables.sessions.columns.find((column) => column.key === "col_a" && column.type === "date");
  const dated = dateColumn ? snapshot.tables.sessions.rows.filter((row) => typeof row.values[dateColumn.key] === "string" && isDate(row.values[dateColumn.key] as string)).length : 0;
  return {
    counts,
    record_count: rows.length,
    flagged_record_count: rows.filter((row) => row.issues.length > 0).length,
    issue_count: rows.reduce((count, row) => count + row.issues.length, 0),
    dated_sessions: dated,
    undated_sessions: counts.sessions - dated,
    course_count: snapshot.courses.length,
  };
}
