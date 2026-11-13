'use client';

import type { TutorReassignment } from '@/modules/teaching/operations';
import { reassignmentCopy as copy } from '@/locales/tutor-reassignment';
import { IdentityForm, TextField } from '../identity-form';
import { CairoTimestamp, Check, money, SessionTime } from '../booking/shared';
import { PaymentReadState, usePaymentClock, usePaymentList } from '../payments/shared';
import styles from '../files/files.module.css';

type CustomerReassignment = Extract<TutorReassignment, { view: 'customer' }>;

export function CustomerTutorReassignments({ occurrenceId, learnerId }: { occurrenceId: string; learnerId: string }) {
  const path = `tutor-reassignments?view=customer&occurrence_id=${occurrenceId}&learner_id=${learnerId}`;
  return <CustomerReassignmentRecords key={path} path={path} />;
}

function CustomerReassignmentRecords({ path }: { path: string }) {
  const records = usePaymentList<CustomerReassignment>(path), now = usePaymentClock();
  return <section className={styles.section}><h2>{copy.title}</h2><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p>{copy.noChanges}</p>}{records.items?.filter(item => item.view === 'customer').map(item => <details className={styles.section} key={`${item.proposal_id}-${item.version}`} data-reassignment-id={item.proposal_id}>
    <summary>{item.old_tutor.display_name} → {item.new_tutor.display_name} · {copy.state[item.state]}</summary><SessionTime start={item.start_at} end={item.end_at} /><p>{copy.from}: {item.old_tutor.display_name}</p><p>{copy.to}: {item.new_tutor.display_name}</p>{['proposed', 'accepted', 'approved'].includes(item.state) && <p>{copy.intro}</p>}<p>{copy.expires}: <CairoTimestamp value={item.expires_at} /></p>{item.required_actions.map(action => <p className={styles.notice} key={action}>{copy.actions[action]}</p>)}
    <p>{copy.unchanged}</p><p>{copy.price}: <strong>{money(item.terms.customer_price_minor, item.terms.currency)}</strong></p>
    {item.can_accept && <IdentityForm action={`tutor-reassignments/${item.proposal_id}/accept`} submitLabel={copy.accept} successMessage={copy.accepted} resettable={false} disabled={!now || now >= Date.parse(item.expires_at)} onSaved={records.reload} payload={() => ({ terms_hash: item.terms_hash, expected_version: item.version })}><Check name="consent" label={copy.consent} /></IdentityForm>}
    {item.can_decline && <IdentityForm action={`tutor-reassignments/${item.proposal_id}/decline`} submitLabel={copy.decline} successMessage={copy.declined} resettable={false} onSaved={records.reload} payload={form => ({ reason: String(form.get('reason')).trim(), expected_version: item.version })}><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm>}
  </details>)}</section>;
}
