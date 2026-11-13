import 'server-only';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PayrollRpcError } from '../modules/tutor_pay/payroll';
import type { IdentityRpcClient } from '../modules/identity/commands';
import type { ServerConfig } from './config';
import { createDatabasePool, databaseUrl } from './database';
import { safeError } from './http';
import { createIdentifierCipher } from './private-identifiers';
import { createPayoutDestinationTransport, type PrivatePayoutDestinationPort } from './payout-destination-transport';

let workerPool: Pool | undefined;
export function privatePayoutDestinationPort(database: Pick<Pool, 'query'>): PrivatePayoutDestinationPort {
  async function call(sql: string, values: unknown[]) {
    try {
      const result = await database.query(sql, values);
      if (result.rowCount !== 1) throw new PayrollRpcError('DEPENDENCY_UNAVAILABLE');
      return result.rows[0].result as unknown;
    } catch (error) { throw new PayrollRpcError(safeError(error).code); }
  }
  return {
    prepare: (actor, key) => call('select app_private.prepare_payout_destination($1,$2,$3) as result', [actor.account_id, actor.session_id, key]),
    read: (actor, destinationId, purpose, attemptId, reason) => call('select app_private.read_payout_destination_for_server($1,$2,$3,$4,$5,$6) as result', [actor.account_id, actor.session_id, destinationId, purpose, attemptId, reason]),
    issue: (actor, data) => call('select app_private.issue_payout_destination_validation_artifact($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as result', [actor.account_id, actor.session_id, data.destination_id, data.destination_version, data.ciphertext_digest, data.masked_identifier, data.identifier_fingerprint, data.purpose, JSON.stringify(data.approval_request)]),
  };
}

/** Claims must come from getClaims verification. SQL rechecks the live session/role/resource on each private call. */
export function payoutDestinationServer(client: IdentityRpcClient, verifiedClaims: unknown, config: ServerConfig) {
  const claims = z.object({ sub: z.uuid(), session_id: z.uuid() }).safeParse(verifiedClaims);
  if (!claims.success) throw new PayrollRpcError('AUTH_REQUIRED');
  if (!config.secret_encryption_key) throw new PayrollRpcError('DEPENDENCY_UNAVAILABLE');
  const cipher = createIdentifierCipher({ currentKey: config.secret_encryption_key, currentKeyId: config.secret_encryption_key_id, previousKeys: config.secret_encryption_previous_keys });
  workerPool ??= createDatabasePool(databaseUrl('worker'));
  const transport = createPayoutDestinationTransport({ client, cipher, port: privatePayoutDestinationPort(workerPool) });
  const actor = { account_id: claims.data.sub, session_id: claims.data.session_id };
  return {
    submit: (args: unknown) => transport.submit(actor, args),
    verify: (args: unknown) => transport.verify(actor, args),
    reveal: (args: unknown) => transport.reveal(actor, args),
  };
}
