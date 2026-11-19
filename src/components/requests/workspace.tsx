'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { TutoringRequestView, RequestFormat, RequestMatch, RequestState } from '@/modules/requests/queries';
import { paymentCopy } from '@/locales/payments';
import { sessionLength, tuition } from '@/modules/catalog/public-tuition';
import { formatMinorUnits } from '@/modules/shared/format';
import { IdentityForm, TextField } from '../identity-form';
import { Select, SessionTime, cairoDate } from '../booking/shared';
import { PaymentReadState, usePaymentList } from '../payments/shared';
import { FileUpload } from '../files/file-upload';
import styles from './workspace.module.css';

const formatNames: Record<RequestFormat, string> = {
  individual: 'Individual', group2: 'Group of 2', group3: 'Group of 3', group4: 'Group of 4', undecided: 'Help me choose',
};
const states: Record<RequestState, string> = { draft: 'Draft — add your material', submitted: 'Submitted', reviewing: 'Under review', needs_information: 'More information needed', matched: 'Session proposed', closed: 'Closed' };
type Learner = { learner_id: string; display_name: string };
const bodyFrom = (form: FormData) => Object.fromEntries(['topic', 'course', 'description', 'preferred_times', 'format'].map(key => [key, String(form.get(key) || '').trim()]));

export function RequestWorkspace({ view = 'learn', selectedId, initialTopic = '' }: { view?: 'learn' | 'service' | 'admin'; selectedId?: string; initialTopic?: string }) {
  const staff = view !== 'learn', path = `/${view}/requests`;
  const requests = usePaymentList<TutoringRequestView>(staff ? 'requests/queue' : 'requests');
  return <div className={styles.workspace}>
    <aside className={styles.history} aria-label={staff ? 'Request queue' : 'Your requests'}>
      <div className={styles.heading}><h2>{staff ? 'Request queue' : 'Your requests'}</h2>{!staff && <Link href={path}>New request</Link>}</div>
      <PaymentReadState pending={!requests.items} {...requests} />
      {requests.items?.length === 0 && <p className={styles.empty}>{staff ? 'New requests will appear here when customers submit their material.' : 'Start with your topic. You can add your slides before sending the request.'}</p>}
      <ul className={styles.list}>{requests.items?.map(request => <li key={request.request_id}><Link aria-current={selectedId === request.request_id ? 'page' : undefined} href={`${path}?request=${request.request_id}`}><strong>{request.topic}</strong><span>{request.learner.display_name}</span><span className={styles.status}>{states[request.state]}</span><small>{cairoDate(request.created_at)}</small></Link></li>)}</ul>
    </aside>
    <div className={styles.content}>{selectedId ? <RequestDetail key={selectedId} id={selectedId} view={view} onChange={requests.reload} /> : staff ? <section className={styles.empty}><h2>Review a tutoring request</h2><p>Open a request to read the student’s brief and material, reply, or propose a scheduled session.</p></section> : <CreateRequest initialTopic={initialTopic} />}</div>
  </div>;
}

function RequestFields({ initial, topic = '' }: { initial?: TutoringRequestView; topic?: string }) {
  const [format, setFormat] = useState<RequestFormat>(initial?.format || 'individual');
  return <><div className={styles.formGrid}><TextField name="topic" label="Subject or topic" defaultValue={initial?.topic || topic} maxLength={160} hint="Any subject is welcome for review. You don’t need to choose from a fixed list." /><TextField name="course" label="Course or university (optional)" defaultValue={initial?.course} maxLength={160} required={false} /></div>
    <TextField name="description" label="What would you like help with?" defaultValue={initial?.description} multiline maxLength={4000} hint="Tell us which concepts, slides or questions you want to work through." />
    <div className={styles.formGrid}><Select name="format" label="Study format" value={format} onChange={value => setFormat(value as RequestFormat)}>
      {tuition.tiers.map(tier => <option key={tier.format} value={tier.format}>{formatNames[tier.format as RequestFormat]} · EGP {tier.price_minor / 100}{tier.students > 1 && ' per student'}</option>)}
      <option value="undecided">{formatNames.undecided}</option>
    </Select><TextField name="preferred_times" label="Preferred days and times" defaultValue={initial?.preferred_times} maxLength={1000} hint={`Use Egypt time. For example: Sunday or Tuesday after 6 pm. Sessions last ${sessionLength}.`} /></div>
  </>;
}

