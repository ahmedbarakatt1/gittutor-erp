'use client';

import { useEffect, useState } from 'react';
import type { FileView } from '@/modules/files/queries';
import { fileCopy as copy } from '@/locales/files';
import { IdentityForm, TextField } from '../identity-form';
import { Select, SessionTime, cairoDate } from '../booking/shared';
import { PaymentReadState, usePaymentList } from '../payments/shared';
import { FileUpload } from './file-upload';
import styles from './files.module.css';

type MaterialEnrollment = { enrollment_id: string; learner: { learner_id: string; display_name: string }; occurrence: { occurrence_id: string; title: string; start_at: string; end_at: string } };

export function CustomerStudyFiles({ initialEnrollment }: { initialEnrollment?: string }) {
  const sessions = usePaymentList<MaterialEnrollment>('me/material-enrollments'), [selected, setSelected] = useState(initialEnrollment || '');
  const current = sessions.items?.find(row => row.enrollment_id === selected);
  useEffect(() => { if (initialEnrollment && selected === initialEnrollment && sessions.items && !current && sessions.cursor && !sessions.loadingMore && !sessions.error) void sessions.loadMore(); }, [initialEnrollment, selected, sessions, current]);
  return <><Select name="material_session" label={copy.sessions} value={current?.enrollment_id || ''} onChange={setSelected}><option value="">{copy.chooseSession}</option>{sessions.items?.map(row => <option key={row.enrollment_id} value={row.enrollment_id}>{row.learner.display_name} · {row.occurrence.title} · {cairoDate(row.occurrence.start_at)}</option>)}</Select><PaymentReadState pending={!sessions.items} {...sessions} />{sessions.items?.length === 0 && <p>{copy.noSessions}</p>}{current && <section><h2>{current.learner.display_name} · {current.occurrence.title}</h2><SessionTime start={current.occurrence.start_at} end={current.occurrence.end_at} /><SessionMaterials key={current.enrollment_id} enrollmentId={current.enrollment_id} occurrenceId={current.occurrence.occurrence_id} allowPreparationUpload /></section>}</>;
}

export function SessionMaterials({ enrollmentId, occurrenceId, allowPreparationUpload = false, allowHandoutUpload = false }: { enrollmentId?: string; occurrenceId: string; allowPreparationUpload?: boolean; allowHandoutUpload?: boolean }) {
  const preparation = usePaymentList<FileView>(enrollmentId ? `files?enrollment_id=${enrollmentId}&purpose=private_preparation` : null);
  const handouts = usePaymentList<FileView>(`files?occurrence_id=${occurrenceId}&purpose=shared_handout`);
  return <div className={styles.workspace}>{enrollmentId && <section className={styles.section}><h2>{copy.privateTitle}</h2><p className={styles.intro}>{copy.privateDescription}</p>{allowPreparationUpload && <FileUpload purpose="private_preparation" parentId={enrollmentId} onUploaded={preparation.reload} onReady={preparation.reload} />}<PaymentReadState pending={!preparation.items} {...preparation} /><FileList files={preparation.items} onSaved={preparation.reload} /></section>}<section className={styles.section}><h2>{copy.sharedTitle}</h2><p className={styles.intro}>{copy.sharedDescription}</p>{allowHandoutUpload && <FileUpload purpose="shared_handout" parentId={occurrenceId} onUploaded={handouts.reload} onReady={handouts.reload} />}<PaymentReadState pending={!handouts.items} {...handouts} /><FileList files={handouts.items} onSaved={handouts.reload} /></section></div>;
}

export function StaffSessionMaterials({ occurrenceId, roster }: { occurrenceId: string; roster: { enrollment_id: string; display_name: string }[] }) {
  const [selected, setSelected] = useState('');
  const current = roster.find(row => row.enrollment_id === selected);
  return <section className={styles.section}><Select name="preparation_learner" label={copy.learner} value={current?.enrollment_id || ''} onChange={setSelected}><option value="">{copy.chooseLearner}</option>{roster.map(row => <option key={row.enrollment_id} value={row.enrollment_id}>{row.display_name}</option>)}</Select><SessionMaterials key={`${occurrenceId}-${selected}`} enrollmentId={current?.enrollment_id} occurrenceId={occurrenceId} allowHandoutUpload /></section>;
}

function FileList({ files, onSaved }: { files: FileView[] | undefined; onSaved: () => void }) {
  return <>{files?.length === 0 && <p>{copy.empty}</p>}<ul className={styles.list}>{files?.map(file => <li className={styles.file} key={file.file_id}><h3>{file.filename}</h3><p className={styles.meta}><span>{file.detected_type || copy.safeStates[file.upload_state]}</span><span>{new Intl.NumberFormat('en-GB').format(file.size_bytes)} B</span><span>{copy.safeStates[file.scan_state]}</span><span>{copy.safeStates[file.publication_state]}</span></p>{file.integration_state === 'simulated' && <p className={styles.notice}>{copy.simulated}</p>}{file.source_provenance === 'metadata_only' && <p>{copy.metadataOnly}</p>}{file.scan_state === 'quarantined' && <p role="status">{copy.quarantined}</p>}{file.publication_state === 'unpublished' && <p>{copy.unpublished}</p>}{file.can_download && file.content_path === `/api/v1/files/${file.file_id}/content` && <p><a className={styles.link} href={file.content_path} download>{copy.download}</a></p>}{file.can_publish && <IdentityForm action={`files/${file.file_id}/publish`} submitLabel={copy.publish} successMessage={copy.published} resettable={false} onSaved={onSaved} payload={() => ({ expected_version: file.version })}><p>{copy.sharedDescription}</p></IdentityForm>}{file.can_withdraw && <details><summary>{copy.withdraw}</summary><IdentityForm action={`files/${file.file_id}/withdraw`} submitLabel={copy.withdraw} successMessage={copy.withdrawn} resettable={false} onSaved={onSaved} payload={form => ({ reason: String(form.get('reason')).trim(), expected_version: file.version })}><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm></details>}</li>)}</ul></>;
}
