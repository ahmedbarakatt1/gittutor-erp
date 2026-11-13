/** Explicitly authorized local migration. Workbook labels are historical reports, not ledger commands. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { loadLocalSupabase } from '../tests/helpers/supabase';
import { workflowSnapshotSchema } from '../src/modules/workflow-import/model';

const [manifestPath, sourcePath] = process.argv.slice(2);
assert(manifestPath && sourcePath, 'Provide the extracted JSON and original workbook paths.');
const snapshot = workflowSnapshotSchema.parse(JSON.parse(await readFile(resolve(manifestPath), 'utf8')));
assert.equal(snapshot.source_sha256, createHash('sha256').update(await readFile(resolve(sourcePath))).digest('hex'), 'SOURCE_CHANGED');
const local = loadLocalSupabase();
const folder = resolve('.local/workflow-import');
await mkdir(folder, { recursive: true });
const ownerPath = resolve(folder, 'owner.json');
type Owner = { id: string; email: string; password: string };
let owner: Owner;
try { owner = JSON.parse(await readFile(ownerPath, 'utf8')) as Owner; }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  owner = { id: randomUUID(), email: `records-owner-${randomBytes(5).toString('hex')}@preview.gittutor.invalid`, password: randomBytes(24).toString('base64url') };
  await writeFile(ownerPath, JSON.stringify(owner, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
assert(owner.email.endsWith('@preview.gittutor.invalid') && owner.password.length >= 24);
assert(!Object.values(local.actors).some(actor => actor.id === owner.id), 'DEMO_ACCOUNT_CANNOT_OWN_REAL_DATA');
const auth = createClient(local.url, local.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
const database = new Client({ connectionString: local.database_url });
await database.connect();
try {
  const marker = (await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
  assert.equal(marker?.fixture_marker, local.marker); assert.equal(marker?.environment, 'test');
  const existing = await database.query('select id from auth.users where id=$1', [owner.id]);
  if (!existing.rowCount) {
    const made = await auth.auth.admin.createUser({ id: owner.id, email: owner.email, password: owner.password, email_confirm: true, user_metadata: { display_name: 'Git Tutor records owner' } });
    assert.equal(made.error, null, 'RECORDS_OWNER_CREATION_FAILED');
  }
  const content = JSON.stringify(snapshot), contentHash = createHash('sha256').update(content).digest('hex');
  await database.query('begin');
  try {
    await database.query("select pg_advisory_xact_lock(hashtextextended('workflow-import:'||$1,0))", [owner.id]);
    const importedBefore = (await database.query('select exists(select 1 from app_private.workflow_import_batches where owner_account_id=$1) found', [owner.id])).rows[0].found;
    if (importedBefore) {
      const active = (await database.query("select exists(select 1 from app_private.account_roles where account_id=$1 and role='admin' and revoked_at is null) allowed", [owner.id])).rows[0].allowed;
      assert(active, 'RECORDS_OWNER_ACCESS_REVOKED');
    } else {
      await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','Owner-authorized private workbook migration') on conflict do nothing", [owner.id]);
    }
    const previous = await database.query('select id,content_sha256 from app_private.workflow_import_batches where owner_account_id=$1 and source_sha256=$2', [owner.id, snapshot.source_sha256]);
    let id: string;
    if (previous.rowCount) {
      assert.equal(previous.rows[0].content_sha256, contentHash, 'IMPORT_CONTENT_CONFLICT'); id = previous.rows[0].id;
    } else {
      id = (await database.query("insert into app_private.workflow_import_batches(owner_account_id,source_sha256,content_sha256,source_kind,snapshot) values($1,$2,$3,'real',$4::jsonb) returning id", [owner.id, snapshot.source_sha256, contentHash, content])).rows[0].id;
    }
    await database.query('commit');
    const base = process.env.DEMO_BASE_URL || 'http://127.0.0.1:3000';
    const origin = new URL(base); assert(['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password);
    await writeFile(resolve(folder, 'START-HERE.md'), `# Your actual Git Tutor records\n\n[Sign in](${origin.origin}/login) with this separate private owner account:\n\nEmail: ${owner.email}\n\nPassword: ${owner.password}\n\n[Open actual records](${origin.origin}/admin/workflow)\n\nThe previous demo accounts cannot read these records. The workbook's historical payment/completion labels are shown as reported, without posting new money or sending messages. Use the tabs, search, status filter, review filter and row details to inspect all records.\n\nSource: ${snapshot.source_name}\n\nSHA-256: ${snapshot.source_sha256}\n\nImport reference: ${id}\n\nThis file contains credentials; keep it private and out of Git.\n`, { mode: 0o600 });
    console.log(JSON.stringify({ imported: true, repeated: Boolean(previous.rowCount), records: Object.fromEntries(Object.entries(snapshot.tables).map(([key, table]) => [key, table.rows.length])), handoff: '.local/workflow-import/START-HERE.md' }));
  } catch (error) { await database.query('rollback'); throw error; }
} finally { await database.end(); }
