import 'server-only';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PaymentRpcError, type PaymentRpcClient } from '../modules/payments/commands';
import type { ServerConfig } from './config';
import { createDatabasePool, databaseUrl } from './database';
import { safeError } from './http';
import { createIdentifierCipher } from './private-identifiers';
import { createRefundDestinationTransport, type PrivateDestinationPort } from './refund-destination-transport';

let workerPool: Pool | undefined;
export function privateDestinationPort(database: Pick<Pool, 'query'>): PrivateDestinationPort {
  async function call(sql: string, values: unknown[]) {
    try {
      const result = await database.query(sql, values);
      if (result.rowCount !== 1) throw new PaymentRpcError('DEPENDENCY_UNAVAILABLE');
      return result.rows[0].result as unknown;
    } catch (error) { throw new PaymentRpcError(safeError(error).code); }
  }
  return {
    prepare: (actor, refundId, key) => call('select app_private.prepare_refund_destination_context($1,$2,$3,$4) as result', [actor.account_id, actor.session_id, refundId, key]),
    read: (actor, destinationId, purpose, attemptId, reason) => call('select app_private.read_refund_destination_for_server($1,$2,$3,$4,$5,$6) as result', [actor.account_id, actor.session_id, destinationId, purpose, attemptId, reason]),
    issue: (actor, data) => call('select app_private.issue_destination_validation_artifact($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as result', [actor.account_id, actor.session_id, data.destination_id, data.destination_version, data.ciphertext_digest, data.masked_identifier, data.identifier_fingerprint, data.purpose, JSON.stringify(data.approval_request)]),
  };
}

/** Claims must come from getClaims verification. SQL rechecks the live session/role/resource on each private call. */
export function refundDestinationServer(client: PaymentRpcClient, verifiedClaims: unknown, config: ServerConfig) {
  const claims = z.object({ sub: z.uuid(), session_id: z.uuid() }).safeParse(verifiedClaims);
  if (!claims.success) throw new PaymentRpcError('AUTH_REQUIRED');
  if (!config.secret_encryption_key) throw new PaymentRpcError('DEPENDENCY_UNAVAILABLE');
  const cipher = createIdentifierCipher({ currentKey: config.secret_encryption_key, currentKeyId: config.secret_encryption_key_id, previousKeys: config.secret_encryption_previous_keys });
  workerPool ??= createDatabasePool(databaseUrl('worker'));
  const transport = createRefundDestinationTransport({ client, cipher, port: privateDestinationPort(workerPool) });
  const actor = { account_id: claims.data.sub, session_id: claims.data.session_id };
  return {
    propose: (args: unknown) => transport.propose(actor, args),
    verify: (args: unknown) => transport.verify(actor, args),
    reveal: (args: unknown) => transport.reveal(actor, args),
  };
}
