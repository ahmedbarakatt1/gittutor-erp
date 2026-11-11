'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IdentityForm, TextField, uuidPattern } from './identity-form';
import { authCopy, identityCopy as copy } from '@/locales/auth';
import styles from './auth.module.css';

type Contact = { contact_id: string; channel: string; masked_destination: string; verified: boolean };
type Subject = { subject_id: string; title: string };
type TutorProfile = { version: number; display_name: string; bio: string; subject_ids: string[]; contact_id: string; locale: string };
type ReferenceData = { contacts: Contact[]; subjects: Subject[]; profile?: TutorProfile };

function useReferenceData(includeSubjects = false, includeProfile = false) {
  const [data, setData] = useState<ReferenceData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function get(path: string) {
      const response = await fetch(`/api/v1/${path}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('REFERENCE_DATA_UNAVAILABLE');
      return (await response.json()).data;
    }
    Promise.all([get('me/contacts'), includeSubjects ? get('me/application-subjects') : Promise.resolve({ items: [] }), includeProfile ? get('tutor/profile') : Promise.resolve(undefined)])
      .then(([contacts, subjects, profile]) => {
        if (!Array.isArray(contacts?.items) || !Array.isArray(subjects?.items)) throw new Error('REFERENCE_DATA_UNAVAILABLE');
        if (!controller.signal.aborted) setData({ contacts: contacts.items.filter((contact: Contact) => contact.verified), subjects: subjects.items, profile });
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [includeSubjects, includeProfile, attempt]);
  const retry = useCallback(() => { setFailed(false); setData(null); setAttempt(value => value + 1); }, []);
  return { data, failed, retry };
}

function ReferenceState({ failed, retry }: { failed: boolean; retry: () => void }) {
  return failed ? <div className={styles.error} role="alert"><p>{copy.loadFailed}</p><button className={styles.signout} onClick={retry} type="button">{copy.retry}</button></div> : <p className={styles.loading} role="status">{copy.loading}</p>;
}

export function usePagedRecords<T>(path: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const paging = useRef(false);
  const invalidate = useCallback(() => {
    generation.current += 1;
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
    paging.current = false;
    return generation.current;
  }, []);
  useEffect(() => {
    const current = invalidate();
    const controller = new AbortController();
    controllers.current.add(controller);
    fetch(`/api/v1/${path}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('RECORDS_UNAVAILABLE');
      const body = await response.json();
      if (!Array.isArray(body.data?.items)) throw new Error('RECORDS_UNAVAILABLE');
      if (generation.current === current && !controller.signal.aborted) { setItems(body.data.items); setCursor(body.data.next_cursor); }
    }).catch(() => { if (generation.current === current && !controller.signal.aborted) setFailed(true); }).finally(() => controllers.current.delete(controller));
    return () => { if (generation.current === current) invalidate(); };
  }, [path, attempt, invalidate]);
  function reload() { invalidate(); setItems(null); setCursor(null); setFailed(false); setLoadingMore(false); setAttempt(value => value + 1); }
  async function loadMore() {
    if (!cursor || paging.current) return;
    const current = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    paging.current = true;
    setLoadingMore(true); setFailed(false);
    try {
      const response = await fetch(`/api/v1/${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('RECORDS_UNAVAILABLE');
      const body = await response.json();
      if (!Array.isArray(body.data?.items)) throw new Error('RECORDS_UNAVAILABLE');
      if (generation.current === current && !controller.signal.aborted) { setItems(previous => [...(previous || []), ...body.data.items]); setCursor(body.data.next_cursor); }
    } catch { if (generation.current === current && !controller.signal.aborted) setFailed(true); }
    finally { controllers.current.delete(controller); if (generation.current === current) { paging.current = false; setLoadingMore(false); } }
  }
  return { items, cursor, failed, loadingMore, reload, loadMore };
}

function MoreRecords({ records }: { records: { cursor: string | null; loadingMore: boolean; failed: boolean; loadMore: () => Promise<void> } }) {
  return <>{records.failed && <p className={styles.fieldError} role="alert">{copy.loadFailed}</p>}{records.cursor && <button className={styles.signout} type="button" disabled={records.loadingMore} onClick={records.loadMore}>{records.loadingMore ? copy.loadingMore : copy.loadMore}</button>}</>;
}

function ContactList({ contacts }: { contacts: Contact[] }) {
  return <section className={styles.workflow}><h2>{copy.verifiedContacts}</h2><p>{copy.contactsDescription}</p>{contacts.length ? <ul className={styles.contactList}>{contacts.map(contact => <li key={contact.contact_id}><span>{contact.masked_destination}</span><span className={styles.hint}>{copy.contactReference}</span><strong>{contact.contact_id}</strong></li>)}</ul> : <p>{copy.noContacts}</p>}</section>;
}

function InvitationVersion() { return <input type="hidden" name="expected_version" value="1" />; }
function version(data: FormData) { return Number(data.get('expected_version')); }
function reference(data: FormData, name: string) { return encodeURIComponent(String(data.get(name) || '').trim()); }

function ChoiceGroup({ name, label, items, hint, defaultValues = [] }: { name: string; label: string; items: { value: string; label: string }[]; hint: string; defaultValues?: string[] }) {
  const [selected, setSelected] = useState(defaultValues.filter(value => items.some(item => item.value === value)));
  const prefix = useId();
  return <fieldset className={styles.checkGroup} aria-describedby={`${prefix}-hint`}><legend>{label}</legend>{items.map((item, index) => <label key={item.value}><input type="checkbox" name={name} value={item.value} checked={selected.includes(item.value)} required={index === 0 && !selected.length} onChange={event => setSelected(values => event.target.checked ? [...values, item.value] : values.filter(value => value !== item.value))} />{item.label}</label>)}<p className={styles.hint} id={`${prefix}-hint`}>{hint}</p></fieldset>;
}

export function GuardianWorkspace({ staffInvitationId }: { staffInvitationId?: string }) {
  const { data, failed, retry } = useReferenceData();
  const router = useRouter();
  return <>
    {data ? <ContactList contacts={data.contacts} /> : <section className={styles.workflow}><ReferenceState failed={failed} retry={retry} /></section>}
    <StaffInvitationAcceptance invitationId={staffInvitationId} />
    <section className={styles.workflow} aria-labelledby="guardian-heading">
      <h2 id="guardian-heading">{copy.guardian.title}</h2><p>{copy.guardian.description}</p>
      <div className={styles.workflowColumns}>
        <section><h3>{copy.guardian.inviteTitle}</h3>
          <IdentityForm action="guardian-invitations" submitLabel={copy.guardian.invite} successMessage={copy.guardian.inviteSuccess} payload={form => {
            const scopes = form.getAll('scopes');
            if (!scopes.length) throw new Error('SCOPE_REQUIRED');
            return { contact_id: String(form.get('contact_id')).trim(), scopes, expires_at: new Date(String(form.get('expires_at'))).toISOString() };
          }}>
            <TextField name="contact_id" label={copy.guardian.contact} hint={copy.guardian.contactHint} pattern={uuidPattern} />
            <ChoiceGroup name="scopes" label={copy.guardian.scopes} hint={copy.guardian.scopesHint} items={Object.entries(copy.guardian.scopeNames).map(([value, label]) => ({ value, label }))} />
            <TextField name="expires_at" label={copy.guardian.expires} type="datetime-local" hint={copy.guardian.expiresHint} />
          </IdentityForm>
        </section>
        <section><h3>{copy.guardian.acceptTitle}</h3><p>{copy.guardian.acceptDescription}</p>
          <IdentityForm action={form => `guardian-invitations/${reference(form, 'invitation_id')}/accept`} submitLabel={copy.guardian.accept} successMessage={copy.guardian.acceptSuccess} onSaved={() => router.refresh()} payload={form => ({ single_use_token: String(form.get('single_use_token')).trim(), expected_version: version(form) })}>
            <TextField name="invitation_id" label={copy.guardian.invitation} pattern={uuidPattern} />
            <TextField name="single_use_token" label={copy.guardian.token} type="password" maxLength={256} />
            <InvitationVersion />
          </IdentityForm>
        </section>
      </div>
      <GuardianRevocation />
    </section>
  </>;
}

export function StaffAccessWorkspace() {
  const roleId = useId();
  const inviteRoleId = useId();
  return <section className={styles.workflow} aria-labelledby="staff-access-heading"><h2 id="staff-access-heading">{copy.staff.title}</h2><p>{copy.staff.description}</p>
    <details className={styles.advanced}><summary>{copy.staff.inviteTitle}</summary><p>{copy.staff.inviteDescription}</p>
      <IdentityForm action="staff-invitations" submitLabel={copy.staff.invite} successMessage={copy.staff.inviteSuccess} payload={form => ({ email: String(form.get('email')).trim(), role: form.get('role'), reason: String(form.get('reason')).trim(), expires_at: new Date(String(form.get('expires_at'))).toISOString() })}>
        <TextField name="email" label={copy.staff.email} type="email" maxLength={254} />
        <div className={styles.field}><label htmlFor={inviteRoleId}>{copy.staff.role}</label><select id={inviteRoleId} name="role" required>{['tutor', 'customer_service', 'admin'].map(role => <option key={role} value={role}>{authCopy.portal.roleLabels[role]}</option>)}</select></div>
        <TextField name="reason" label={copy.reason} maxLength={1000} />
        <TextField name="expires_at" label={copy.staff.expires} type="datetime-local" hint={copy.staff.expiresHint} />
      </IdentityForm>
    </details>
    <div className={styles.workflowColumns}>
      <section><h3>{copy.staff.grantTitle}</h3><IdentityForm action="staff-role-grants" submitLabel={copy.staff.grant} successMessage={copy.staff.grantSuccess} payload={form => ({ account_id: String(form.get('account_id')).trim(), role: form.get('role'), reason: String(form.get('reason')).trim() })}>
        <TextField name="account_id" label={copy.staff.account} pattern={uuidPattern} />
        <div className={styles.field}><label htmlFor={roleId}>{copy.staff.role}</label><select id={roleId} name="role" required>{['tutor', 'customer_service', 'admin'].map(role => <option key={role} value={role}>{authCopy.portal.roleLabels[role]}</option>)}</select></div>
        <TextField name="reason" label={copy.reason} maxLength={1000} />
      </IdentityForm></section>
      <StaffRoleRevocation />
    </div>
  </section>;
}

function StaffInvitationAcceptance({ invitationId }: { invitationId?: string }) {
  const router = useRouter();
  return <section className={styles.workflow}><details className={styles.staffInvitation} open={Boolean(invitationId)}><summary>{copy.staff.acceptTitle}</summary><p>{copy.staff.acceptDescription}</p>
    <IdentityForm action={form => `staff-invitations/${reference(form, 'staff_invitation_id')}/accept`} submitLabel={copy.staff.accept} successMessage={copy.staff.acceptSuccess} onSaved={() => router.refresh()} payload={form => ({ expected_version: version(form) })}>
      <TextField name="staff_invitation_id" label={copy.staff.invitationReference} pattern={uuidPattern} defaultValue={invitationId} />
      <InvitationVersion />
    </IdentityForm>
  </details></section>;
}

type GuardianLink = { guardian_link_id: string; learner_id: string; learner_name: string; guardian_masked_contact: string; scopes: string[]; version: number; can_revoke: boolean };

function GuardianRevocation() {
  const records = usePagedRecords<GuardianLink>('me/guardian-links');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const pickerId = useId();
  const router = useRouter();
  const revocable = records.items?.filter(link => link.can_revoke) || [];
  const selected = revocable.find(link => link.guardian_link_id === selectedId);
  function refresh() { setSelectedId(''); records.reload(); }
  return <details className={styles.advanced} onToggle={event => { if (event.currentTarget.open) refresh(); }}><summary>{copy.guardian.revokeTitle}</summary><p>{copy.guardian.revokeDescription}</p>
    {!records.items ? <ReferenceState failed={records.failed} retry={refresh} /> : <>
      <button type="button" className={styles.signout} onClick={refresh} disabled={busy}>{copy.guardian.refreshLinks}</button>
      {revocable.length ? <>
        <div className={`${styles.field} ${styles.recordPicker}`}><label htmlFor={pickerId}>{copy.guardian.chooseLink}</label><select id={pickerId} value={selectedId} disabled={busy} onChange={event => setSelectedId(event.target.value)}><option value="">{copy.guardian.chooseLinkPrompt}</option>{revocable.map(link => <option key={link.guardian_link_id} value={link.guardian_link_id}>{link.learner_name} · {link.guardian_masked_contact}</option>)}</select></div>
        {selected && <>
          <p className={styles.hint}>{copy.guardian.link}: <span className={styles.reference}>{selected.guardian_link_id}</span></p>
          <p className={styles.hint}>{selected.scopes.map(scope => copy.guardian.scopeNames[scope as keyof typeof copy.guardian.scopeNames] || scope).join(', ')}</p>
          <IdentityForm key={selected.guardian_link_id} action={`guardian-links/${selected.guardian_link_id}/revoke`} submitLabel={copy.guardian.revoke} successMessage={copy.guardian.revokeSuccess} resettable={false} onPendingChange={setBusy} onSaved={() => router.refresh()} payload={form => ({ reason: String(form.get('reason')).trim(), expected_version: selected.version })}>
            <TextField name="reason" label={copy.reason} maxLength={1000} />
          </IdentityForm>
        </>}
      </> : <p>{copy.guardian.noLinks}</p>}
      <MoreRecords records={records} />
    </>}
  </details>;
}

type StaffRoleGrant = { role_grant_id: string; account_id: string; display_name: string; masked_email: string; role: string; version: number };

function StaffRoleRevocation() {
  const records = usePagedRecords<StaffRoleGrant>('staff-role-grants');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const pickerId = useId();
  const selected = records.items?.find(grant => grant.role_grant_id === selectedId);
  function refresh() { setSelectedId(''); records.reload(); }
  return <section><h3>{copy.staff.revokeTitle}</h3>
    {!records.items ? <ReferenceState failed={records.failed} retry={refresh} /> : <>
      <button type="button" className={styles.signout} onClick={refresh} disabled={busy}>{copy.staff.refreshGrants}</button>
      {records.items.length ? <div className={`${styles.field} ${styles.recordPicker}`}><label htmlFor={pickerId}>{copy.staff.chooseGrant}</label><select id={pickerId} value={selectedId} disabled={busy} onChange={event => setSelectedId(event.target.value)}><option value="">{copy.staff.chooseGrantPrompt}</option>{records.items.map(grant => <option key={grant.role_grant_id} value={grant.role_grant_id}>{grant.display_name} · {grant.masked_email} · {authCopy.portal.roleLabels[grant.role]}</option>)}</select></div> : <p>{copy.staff.noGrants}</p>}
      {selected && <>
        <p className={styles.hint}>{copy.staff.grantReference}: <span className={styles.reference}>{selected.role_grant_id}</span></p>
        <IdentityForm key={selected.role_grant_id} action={`staff-role-grants/${selected.role_grant_id}/revoke`} submitLabel={copy.staff.revoke} successMessage={copy.staff.revokeSuccess} resettable={false} onPendingChange={setBusy} payload={form => ({ reason: String(form.get('reason')).trim(), expected_version: selected.version })}>
          <TextField name="reason" label={copy.reason} maxLength={1000} />
        </IdentityForm>
      </>}
      <MoreRecords records={records} />
    </>}
  </section>;
}

type TutorApplication = { application_id: string; applicant_account_id: string; display_name: string; bio: string; subject_ids: string[]; version: number; state: string; created_at: string };

export function TutorApplicationReview() {
  const { data, failed, retry } = useReferenceData(true);
  const applications = usePagedRecords<TutorApplication>('tutor-applications');
  const [selected, setSelected] = useState<TutorApplication | null>(null);
  const [decision, setDecision] = useState('approved');
  function refresh() { setSelected(null); applications.reload(); retry(); }
  const pending = applications.items?.filter(application => application.state === 'pending');
  return <section className={styles.workflow}><h2>{copy.application.reviewTitle}</h2><p>{copy.application.reviewDescription}</p>
    {!data || !applications.items ? <ReferenceState failed={failed || applications.failed} retry={refresh} /> : <>
      <button type="button" className={styles.signout} onClick={refresh}>{copy.application.refresh}</button>
      {pending?.length ? <div className={styles.reviewLayout}><ul className={styles.applicationList}>{pending.map(application => <li key={application.application_id}><button type="button" aria-pressed={selected?.application_id === application.application_id} onClick={() => { setSelected(application); setDecision('approved'); }}><strong>{application.display_name}</strong><span>{application.application_id}</span></button></li>)}</ul>
        {selected ? <section className={styles.applicationDetail}><h3>{selected.display_name}</h3><p className={styles.profileBio}>{selected.bio}</p><p className={styles.hint}>{copy.application.applicantReference}: <span className={styles.reference}>{selected.applicant_account_id}</span></p><h4>{copy.application.submittedSubjects}</h4><ul>{selected.subject_ids.map(id => <li key={id}>{data.subjects.find(subject => subject.subject_id === id)?.title || id}</li>)}</ul>
          <IdentityForm key={`${selected.application_id}:${selected.version}`} action={`tutor-applications/${selected.application_id}/review`} submitLabel={copy.application.reviewSubmit} successMessage={copy.application.reviewSuccess} resettable={false} payload={form => {
            const approved_subject_ids = decision === 'approved' ? form.getAll('approved_subject_ids') : [];
            if (decision === 'approved' && !approved_subject_ids.length) throw new Error('SUBJECT_REQUIRED');
            return { decision, reason: String(form.get('reason')).trim(), approved_subject_ids, expected_version: selected.version };
          }}>
            <fieldset className={styles.checkGroup}><legend>{copy.application.decision}</legend><label><input type="radio" name="decision" value="approved" checked={decision === 'approved'} onChange={() => setDecision('approved')} />{copy.application.approve}</label><label><input type="radio" name="decision" value="rejected" checked={decision === 'rejected'} onChange={() => setDecision('rejected')} />{copy.application.reject}</label></fieldset>
            {decision === 'approved' && <ChoiceGroup key={selected.application_id} name="approved_subject_ids" label={copy.application.approvedSubjects} hint={copy.subjectHint} items={data.subjects.filter(subject => selected.subject_ids.includes(subject.subject_id)).map(subject => ({ value: subject.subject_id, label: subject.title }))} defaultValues={selected.subject_ids} />}
            <TextField name="reason" label={copy.reason} maxLength={1000} />
          </IdentityForm>
        </section> : <p>{copy.application.choose}</p>}
      </div> : <p>{copy.application.empty}</p>}
      <MoreRecords records={applications} />
    </>}
  </section>;
}

function TeachingFields({ data }: { data: ReferenceData }) {
  const prefix = useId();
  return <>
    <TextField name="display_name" label={copy.name} maxLength={120} defaultValue={data.profile?.display_name} />
    <div className={styles.field}><label htmlFor={`${prefix}-bio`}>{copy.bio}</label><textarea id={`${prefix}-bio`} name="bio" required maxLength={5000} rows={5} defaultValue={data.profile?.bio} /></div>
    <ChoiceGroup name="subject_ids" label={copy.subjects} hint={data.subjects.length ? copy.subjectHint : copy.noSubjects} items={data.subjects.map(subject => ({ value: subject.subject_id, label: subject.title }))} defaultValues={data.profile?.subject_ids} />
    <div className={styles.field}><label htmlFor={`${prefix}-contact`}>{copy.contact}</label><select name="contact_id" id={`${prefix}-contact`} required defaultValue={data.profile?.contact_id || ''}><option value="" disabled>{copy.chooseContact}</option>{data.contacts.map(contact => <option key={contact.contact_id} value={contact.contact_id}>{contact.masked_destination}</option>)}</select>{!data.contacts.length && <p className={styles.hint}>{copy.noContacts}</p>}</div>
    {data.profile && <div className={styles.field}><label htmlFor={`${prefix}-locale`}>{copy.locale}</label><select name="locale" id={`${prefix}-locale`} defaultValue={data.profile.locale}><option value="en">{copy.english}</option><option value="ar">{copy.arabic}</option></select></div>}
  </>;
}

function teachingPayload(form: FormData) {
  const subject_ids = form.getAll('subject_ids');
  if (!subject_ids.length) throw new Error('SUBJECT_REQUIRED');
  return { display_name: String(form.get('display_name')).trim(), bio: String(form.get('bio')).trim(), subject_ids, contact_id: form.get('contact_id') };
}

export function TutorApplicationForm() {
  const { data, failed, retry } = useReferenceData(true);
  if (!data) return <ReferenceState failed={failed} retry={retry} />;
  return <IdentityForm action="tutor-applications" payload={teachingPayload} submitLabel={copy.application.submit} successMessage={copy.application.success} disabled={!data.contacts.length || !data.subjects.length} resettable={false}><TeachingFields data={data} /></IdentityForm>;
}

export function TutorProfileWorkspace() {
  const { data, failed, retry } = useReferenceData(true, true);
  return <section className={styles.workflow}><h2>{copy.tutor.title}</h2><p>{copy.tutor.description}</p>
    {!data ? <ReferenceState failed={failed} retry={retry} /> : <IdentityForm action="tutor/profile" payload={form => ({ ...teachingPayload(form), locale: form.get('locale'), expected_version: data.profile?.version })} submitLabel={copy.tutor.submit} successMessage={copy.tutor.success} disabled={!data.contacts.length || !data.subjects.length || !data.profile} resettable={false}><TeachingFields data={data} /></IdentityForm>}
  </section>;
}
