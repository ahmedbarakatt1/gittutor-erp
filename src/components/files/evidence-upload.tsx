'use client';

import { FileUpload, type UploadPurpose } from './file-upload';
import { fileCopy as copy } from '@/locales/files';

const statements = new Set(['create_statement_import', 'record_manual_transfer', 'verify_transfer_settlement']);
const receipts = new Set(['submit_receipt', 'replace_receipt']);
const review = new Set(['create_receiving_account', 'bind_transfer_payer', 'record_transfer_reversal', 'propose_refund_destination', 'verify_refund_destination', 'reconcile_refund', 'record_refund_reversal', 'resolve_package_financing_hold', 'review_delivery_exception', 'amend_completion', 'adjust_tutor_earning', 'record_expense', 'record_expense_settlement', 'cash_reconciliation', 'verify_payout_destination', 'reconcile_payout', 'record_payout_reversal', 'analytics_evidence']);
export function EvidenceUpload({ action, parentId, onReady }: { action: string; parentId: string | null; onReady: (id: string) => void }) {
  const purpose: UploadPurpose | undefined = statements.has(action) ? 'statement_evidence' : receipts.has(action) ? 'receipt' : review.has(action) ? 'review_evidence' : undefined;
  if (!purpose) return null;
  return <details><summary>{copy.evidenceTitle}</summary><p>{copy.evidenceDescription}</p><FileUpload purpose={purpose} parentId={parentId} evidenceAction={action} onReady={file => onReady(file.file_id)} /></details>;
}
