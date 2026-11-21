import 'server-only';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { ServerConfig } from './config';
import { createProviderTokenCipher, providerTokenEnvelopeSchema } from './provider-tokens';
import { refreshGoogleAccessToken } from './google-oauth';
import { createFakeCalendarAdapter, createGoogleCalendarAdapter } from './providers/calendar';
import type { CalendarAdapterFactory } from '../worker/calendar';

const credentials = z.object({ provider: z.literal('google'), connection_id: z.uuid(), credential_version: z.uuid(), envelope: providerTokenEnvelopeSchema }).strict();
export function calendarAdapterFactory(database: Pick<Pool,'query'>, config: ServerConfig): CalendarAdapterFactory {
  return async (prepared, job) => {
    if (prepared.mode === 'fake') {
      if (!config.isolated) throw new Error('CALENDAR_CONFIGURATION_REQUIRED');
      return createFakeCalendarAdapter(resolve('.local/fake-calendar/provider'));
    }
    if (config.providers.calendar !== 'google' || !config.google || !config.secret_encryption_key) throw new Error('CALENDAR_CONFIGURATION_REQUIRED');
    const desired = prepared.desired, google = config.google;
    const cipher = createProviderTokenCipher({ currentKeyId: config.secret_encryption_key_id, currentKey: config.secret_encryption_key, previousKeys: config.secret_encryption_previous_keys });
    const saved = credentials.parse((await database.query('select app_private.get_calendar_credentials($1,$2,$3,$4) result',[desired.connection_id,desired.connection_version,job.id,job.lease_token])).rows[0]?.result);
    if (saved.connection_id !== desired.connection_id || saved.credential_version !== desired.credential_version) throw new Error('CALENDAR_CREDENTIALS_UNAVAILABLE');
    let credentialVersion = saved.credential_version;
    let tokens = cipher.open(saved.envelope,{provider:'google',connection_id:saved.connection_id,credential_version:credentialVersion});
    return createGoogleCalendarAdapter(async () => {
      const refreshed = await refreshGoogleAccessToken(google,tokens);
      if (refreshed.refresh_token !== tokens.refresh_token) {
        const nextVersion = randomUUID();
        const envelope = cipher.seal(refreshed,{provider:'google',connection_id:saved.connection_id,credential_version:nextVersion});
        const result = await database.query('select app_private.rotate_calendar_credentials($1,$2,$3,$4,$5::jsonb,$6,$7,$8) result',[saved.connection_id,desired.connection_version,credentialVersion,nextVersion,JSON.stringify(envelope),envelope.kid,job.id,job.lease_token]);
        if (!z.object({credential_version:z.literal(nextVersion)}).strict().safeParse(result.rows[0]?.result).success) throw new Error('CALENDAR_CREDENTIALS_UNAVAILABLE');
        credentialVersion = nextVersion;
      }
      tokens = refreshed; if (!tokens.access_token) throw new Error('CALENDAR_AUTH_REQUIRED'); return tokens.access_token;
    });
  };
}
