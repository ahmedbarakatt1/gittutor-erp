import { createHash, randomUUID } from 'node:crypto';
import { packageFixture } from './packages';
import { authClient } from './supabase';

/** Guarded synthetic metadata only. These rows do not attest uploaded bytes or a live scanner. */
export async function paymentFixture(options: { charge?: 'package' | 'enrollment'; coverageRule?: 'named_entitlement_covers_eligible_occurrence' | 'allocated_value_with_explicit_top_up'; cancellationRefundBasisPoints?: number } = {}) {
  const f = await packageFixture(options), reviewer = await authClient('cs_a');
  const adminId = (await f.admin.auth.getUser()).data.user!.id;
  const learnerAccountId = (await f.learner.auth.getUser()).data.user!.id;
  const purchase = await f.purchase();
  let chargeId = purchase.charge_id as string, enrollmentId: string | null = null;
  if (options.charge === 'enrollment') {
    const occurrence = await f.occurrence('private');
    const held = await f.reserve(occurrence.occurrence_id as string);
    const quote = await f.rpc('get_quote', { p_quote_id: held.quote_id }, f.learner);
    await f.rpc('accept_quote', { p_quote_id: held.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() }, f.learner);
    enrollmentId = held.enrollment_id as string;
    chargeId = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [enrollmentId])).rows[0].id;
  }
  const evidence = async (input: { purpose: string; parentType: string; parentId: string | null; uploaderId?: string; learnerId?: string | null; chargeId?: string | null; scanState?: 'clean' | 'pending' | 'quarantined'; mime?: string; bytes?: number }) => {
    const id = randomUUID();
    // RED can reach the missing public boundary before the new schema exists. No positive fixture bypass is deployed.
    if (!(await f.database.query("select to_regclass('app_private.files') as relation")).rows[0].relation) return id;
    await f.database.query('insert into app_private.files(id,uploader_account_id,learner_id,charge_id,parent_type,parent_id,purpose,object_key,object_version,checksum_sha256,detected_mime,byte_size,scan_state,source_provenance) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [id, input.uploaderId ?? adminId, input.learnerId ?? null, input.chargeId ?? null, input.parentType, input.parentId, input.purpose, `synthetic-test/${id}`, 'synthetic-metadata-v1', createHash('sha256').update(`Synthetic metadata ${id}`).digest('hex'), input.mime ?? 'application/pdf', input.bytes ?? 512, input.scanState ?? 'clean', 'synthetic_development_metadata_no_bytes']);
    return id;
  };
  const receiving = async () => {
    const fileId = await evidence({ purpose: 'receiving_ownership', parentType: 'receiving_account', parentId: null });
    const created = await f.rpc('create_receiving_account', { p_channel: 'instapay', p_collection_identifier: `synthetic-${randomUUID()}@instapay`, p_display_instructions: 'Synthetic local collection account; no real payment requested.', p_ownership_evidence_file_id: fileId, p_idempotency_key: randomUUID() });
    const approved = await f.rpc('approve_receiving_account', { p_receiving_account_id: created.receiving_account_id, p_enabled: true, p_verification_note: 'Guarded synthetic independent account evidence', p_expected_version: created.version, p_idempotency_key: randomUUID() });
    const row = (await f.database.query('select current_version_id from finance_private.receiving_accounts where id=$1', [created.receiving_account_id])).rows[0];
    return { id: created.receiving_account_id as string, versionId: row.current_version_id as string, version: approved.version as number };
  };
  const transfer = async (accountId: string, amount = 55000, settle = true, bind = true) => {
    const fileId = await evidence({ purpose: 'statement', parentType: 'receiving_account', parentId: accountId });
    const externalId = `synthetic-${randomUUID()}`, observedAt = new Date(Date.now() - 60000).toISOString();
    let created = await f.rpc('record_manual_transfer', { p_receiving_account_id: accountId, p_channel: 'instapay', p_external_id: externalId, p_amount_minor: amount, p_currency: 'EGP', p_observed_at: observedAt, p_statement_evidence_file_id: fileId, p_idempotency_key: randomUUID() }, reviewer);
    const id = created.transfer_id as string;
    if (settle) created = await f.rpc('verify_transfer_settlement', { p_transfer_id: id, p_statement_evidence_id: fileId, p_external_id: externalId, p_settled_at: observedAt, p_amount_minor: amount, p_currency: 'EGP', p_verification_note: 'Synthetic independent statement verification', p_expected_version: created.version, p_idempotency_key: randomUUID() }, reviewer);
    if (bind) {
      const ownership = await evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: id });
      created = await f.rpc('bind_transfer_payer', { p_transfer_id: id, p_payer_account_id: learnerAccountId, p_evidence_file_id: ownership, p_reason: 'Synthetic independently evidenced actual payer', p_expected_version: created.version, p_idempotency_key: randomUUID() }, reviewer);
    }
    return { id, version: created.version as number, amount, externalId, observedAt, fileId };
  };
  const receipt = async (accountVersionId: string, amount = 55000) => {
    const fileId = await evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: chargeId, uploaderId: learnerAccountId, learnerId: f.learnerId, chargeId });
    return f.rpc('submit_receipt', { p_enrollment_id: enrollmentId, p_charge_id: chargeId, p_file_id: fileId, p_receiving_account_version_id: accountVersionId, p_channel: 'instapay', p_transferred_amount_minor: amount, p_currency: 'EGP', p_reference: `synthetic-${randomUUID()}`, p_transferred_at: null, p_idempotency_key: randomUUID() }, f.learner);
  };
  const close = async () => { await reviewer.auth.signOut({ scope: 'local' }); await f.close(); };
  return { ...f, reviewer, adminId, learnerAccountId, purchaseId: purchase.resource_id as string, chargeId, enrollmentId, evidence, receiving, transfer, receipt, close };
}
