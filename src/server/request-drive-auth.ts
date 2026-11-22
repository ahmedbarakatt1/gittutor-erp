import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { parseServerConfig, type ServerConfig } from './config';
import { createDatabasePool, databaseUrl } from './database';
import { createProviderTokenCipher, providerTokenEnvelopeSchema } from './provider-tokens';
import { refreshGoogleAccessToken } from './google-oauth';

let workerPool: Pool | undefined;
export function requestDriveDatabase() {
  return workerPool ??= createDatabasePool(databaseUrl('worker'));
}

export function requestDriveKeys(config: ServerConfig) {
  if (!config.secret_encryption_key) throw new Error('DEPENDENCY_UNAVAILABLE');
  return { currentKeyId: config.secret_encryption_key_id, currentKey: config.secret_encryption_key, previousKeys: config.secret_encryption_previous_keys };
}

const grantSchema = z.object({
  connection_id: z.uuid(), credential_version: z.uuid(), envelope: providerTokenEnvelopeSchema,
});

/** Only server-side request material synchronization consumes this capability. */
export async function getRequestDriveToken(): Promise<string> {
  const config = parseServerConfig(process.env);
  if (!config.request_drive) throw new Error('DRIVE_CONNECTION_REQUIRED');
  const database = requestDriveDatabase();
  const cipher = createProviderTokenCipher(requestDriveKeys(config));
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await database.query('select app_private.read_request_drive_grant() as grant');
    if (!result.rows[0]?.grant) throw new Error('DRIVE_CONNECTION_REQUIRED');
    const grant = grantSchema.parse(result.rows[0].grant);
    const context = { provider: 'request-drive' as const, connection_id: grant.connection_id, credential_version: grant.credential_version };
    const current = cipher.open(grant.envelope, context);
    let updated;
    try {
      updated = await refreshGoogleAccessToken(config.request_drive, current, fetch, 'request-drive');
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'DRIVE_REAUTH_REQUIRED') throw new Error('DEPENDENCY_UNAVAILABLE');
      const revoked = await database.query('select app_private.update_request_drive_token($1,$2,null) as saved', [grant.credential_version, randomUUID()]);
      if (revoked.rows[0]?.saved === true) throw new Error('DRIVE_CONNECTION_REQUIRED');
      continue;
    }
    if (!updated.access_token) throw new Error('DEPENDENCY_UNAVAILABLE');
    if (updated === current) return updated.access_token;
    const version = randomUUID();
    const sealed = cipher.seal(updated, { ...context, credential_version: version });
    const changed = await database.query('select app_private.update_request_drive_token($1,$2,$3::jsonb) as saved', [grant.credential_version, version, sealed]);
    if (changed.rows[0]?.saved === true) return updated.access_token;
    // Another request refreshed the credential, or the owner authorized a new grant.
  }
  throw new Error('DEPENDENCY_UNAVAILABLE');
}
