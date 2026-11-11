import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { assertIsolatedTarget, localDatabaseUrl } from '../tests/helpers/environment';

export function fixtureId(label: string): string {
  const hex = createHash('sha256').update(`git-tutor:synthetic:v1:${label}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export async function seedSynthetic(connectionString: string, environment = process.env.APP_ENV ?? 'development') {
  assertIsolatedTarget({ connectionString, environment });
  const fixtures = JSON.parse(await readFile(resolve('fixtures/domain-scenarios.json'), 'utf8')) as { fixture_status: string; actors: { id: string; name: string; email: string; role: string }[] };
  if (fixtures.fixture_status !== 'synthetic_specification' || fixtures.actors.some(actor => !actor.email.endsWith('@example.test'))) throw new Error('SYNTHETIC_FIXTURES_REQUIRED');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('begin');
    const marker = await client.query('select environment, fixture_marker from app_private.environment_metadata where singleton for update');
    if (!marker.rowCount || !['development', 'test'].includes(marker.rows[0].environment) || marker.rows[0].fixture_marker !== 'git-tutor-disposable-v1') throw new Error('ISOLATED_TARGET_REQUIRED');
    for (const actor of fixtures.actors) {
      await client.query('insert into app_private.synthetic_fixture_registry(id,label,kind,content) values($1,$2,$3,$4) on conflict(label) do nothing', [fixtureId(actor.id), actor.id, 'actor', actor]);
    }
    await client.query('commit');
    console.log(`Synthetic fixture registry seeded (${fixtures.actors.length} deterministic actors). Domain activation is owned by T02–T12.`);
  } catch (error) { await client.query('rollback'); throw error; }
  finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await seedSynthetic(process.env.DATABASE_URL || localDatabaseUrl('gittutor_dev'));
}
