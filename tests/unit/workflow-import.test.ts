import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { summarizeWorkflow, workflowSnapshotSchema, type WorkflowSnapshot } from "../../src/modules/workflow-import/model";

function syntheticSnapshot(): WorkflowSnapshot {
  const empty = () => ({ columns: [], rows: [] });
  return {
    version: 1,
    source_name: "Synthetic workflow.xlsx",
    source_sha256: "a".repeat(64),
    as_of: null,
    courses: ["Synthetic course"],
    tables: {
      sessions: {
        columns: [
          { key: "col_a", label: "Date", type: "date" },
          { key: "col_e", label: "Student", type: "text" },
          { key: "col_q", label: "Session Price", type: "money" },
        ],
        rows: [
          { source_row: 2, values: { col_a: "2026-11-13", col_e: "Synthetic learner", col_q: 57500 }, issues: [] },
          { source_row: 9, values: { col_a: null, col_e: "Group", col_q: null }, issues: ["missing_date:col_a", "ambiguous_person:col_e"] },
        ],
      },
      packages: empty(), students: empty(), tutors: empty(), marketing: empty(), distributions: empty(), balances: empty(),
    },
  };
}

test("workbook preview keeps incomplete source rows and counts review issues without inventing financial totals", () => {
  const parsed = workflowSnapshotSchema.parse(syntheticSnapshot());
  expect(parsed.tables.sessions.rows[1].values.col_q).toBeNull();
  expect(summarizeWorkflow(parsed)).toEqual({
    counts: { sessions: 2, packages: 0, students: 0, tutors: 0, marketing: 0, distributions: 0, balances: 0 },
    record_count: 2, flagged_record_count: 1, issue_count: 2, dated_sessions: 1, undated_sessions: 1, course_count: 1,
  });
});

test("preview rejects duplicate lineage, undeclared values, unsafe money and unflagged malformed source values", () => {
  const invalid = (change: (snapshot: WorkflowSnapshot) => void) => {
    const snapshot = syntheticSnapshot(); change(snapshot);
    expect(workflowSnapshotSchema.safeParse(snapshot).success).toBe(false);
  };
  invalid((s) => { s.tables.sessions.rows[1].source_row = 2; });
  invalid((s) => { s.tables.sessions.rows[0].values.hidden = "unaudited"; });
  invalid((s) => { delete s.tables.sessions.rows[0].values.col_e; });
  invalid((s) => { s.tables.sessions.columns.push(s.tables.sessions.columns[0]); });
  invalid((s) => { s.tables.sessions.rows[0].values.col_q = 1.25; });
  invalid((s) => { s.tables.sessions.rows[0].values.col_q = Number.MAX_SAFE_INTEGER + 1; });
  invalid((s) => { s.tables.sessions.rows[0].values.col_a = "2026-02-30"; });
  invalid((s) => { s.tables.sessions.rows[0].values.col_q = "#REF!"; });
  expect(workflowSnapshotSchema.safeParse({ ...syntheticSnapshot(), verified: true }).success).toBe(false);
  const sourceError = syntheticSnapshot();
  sourceError.tables.sessions.rows[0].values.col_q = "#REF!";
  sourceError.tables.sessions.rows[0].issues = ["source_error:col_q"];
  expect(workflowSnapshotSchema.safeParse(sourceError).success).toBe(true);
});

