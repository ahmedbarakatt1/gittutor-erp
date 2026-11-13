/** Apply additive repository migrations to the separately marked operational preview. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
const directory = resolve('.local/operational-preview');
const config = JSON.parse(await readFile(resolve(directory, 'config.json'), 'utf8')) as { marker: string; database_url: string };
assert.equal(config.marker, 'git-tutor-operational-preview-v1');
const address = new URL(config.database_url); assert.equal(address.hostname, '127.0.0.1'); assert.equal(address.port, '54332');
const db = new Client({ connectionString: config.database_url }); await db.connect();
try {
  const state = (await db.query('select environment,fixture_marker from app_private.environment_metadata')).rows[0];
  assert.equal(state.environment, 'development'); assert.equal(state.fixture_marker, config.marker);
  await mkdir(resolve(directory, 'supabase/migrations'), { recursive: true });
  for (const file of (await readdir('supabase/migrations')).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name))) {
    await writeFile(resolve(directory, 'supabase/migrations', file), await readFile(resolve('supabase/migrations', file)));
  }
  // The clone's complete source history allows ordinary CLI checks to detect divergence.
  const result = await promisify(execFile)(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), 'migration', 'up', '--include-all', '--workdir', directory], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  await writeFile(resolve(directory, 'migrations.log'), result.stdout + result.stderr, { mode: 0o600 });
  console.log('Operational preview additive migrations applied. Existing records preserved.');
} catch (error) {
  const result = error as { stdout?: string; stderr?: string };
  if (result.stdout || result.stderr) await writeFile(resolve(directory, 'migrations.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
  throw error;
} finally { await db.end(); }
