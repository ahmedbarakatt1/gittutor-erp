'use client';

import { FileUpload, type UploadPurpose } from './file-upload';
import { fileCopy as copy } from '@/locales/files';
import { fileCopy as arabicFileCopy } from '@/locales/ar-transaction/files';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicFileCopy },
};


const statements = new Set(['create_statement_import', 'record_manual_transfer', 'verify_transfer_settlement']);
const receipts = new Set(['submit_receipt', 'replace_receipt']);
export function EvidenceUpload({ action, parentId, onReady }: { action: string; parentId: string | null; onReady: (id: string) => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  // Purpose controls the picker; the server validates the action and current access.
  const purpose: UploadPurpose = statements.has(action) ? 'statement_evidence' : receipts.has(action) ? 'receipt' : 'review_evidence';
  return <details><summary>{copy.evidenceTitle}</summary><p>{copy.evidenceDescription}</p><FileUpload purpose={purpose} parentId={parentId} evidenceAction={action} onReady={file => onReady(file.file_id)} /></details>;
}