test("extractor preserves decimal money, source labels, blanks, template exclusion and Cairo DST uncertainty", () => {
  // Standard-library-only synthetic inputs: CI never opens the authorized customer workbook.
  const script = `
import importlib.util, json
from datetime import datetime
spec=importlib.util.spec_from_file_location('workflow', 'tools/extract-workflow.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
issues=[]
money=[m.normalize_value(v, 'money', issues, 'col_q') for v in [None, 0, 12.34, -1.25, 1.005]]
normal_issues=[]; summer_issues=[]; gap_issues=[]; fold_issues=[]; interval_issues=[]
normal=m.session_instants({'col_a':'2026-11-13','col_c':'09:00','col_d':'10:00'},normal_issues)
summer=m.session_instants({'col_a':'2026-07-01','col_c':'09:00','col_d':'10:00'},summer_issues)
gap=m.session_instants({'col_a':'2026-04-24','col_c':'00:30','col_d':'01:30'},gap_issues)
fold=m.session_instants({'col_a':'2026-10-29','col_c':'23:30','col_d':'23:45'},fold_issues)
interval=m.session_instants({'col_a':'2026-11-13','col_c':'10:00','col_d':'09:00'},interval_issues)
print(json.dumps({'money':money,'issues':issues,'label':m.normalize_value(' Learner  A ','text',[],'col_e'),'normal':normal,'summer':summer,'gap':gap,'gap_issues':gap_issues,'fold':fold,'fold_issues':fold_issues,'interval':interval,'interval_issues':interval_issues,'date':m.normalize_value(datetime(2026,11,13),'date',[],'col_a'),'courses':m.normalize_courses(['  Data  Science ', 'data science', 'SYNTHETIC','synthetic']),'template':m.has_substantive_row([(None,False),('=SUM(A1:A2)',True)]),'record':m.has_substantive_row([('Group',False),('=SUM(A1:A2)',True)])}))
`;
  const result = JSON.parse(execFileSync(process.env.WORKFLOW_IMPORT_PYTHON ?? "python", ["-B", "-c", script], { encoding: "utf8" }));
  expect(result.money).toEqual([null, 0, 1234, -125, "1.005"]);
  expect(result.issues).toContain("invalid_money_precision:col_q");
  expect(result.label).toBe(" Learner  A ");
  expect(result.date).toBe("2026-11-13");
  expect(result.normal).toEqual({ derived_start_at: "2026-11-13T07:00:00Z", derived_end_at: "2026-11-13T08:00:00Z" });
  expect(result.summer).toEqual({ derived_start_at: "2026-07-01T06:00:00Z", derived_end_at: "2026-07-01T07:00:00Z" });
  for (const key of ["gap", "fold", "interval"]) expect(result[key]).toEqual({ derived_start_at: null, derived_end_at: null });
  expect(result.gap_issues).toContain("nonexistent_cairo_time:col_c");
  expect(result.fold_issues).toContain("ambiguous_cairo_time:col_c");
  expect(result.interval_issues).toContain("invalid_session_interval");
  expect(result.courses).toEqual(["Data Science", "SYNTHETIC"]);
  expect(result.template).toBe(false);
  expect(result.record).toBe(true);
});

test("extractor distinguishes empty cached formula results from missing caches and preserves source errors", () => {
  const script = `
import importlib.util,json
from io import BytesIO
from types import SimpleNamespace
from zipfile import ZipFile
spec=importlib.util.spec_from_file_location('workflow', 'tools/extract-workflow.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
data=BytesIO()
with ZipFile(data,'w') as z:
 z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>')
 z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
 z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="A2" t="str"><f>IF(1, &quot;&quot;, 0)</f><v/></c><c r="B2"><f>1+1</f><v/></c><c r="C2"><f>1+1</f></c><c r="D2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>')
issues=[]
error=m.source_value(SimpleNamespace(coordinate='E2'),SimpleNamespace(data_type='e',value='#REF!'),'money',issues,'col_e',set())
missing=m.source_value(SimpleNamespace(coordinate='B2'),SimpleNamespace(data_type='n',value=None),'money',issues,'col_b',{'B2'})
print(json.dumps({'missing':sorted(m.missing_formula_caches(data.getvalue())['Synthetic']),'source_error':error,'missing_value':missing,'issues':issues}))
`;
  const result = JSON.parse(execFileSync(process.env.WORKFLOW_IMPORT_PYTHON ?? "python", ["-B", "-c", script], { encoding: "utf8" }));
  expect(result).toEqual({ missing: ["B2", "C2"], source_error: "#REF!", missing_value: null, issues: ["source_error:col_e", "source_formula_cache_missing:col_b"] });
});
