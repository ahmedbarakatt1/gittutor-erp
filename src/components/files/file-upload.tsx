'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FileView, PublicFilePurpose } from '@/modules/files/queries';
import { fileChunkBytes, fileRanges } from '@/modules/files/transport';
import { fileCopy as copy } from '@/locales/files';
import { quizCopy } from '@/locales/quizzes';
import { useHydrated } from '../use-hydrated';
import styles from './files.module.css';
import formStyles from '../auth.module.css';
import { fileCopy as arabicFileCopy } from '@/locales/ar-transaction/files';
import { quizCopy as arabicQuizCopy } from '@/locales/ar-transaction/quizzes';
import { staffText } from '@/locales/ar-staff';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { quizCopy, copy },
  ar: { quizCopy: arabicQuizCopy, copy: arabicFileCopy },
};


export type UploadPurpose = PublicFilePurpose;
type Operation = { signature: string; intentKey: string; completeKey: string; storageKey: string };
type Phase = 'idle' | 'hashing' | 'creating' | 'uploading' | 'completing';
const evidenceTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
function accepted(purpose: UploadPurpose) { return purpose === 'statement_evidence' ? ['text/csv', 'application/pdf'] : ['private_preparation', 'shared_handout', 'request_material'].includes(purpose) ? [...evidenceTypes, pptx] : evidenceTypes; }
function fileType(file: File) { if (!file.type) { const extensions: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }; const inferred = extensions[file.name.split('.').at(-1)?.toLowerCase() || '']; if (inferred) return inferred; } if (/\.pptx$/i.test(file.name) && !file.type) return pptx; if (/\.csv$/i.test(file.name) && ['', 'application/vnd.ms-excel'].includes(file.type)) return 'text/csv'; return file.type; }
function hexadecimal(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join(''); }