function CreateRequest({ initialTopic }: { initialTopic: string }) {
  const router = useRouter(), learners = usePaymentList<Learner>('me/learners');
  const [selected, setSelected] = useState('');
  const learner = learners.items?.find(item => item.learner_id === selected) || (learners.items?.length === 1 ? learners.items[0] : undefined);
  return <section><div className={styles.intro}><h2>What are you working on?</h2><p>Tell us what you need, then upload your material and submit. We’ll review it and arrange the right session with you.</p></div>
    <PaymentReadState pending={!learners.items} {...learners} />
    {learners.items?.length === 0 ? <p className={styles.notice}>Add or link the learner first, so their material stays in the right account. <Link href="/learn#learners">Manage learners</Link></p> : <IdentityForm action="requests" submitLabel="Continue to upload material" successMessage="Draft saved. Add your material to submit." disabled={!learner} resettable={false} releaseKeyOnSuccess payload={form => ({ ...bodyFrom(form), learner_id: learner!.learner_id })} onSaved={result => router.push(`/learn/requests?request=${result.resource_id}`)}>
      <Select name="learner_id" label="Who is the session for?" value={learner?.learner_id || ''} onChange={setSelected}><option value="">Choose the learner</option>{learners.items?.map(item => <option key={item.learner_id} value={item.learner_id}>{item.display_name}</option>)}</Select>
      <RequestFields topic={initialTopic} /><p className={styles.hint}>This saves a draft. You’ll upload your material before sending the request. No payment is due now.</p>
    </IdentityForm>}
  </section>;
}

