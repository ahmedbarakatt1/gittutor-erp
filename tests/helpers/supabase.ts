import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

export type LocalSupabase = {
  marker: 'git-tutor-supabase-local-v1';
  url: string;
  publishable_key: string;
  secret_key: string;
  database_url: string;
  worker_database_url?: string;
  actors: Record<string, { id: string; email: string; password: string }>;
  seed_state?: { guardian_invitation_expires_at: string };
};

export function assertLocalSupabase(config: LocalSupabase) {
  const database = new URL(config.database_url);
  if (config.marker !== 'git-tutor-supabase-local-v1'
    || config.url !== 'http://127.0.0.1:54321'
    || database.hostname !== '127.0.0.1' || database.port !== '54322' || database.pathname !== '/postgres'
    || !['postgres:', 'postgresql:'].includes(database.protocol)
    || !config.publishable_key || !config.secret_key
    || !['development', 'test'].includes(process.env.APP_ENV || process.env.NODE_ENV || 'development')
    || Object.values(config.actors).some(actor => !actor.email.endsWith('@example.test') || !actor.password || !actor.id)) {
    throw new Error('LOCAL_SUPABASE_REQUIRED');
  }
}

export function loadLocalSupabase(): LocalSupabase {
  const config = JSON.parse(readFileSync(resolve('.local/supabase.json'), 'utf8').replace(/^\uFEFF/, '')) as LocalSupabase;
  assertLocalSupabase(config);
  return config;
}

export function anonymousClient() {
  const config = loadLocalSupabase();
  return createClient(config.url, config.publishable_key, {
    db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Every call creates a genuine, independent Supabase Auth session. */
export async function authClient(label: string) {
  const config = loadLocalSupabase();
  const actor = config.actors[label];
  if (!actor) throw new Error('UNKNOWN_SYNTHETIC_ACTOR');
  const client = anonymousClient();
  const { data, error } = await client.auth.signInWithPassword({ email: actor.email, password: actor.password });
  if (error || !data.session || data.user.id !== actor.id) throw new Error('SYNTHETIC_AUTH_FAILED');
  return client;
}

/** Only fixture preparation/inspection may use this administrator connection. Never application commands. */
export async function adminDatabase() {
  const config = loadLocalSupabase();
  const database = new Client({ connectionString: config.database_url });
  await database.connect();
  try {
    const marker = await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton');
    if (marker.rowCount !== 1 || marker.rows[0].environment !== 'test' || marker.rows[0].fixture_marker !== config.marker) throw new Error('LOCAL_SUPABASE_REQUIRED');
    return database;
  } catch { await database.end(); throw new Error('LOCAL_SUPABASE_REQUIRED'); }
}
