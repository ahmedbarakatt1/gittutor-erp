import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type { paymentFixture } from './payments';

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

export async function claimedSettledReceipt(f: Fixture, reviewer = f.reviewer) {
  const account = await f.receiving();
  const transfer = await f.transfer(account.id, 50000);
  const receipt = await f.receipt(account.versionId, 50000);
  const caseId = receipt.case_id as string;
  const claim = await f.rpc('claim_review_case', {
    p_case_id: caseId, p_expected_version: 1, p_idempotency_key: randomUUID(),
  }, reviewer);
  const approval = {
    p_case_id: caseId, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null,
    p_allocations: [{ charge_id: f.chargeId, amount_minor: 50000 }],
    p_expected_version: claim.version as number, p_idempotency_key: randomUUID(),
  };
  return { caseId, receiptId: receipt.receipt_id as string, approval };
}

export async function beginAuthenticatedReview(db: Client, token: string) {
  await db.query('begin isolation level read committed');
  await db.query("select set_config('request.jwt.claims',$1,true)", [Buffer.from(token.split('.')[1], 'base64url').toString()]);
  await db.query('set local role authenticated');
  return (await db.query('select pg_backend_pid() pid')).rows[0].pid as number;
}

export function allocateOnConnection(db: Client, args: Awaited<ReturnType<typeof claimedSettledReceipt>>['approval']) {
  return db.query('select api.allocate_transfer($1,$2,$3,$4,$5::jsonb,$6,$7) as data', [
    args.p_case_id, args.p_transfer_id, args.p_evidence_version, args.p_payment_plan_id,
    JSON.stringify(args.p_allocations), args.p_expected_version, args.p_idempotency_key,
  ]);
}