function useRequestRecord(id: string) {
  const [record, setRecord] = useState<{ data?: TutoringRequestView; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scanPending = false;
    async function read() {
      try {
        const response = await fetch(`/api/v1/requests/${id}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (controller.signal.aborted) return;
        if ([401, 403, 404].includes(response.status)) {
          scanPending = false;
          setRecord({ error: paymentCopy.permission });
          return;
        }
        if (!response.ok) throw new Error('REQUEST_READ_FAILED');
        const { data } = await response.json() as { data?: TutoringRequestView };
        if (controller.signal.aborted) return;
        if (data?.request_id !== id.toLowerCase() || !Array.isArray(data.files)) throw new Error('REQUEST_READ_FAILED');
        scanPending = data.files.some(file => file.upload_state === 'finalized' && file.scan_state === 'pending');
        setRecord({ data });
      } catch {
        if (!controller.signal.aborted) setRecord(previous => ({ ...previous, error: paymentCopy.failed }));
      } finally {
        if (!controller.signal.aborted && scanPending) timer = setTimeout(read, 2000);
      }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, attempt]);
  return { ...record, reload };
}

function RequestDetail({ id, view, onChange }: { id: string; view: 'learn' | 'service' | 'admin'; onChange: () => void }) {
  const router = useRouter();
  const record = useRequestRecord(id), item = record.data;
  const reload = () => { record.reload(); onChange(); };
  return <><PaymentReadState pending={!item} {...record} />{item && <section key={`${item.request_id}:${item.version}`}>
    <div className={styles.detailHeading}><h2>{item.topic}</h2><span className={styles.status}>{states[item.state]}</span></div>
    <p className={styles.hint}>{item.learner.display_name}{item.course ? ` · ${item.course}` : ''}</p>
    <dl className={styles.facts}><div><dt>Study format</dt><dd>{formatNames[item.format]}</dd></div><div><dt>Preferred times · Egypt</dt><dd>{item.preferred_times}</dd></div></dl>
    <h3 className={styles.subheading}>The learning brief</h3><p className={styles.prose}>{item.description}</p>
    {item.customer_reply && <section className={styles.reply}><h3>Git Tutor’s reply</h3><p className={styles.prose}>{item.customer_reply}</p></section>}
    {item.matched_session && <section className={styles.reply}>
      <h3>Your proposed session</h3><p>{item.matched_session.title}</p>
      <p><SessionTime start={item.matched_session.start_at} end={item.matched_session.end_at} /></p>
      <p>{formatMinorUnits(item.matched_session.customer_price_minor)} per student</p>
      {view === 'learn' && (item.matched_session.enrollment_id
        ? <Link className={styles.primary} href={`/learn/bookings/${item.matched_session.enrollment_id}`}>Open your booking</Link>
        : <><p>Review the exact tuition, duration and terms before reserving your place.</p>
          <Link className={styles.primary} href={`/learn/bookings?offer=${item.matched_session.offer_id}&occurrence=${item.matched_session.occurrence_id}`}>Review and book this session</Link></>)}
    </section>}
    {view === 'learn' && item.can_edit && <details className={styles.edit}><summary>Edit your request details</summary><IdentityForm action={`requests/${id}/update`} submitLabel="Save request details" successMessage="Request updated." resettable={false} onSaved={reload} payload={form => ({ ...bodyFrom(form), expected_version: item.version })}><RequestFields initial={item} /></IdentityForm></details>}
    <section className={styles.materials}><h3>Your study material</h3><p className={styles.hint}>Lecture slides, notes or questions. PDF, PPTX and images, up to 25 MB each. Files stay private and must pass a safety check before review.</p>
      <ul className={styles.files}>{item.files.map(file => <li key={file.file_id}><div><strong>{file.filename}</strong><span>{file.scan_state === 'clean' ? 'Ready for review' : file.scan_state === 'quarantined' ? 'File could not pass the safety check' : 'Upload or safety check in progress'}</span>{item.can_edit && view === 'learn' && <IdentityForm action={`requests/${id}/remove-file`} submitLabel={`Remove ${file.filename}`} successMessage="File removed from this request." resettable={false} onSaved={reload} payload={() => ({ file_id: file.file_id, expected_version: item.version })}><span className={styles.hint}>Remove a wrong or rejected file before submitting.</span></IdentityForm>}</div>{file.can_download && <a href={`/api/v1/files/${file.file_id}/content`} download>Download</a>}</li>)}</ul>
      {item.can_edit && view === 'learn' && <FileUpload purpose="request_material" parentId={id} operationScope={String(item.version)} onUploaded={reload} onReady={reload} />}
      {!item.files.length && !item.can_edit && <p>No material attached.</p>}
    </section>
    {view === 'learn' && item.can_edit && <IdentityForm action={`requests/${id}/submit`} submitLabel="Submit tutoring request" successMessage="Request submitted. Your reply will appear here." disabled={!item.files.length || item.files.some(file => file.upload_state !== 'finalized' || file.scan_state !== 'clean')} resettable={false} onSaved={reload} payload={() => ({ expected_version: item.version })}><p>Add your material, wait for it to be ready, then send your request to the team. You can return here to see updates.</p></IdentityForm>}
    {view !== 'learn' && item.can_review && <StaffReview item={item} view={view} onSaved={state => {
      if (view === 'service' && state === 'closed') { onChange(); router.replace('/service/requests'); }
      else reload();
    }} />}
  </section>}</>;
}

function StaffReview({ item, view, onSaved }: { item: TutoringRequestView; view: 'admin' | 'service'; onSaved: (state: string) => void }) {
  const [state, setState] = useState('reviewing'), [occurrence, setOccurrence] = useState(item.matched_session?.occurrence_id || '');
  const matches = usePaymentList<RequestMatch>(state === 'matched' ? `requests/${item.request_id}/matches` : null);
  return <section className={styles.review}><h3>Review and reply</h3><IdentityForm action={`requests/${item.request_id}/review`} submitLabel="Save review and reply" successMessage="Request review saved." resettable={false} disabled={state === 'matched' && !occurrence} onSaved={() => onSaved(state)} payload={form => ({ state, customer_reply: String(form.get('customer_reply') || '').trim() || null, occurrence_id: state === 'matched' ? occurrence : null, expected_version: item.version })}>
    <Select name="state" label="Next step" value={state} onChange={setState}><option value="reviewing">Reviewing material</option><option value="needs_information">Ask for more information</option><option value="matched">Propose a scheduled session</option><option value="closed">Close request</option></Select>
    <TextField name="customer_reply" label="Reply to the student or parent" multiline maxLength={2000} required={state !== 'reviewing'} hint="This message is visible to the customer. Include their next step." />
    {state === 'matched' && <><Select name="occurrence_id" label="Proposed session" value={occurrence} onChange={setOccurrence}><option value="">Choose a scheduled session</option>{matches.items?.map(match => <option key={match.occurrence_id} value={match.occurrence_id}>{match.title} · {cairoDate(match.start_at)} · {formatMinorUnits(match.customer_price_minor)} · {match.available_seats ? `${match.available_seats} ${match.available_seats === 1 ? 'seat' : 'seats'} available` : 'Learner already has a place'}</option>)}</Select><PaymentReadState pending={!matches.items} {...matches} /><p className={styles.hint}>The customer reviews the exact quote and books separately. {view === 'admin' && <Link href="/admin/schedule">Arrange a session in scheduling</Link>}</p></>}
  </IdentityForm></section>;
}