/** No bytes or filenames persist in browser storage. A reselected identical file retains its logical retry keys. */
export function FileUpload({ purpose, parentId, evidenceAction, operationScope, pdfOnly = false, onUploaded, onReady }: { purpose: UploadPurpose; parentId: string | null; evidenceAction?: string; operationScope?: string; pdfOnly?: boolean; onUploaded?: (id: string) => void; onReady?: (file: FileView) => void }) {
  const uiLanguage = useSiteLanguage();
  const { quizCopy, copy } = textByLanguage[uiLanguage];

  const id = useId(), hydrated = useHydrated(), [selected, setSelected] = useState<File | null>(null), [phase, setPhase] = useState<Phase>('idle'), [error, setError] = useState(''), [requestId, setRequestId] = useState('');
  const [fileId, setFileId] = useState(''), [record, setRecord] = useState<FileView | null>(null), [refresh, setRefresh] = useState(0);
  const operation = useRef<Operation | null>(null), uploadAbort = useRef<AbortController | null>(null), readyCallback = useRef(onReady), delivered = useRef('');
  const busy = phase !== 'idle', maximum = ['private_preparation', 'shared_handout', 'request_material', 'statement_evidence'].includes(purpose) ? 25 * 1024 * 1024 : 5 * 1024 * 1024;
  const types = pdfOnly ? ['application/pdf'] : accepted(purpose);
  const hint = pdfOnly ? quizCopy.pdfLimits : purpose === 'statement_evidence' ? copy.statementLimits : maximum > 5 * 1024 * 1024 ? copy.teachingLimits : copy.receiptLimits;
  useEffect(() => { readyCallback.current = onReady; }, [onReady]);
  useEffect(() => () => { uploadAbort.current?.abort(); }, []);
  useEffect(() => {
    if (!fileId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const response = await fetch(`/api/v1/files/${fileId}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
        const body = await response.json(); if (!response.ok || !body.data || body.data.file_id !== fileId) throw new Error(copy.unavailable);
        if (controller.signal.aborted) return;
        const current = body.data as FileView; setRecord(current);
        if (current.scan_state === 'clean' && delivered.current !== `${fileId}:${current.version}`) { delivered.current = `${fileId}:${current.version}`; readyCallback.current?.(current); }
        if (current.scan_state === 'pending' && current.upload_state === 'finalized') timer = setTimeout(read, 2000);
      } catch { if (!controller.signal.aborted) setError(copy.unavailable); }
    };
    void read(); return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [fileId, refresh, copy.unavailable]);
  async function upload() {
    if (!selected || !hydrated || busy) return;
    setError(''); setRequestId('');
    if (selected.size < 1 || selected.size > maximum) { setError(copy.tooLarge); return; }
    const declaredType = fileType(selected); if (!types.includes(declaredType)) { setError(copy.invalidType); return; }
    const controller = new AbortController(); uploadAbort.current = controller;
    try {
      setPhase('hashing'); const bytes = await selected.arrayBuffer(), checksum = hexadecimal(await crypto.subtle.digest('SHA-256', bytes));
      const body = { purpose, parent_id: parentId, filename: selected.name, declared_type: declaredType, size_bytes: selected.size, checksum_sha256: checksum, evidence_action: evidenceAction || null };
      const signature = JSON.stringify(operationScope === undefined ? body : { ...body, operationScope }), digest = hexadecimal(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature)));
      if (operation.current?.signature !== signature) {
        const storageKey = `git-tutor-upload:${digest}`; let intentKey: string = crypto.randomUUID(), completeKey: string = crypto.randomUUID();
        try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (/^[0-9a-f-]{36}$/.test(saved?.intentKey || '') && /^[0-9a-f-]{36}$/.test(saved?.completeKey || '')) { intentKey = saved.intentKey; completeKey = saved.completeKey; } sessionStorage.setItem(storageKey, JSON.stringify({ intentKey, completeKey })); } catch { /* In-memory retry remains available. */ }
        operation.current = { signature, intentKey, completeKey, storageKey };
      }
      async function json(path: string, payload: unknown, key: string) {
        const response = await fetch(path, { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) });
        const result = await response.json(); if (!response.ok) { setRequestId(result.request_id || ''); throw new Error(typeof result.message === 'string' ? staffText(uiLanguage, result.message) : copy.failed); } return result.data;
      }
      setPhase('creating'); const intent = await json('/api/v1/files', body, operation.current.intentKey);
      if (!/^[0-9a-f-]{36}$/.test(intent?.file_id || '') || intent.upload_path !== `/api/v1/files/${intent.file_id}/content`) throw new Error(copy.failed);
      setPhase('uploading');
      for (const range of fileRanges(bytes.byteLength)) {
        const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
        if (bytes.byteLength > fileChunkBytes) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${range.total}`;
        const uploaded = await fetch(intent.upload_path, { method: 'PUT', credentials: 'same-origin', signal: controller.signal, headers, body: bytes.slice(range.start, range.end + 1) });
        const result = await uploaded.json();
        if (!uploaded.ok) { setRequestId(result.request_id || ''); throw new Error(typeof result.message === 'string' ? staffText(uiLanguage, result.message) : copy.failed); }
        if (result.data?.file_id !== intent.file_id) throw new Error(copy.failed);
        if (result.data.upload_state === 'uploaded') {
          if (result.data.size_bytes !== bytes.byteLength || result.data.checksum_sha256 !== checksum) throw new Error(copy.failed);
          break; // A lost final acknowledgement can reconcile on the first chunk of a retry.
        }
        if (result.data.upload_state !== 'uploading' || range.end === range.total - 1) throw new Error(copy.failed);
      }
      setPhase('completing'); await json(`/api/v1/files/${intent.file_id}/complete`, { checksum_sha256: checksum }, operation.current.completeKey);
      setFileId(intent.file_id); setRefresh(value => value + 1); onUploaded?.(intent.file_id);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : copy.failed); }
    finally { if (!controller.signal.aborted) setPhase('idle'); }
  }
  return <div className={styles.upload} role="group" aria-labelledby={`${id}-title`} aria-busy={busy}>
    <h3 id={`${id}-title`}>{copy.uploadTitle}</h3><label htmlFor={id}>{copy.choose}</label><input id={id} type="file" accept={types.join(',')} disabled={!hydrated || busy || Boolean(fileId)} aria-describedby={`${id}-hint`} onChange={event => { setSelected(event.target.files?.[0] || null); setError(''); }} /><p id={`${id}-hint`} className={styles.phase}>{hint}</p>
    {phase !== 'idle' && <p role="status" className={styles.phase}>{copy[phase]}</p>}
    {error && <div role="alert" className={formStyles.error}><p>{error}</p>{requestId && <p>{copy.requestReference}: {requestId}</p>}</div>}
    {!fileId && <button type="button" className={formStyles.primary} disabled={!hydrated || busy || !selected} onClick={() => void upload()}>{error ? copy.retry : copy.upload}</button>}
    {fileId && <><p role="status">{record?.scan_state === 'quarantined' ? copy.quarantined : record?.scan_state === 'clean' ? copy.safeStates.clean : copy.checking}</p>{record?.integration_state === 'simulated' && <p className={styles.notice}>{copy.simulated}</p>}<div className={styles.tools}><button type="button" className={formStyles.signout} onClick={() => { setError(''); setRefresh(value => value + 1); }}>{copy.refresh}</button><button type="button" className={formStyles.signout} onClick={() => { if (operation.current) { try { sessionStorage.removeItem(operation.current.storageKey); } catch { /* Storage may be disabled. */ } } operation.current = null; setSelected(null); setFileId(''); setRecord(null); setError(''); const input = document.getElementById(id) as HTMLInputElement | null; if (input) input.value = ''; }}>{copy.another}</button></div></>}
  </div>;
}
