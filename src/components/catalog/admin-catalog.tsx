'use client';

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import type { AdminOffer, AdminPolicy, AdminPricing, AdminTutor } from '@/modules/catalog/queries';
import { parseScaledIntegerInput, scaledIntegerInput } from '@/modules/shared/format';
import { catalogCopy } from '@/locales/catalog';
import { groupTuition } from '@/modules/catalog/public-tuition';
import { policyCopy } from '@/locales/catalog-policy';
import { IdentityForm, TextField } from '../identity-form';
import { usePagedRecords } from '../identity-workspaces';
import { PolicyFields, readPolicyFields } from './policy-fields';
import styles from './catalog.module.css';
import formStyles from '../auth.module.css';
import { catalogCopy as arabicCatalogCopy } from '@/locales/ar-transaction/catalog';
import { policyCopy as arabicPolicyCopy } from '@/locales/ar-transaction/catalog-policy';
import { useSiteLanguage } from '@/components/site-language';
import { transactionLabel } from '@/locales/ar-transaction/labels';


const textByLanguage = {
  en: { copy: catalogCopy.admin, catalogCopy, policyCopy },
  ar: { copy: arabicCatalogCopy.admin, catalogCopy: arabicCatalogCopy, policyCopy: arabicPolicyCopy },
};

type Scope = 'group' | 'private';
type Subject = { subject_id: string; title: string };
type Records<T> = ReturnType<typeof usePagedRecords<T>>;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as ObjectValue : {};
const minor = (value: FormDataEntryValue | null) => parseScaledIntegerInput(String(value ?? ''), 2);
const amount = (value: unknown) => typeof value === 'number' ? scaledIntegerInput(value, 2) : '';
const short = (id: string) => id.slice(0, 8);
function statusLabel(status: string, language: 'ar' | 'en') {
  const labels = textByLanguage[language].copy;
  const states: Record<string, string> = { draft: labels.draft, approved: labels.approvedState, published: labels.publishedState, retired: labels.retired };
  return states[status] ?? status;
}
function label(scope: Scope, id: string, status: string, language: 'ar' | 'en') {
  return `${textByLanguage[language].catalogCopy.formats[scope]} · ${statusLabel(status, language)} · ${short(id)}`;
}

function Select({ name, label, children, value, onChange, defaultValue, disabled = false }: { name: string; label: string; children: ReactNode; value?: string; onChange?: (value: string) => void; defaultValue?: string; disabled?: boolean }) {
  const id = useId();
  return <div className={formStyles.field}><label htmlFor={id}>{label}</label><select id={id} name={name} value={value} onChange={onChange ? event => onChange(event.target.value) : undefined} defaultValue={defaultValue} disabled={disabled} required>{children}</select></div>;
}
function MoneyField({ name, label, value }: { name: string; label: string; value?: unknown }) {
  const id = useId(); return <div className={formStyles.field}><label htmlFor={id}>{label}</label><input id={id} name={name} type="number" inputMode="decimal" min="0" step="0.01" required defaultValue={amount(value)} /></div>;
}
function LoadState<T>({ records }: { records: Records<T> }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  return <>{records.items === null && !records.failed && <p className={formStyles.loading} role="status">{copy.loading}</p>}{records.failed && <p className={formStyles.error} role="alert">{copy.failed}</p>}<div className={styles.recordsAction}><button type="button" className={formStyles.signout} onClick={records.reload}>{copy.refresh}</button>{records.cursor && <button type="button" className={formStyles.signout} disabled={records.loadingMore} onClick={records.loadMore}>{copy.more}</button>}</div></>;
}
function Validation({ errors }: { errors: string[] }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];
 return errors.length ? <div role="status"><h3>{copy.validation}</h3><ul className={styles.errors}>{errors.map(error => <li key={error}>{error.replaceAll('_', ' ')}</li>)}</ul></div> : null; }
function Approval({ kind, record, onSaved }: { kind: 'policies' | 'pricing-versions'; record: { version: number; validation_errors: string[] }; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const id = 'policy_version_id' in record ? String(record.policy_version_id) : 'pricing_version_id' in record ? String(record.pricing_version_id) : '';
  return <IdentityForm key={`approve-${id}-${record.version}`} action={`${kind}/${id}/approve`} submitLabel={copy.approve} successMessage={copy.approved} disabled={record.validation_errors.length > 0} resettable={false} onSaved={onSaved} payload={form => ({ effective_at: new Date(String(form.get('effective_at'))).toISOString(), approval_note: String(form.get('approval_note')).trim(), expected_version: record.version })}><TextField name="effective_at" label={copy.effectiveAt} type="datetime-local" hint={copy.dateHint} /><TextField name="approval_note" label={copy.approvalNote} maxLength={2000} /></IdentityForm>;
}

function PricingForm({ record, source, onSaved, onBusy }: { record?: AdminPricing; source?: AdminPricing; onSaved: (result: Record<string, unknown>) => void; onBusy: (busy: boolean) => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy, catalogCopy } = textByLanguage[uiLanguage];

  const initial = record || source;
  const [scope, setScope] = useState<Scope>(initial?.scope || 'group');
  const customer = initial?.customer_pricing || {}; const compensation = initial?.compensation || {};
  const bands = Array.isArray(compensation.group_fee_bands) ? compensation.group_fee_bands.map(object) : [];
  const privateFee = object(compensation.private_fee_rule);
  const readOnly = Boolean(record && record.status !== 'draft');
  return <>
    {readOnly && <p className={styles.notice}>{copy.immutable}</p>}
    <IdentityForm action={record ? `pricing-versions/${record.pricing_version_id}/update` : 'pricing-versions'} submitLabel={record ? copy.save : copy.createPricing} successMessage={copy.saved} disabled={readOnly} onPendingChange={onBusy} resettable={false} onSaved={onSaved} payload={form => {
      const customer_pricing: ObjectValue = { currency: 'EGP', pricing_unit: 'per_occurrence', duration_minutes: Number(form.get('duration_minutes')) };
      const nextCompensation: ObjectValue = { currency: 'EGP' };
      if (scope === 'group') {
        customer_pricing.group_tiers = groupTuition.map(tier => ({ tier_id: `group_${tier.students}`, group_size: tier.students, seat_price_minor: tier.price_minor }));
        nextCompensation.group_fee_bands = [2, 3, 4].map(size => ({ tier_id: `group_${size}`, fee_min_minor: minor(form.get(`fee_min_${size}`)), fee_max_minor: minor(form.get(`fee_max_${size}`)) }));
      } else { customer_pricing.private_seat_price_minor = minor(form.get('private_tuition')); nextCompensation.private_fee_rule = { currency: 'EGP', fee_min_minor: minor(form.get('fee_min')), fee_max_minor: minor(form.get('fee_max')), exact_occurrence_approval_required: true }; }
      return { customer_pricing, compensation: nextCompensation, ...(record ? { expected_version: record.version } : { scope }) };
    }}>
      <fieldset className={formStyles.formFields} disabled={readOnly}>
        <Select name="scope" label={copy.scope} value={scope} disabled={Boolean(record)} onChange={value => setScope(value as Scope)}><option value="group">{catalogCopy.formats.group}</option><option value="private">{catalogCopy.formats.private}</option></Select>
        <fieldset className={styles.editorGroup}><legend>{copy.publicPricing}</legend><TextField name="duration_minutes" label={copy.duration} type="number" min={1} defaultValue={typeof customer.duration_minutes === 'number' ? customer.duration_minutes : undefined} />{scope === 'group' ? <p>{copy.groupPricing}</p> : <MoneyField name="private_tuition" label={copy.privateTuition} value={customer.private_seat_price_minor} />}</fieldset>
        <fieldset className={styles.editorGroup}><legend>{copy.privatePricing}</legend><p className={formStyles.hint}>{copy.privateNotice}</p>{scope === 'group' ? <><p>{copy.groupCompensation}</p>{[2, 3, 4].map(size => { const band = bands.find(item => item.tier_id === `group_${size}`); return <div key={size}><h4>{size} {catalogCopy.students}</h4><div className={styles.formGrid}><MoneyField name={`fee_min_${size}`} label={`${size} ${catalogCopy.students}: ${copy.minimumFee}`} value={band?.fee_min_minor} /><MoneyField name={`fee_max_${size}`} label={`${size} ${catalogCopy.students}: ${copy.maximumFee}`} value={band?.fee_max_minor} /></div></div>; })}</> : <div className={styles.formGrid}><MoneyField name="fee_min" label={copy.minimumFee} value={privateFee.fee_min_minor} /><MoneyField name="fee_max" label={copy.maximumFee} value={privateFee.fee_max_minor} /></div>}</fieldset>
      </fieldset>
    </IdentityForm>
  </>;
}

function PricingWorkspace({ records }: { records: Records<AdminPricing> }) {
  const uiLanguage = useSiteLanguage();
  const { copy, catalogCopy } = textByLanguage[uiLanguage];

  const [selected, setSelected] = useState(''); const [source, setSource] = useState<AdminPricing>(); const [draftNumber, setDraftNumber] = useState(0); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const record = records.items?.find(item => item.pricing_version_id === selected);
  const saved = (result: Record<string, unknown>) => { setNotice(copy.saved); setSelected(String(result.pricing_version_id || result.resource_id)); setSource(undefined); records.reload(); };
  return <section className={styles.editor} id="pricing"><h2>{copy.pricing}</h2><LoadState records={records} /><button type="button" className={formStyles.signout} disabled={busy} onClick={() => { setSelected(''); setSource(undefined); setDraftNumber(value => value + 1); setNotice(''); }}>{copy.createPricing}</button>{notice && <p className={formStyles.saved} role="status">{notice}</p>}
    <div className={styles.editorColumns}><ul className={styles.recordList}>{records.items?.map(item => <li key={item.pricing_version_id}><button type="button" disabled={busy} aria-pressed={selected === item.pricing_version_id} onClick={() => { setSelected(item.pricing_version_id); setSource(undefined); setNotice(''); }}><strong>{catalogCopy.formats[item.scope]}</strong><span>{statusLabel(item.status, uiLanguage)} · {String(item.customer_pricing.duration_minutes ?? '—')} {catalogCopy.minutes}</span><span>{short(item.pricing_version_id)}</span></button></li>)}</ul>
      <div className={styles.editorPanel}>{record || !selected ? <><PricingForm key={record ? `${record.pricing_version_id}-${record.version}` : `new-${draftNumber}`} record={record} source={source} onSaved={saved} onBusy={setBusy} />{record && <><Validation errors={record.validation_errors} />{record.status === 'draft' && <Approval kind="pricing-versions" record={record} onSaved={() => { setNotice(copy.approved); records.reload(); }} />}<button type="button" className={formStyles.signout} disabled={busy} onClick={() => { setSource(record); setSelected(''); setDraftNumber(value => value + 1); }}>{copy.clone}</button></>}</> : <p>{copy.loading}</p>}</div>
    </div>
  </section>;
}

function PolicyForm({ record, source, pricing, offers, onSaved, onBusy }: { record?: AdminPolicy; source?: AdminPolicy; pricing: AdminPricing[]; offers: AdminOffer[]; onSaved: (result: Record<string, unknown>) => void; onBusy: (busy: boolean) => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy, catalogCopy, policyCopy } = textByLanguage[uiLanguage];

  const initial = record || source;
  const [scope, setScope] = useState<Scope>(initial?.scope || 'group');
  const [pricingId, setPricingId] = useState(String(initial?.content.customer_pricing_version || ''));
  const choice = pricing.find(item => item.pricing_version_id === pricingId);
  const content = initial?.content || {};
  const readOnly = Boolean(record && record.status !== 'draft');
  return <>
    {readOnly && <p className={styles.notice}>{copy.immutable}</p>}
    <IdentityForm action={record ? `policies/${record.policy_version_id}/update` : 'policies'} submitLabel={record ? copy.save : copy.createPolicy} successMessage={copy.saved} disabled={readOnly || !choice} resettable={false} onSaved={onSaved} onPendingChange={onBusy} payload={form => {
      if (!choice || choice.scope !== scope) throw new Error('Choose compatible pricing');
      const next: ObjectValue = { ...readPolicyFields(form, scope), offer_format: scope, currency: 'EGP', pricing_unit: 'per_occurrence', duration_minutes: choice.customer_pricing.duration_minutes, customer_pricing_version: choice.pricing_version_id, compensation_policy_version: choice.pricing_version_id };
      if (scope === 'private') { next.private_seat_price_minor = choice.customer_pricing.private_seat_price_minor; next.private_fee_rule = choice.compensation.private_fee_rule; }
      return { content: next, ...(record ? { expected_version: record.version } : { kind: 'booking', scope }) };
    }}>
      <fieldset className={formStyles.formFields} disabled={readOnly}>
        <Select name="scope" label={copy.scope} value={scope} disabled={Boolean(record)} onChange={value => { setScope(value as Scope); setPricingId(''); }}><option value="group">{catalogCopy.formats.group}</option><option value="private">{catalogCopy.formats.private}</option></Select>
        <Select name="pricing_version_id" label={copy.pricingRecord} value={pricingId} onChange={setPricingId}><option value="">{policyCopy.choose}</option>{pricing.filter(item => item.scope === scope && ['approved', 'published'].includes(item.status)).map(item => <option key={item.pricing_version_id} value={item.pricing_version_id}>{label(item.scope, item.pricing_version_id, item.status, uiLanguage)} · {String(item.customer_pricing.duration_minutes)} {transactionLabel(uiLanguage, "min")}</option>)}</Select>
        {choice && <p className={formStyles.hint}>{String(choice.customer_pricing.duration_minutes)} {catalogCopy.minutes}. {policyCopy.currency}</p>}
        <PolicyFields key={scope} content={content} scope={scope} offers={offers} />
      </fieldset>
    </IdentityForm>
  </>;
}

function PolicyWorkspace({ records, pricing, offers }: { records: Records<AdminPolicy>; pricing: Records<AdminPricing>; offers: Records<AdminOffer> }) {
  const uiLanguage = useSiteLanguage();
  const { copy, catalogCopy } = textByLanguage[uiLanguage];

  const [selected, setSelected] = useState(''); const [source, setSource] = useState<AdminPolicy>(); const [draftNumber, setDraftNumber] = useState(0); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const record = records.items?.find(item => item.policy_version_id === selected);
  return <section className={styles.editor} id="policies"><h2>{copy.policy}</h2><LoadState records={records} /><button type="button" className={formStyles.signout} disabled={busy} onClick={() => { setSelected(''); setSource(undefined); setDraftNumber(value => value + 1); setNotice(''); }}>{copy.createPolicy}</button>{notice && <p className={formStyles.saved} role="status">{notice}</p>}
    <div className={styles.editorColumns}><ul className={styles.recordList}>{records.items?.map(item => <li key={item.policy_version_id}><button type="button" disabled={busy} aria-pressed={selected === item.policy_version_id} onClick={() => { setSelected(item.policy_version_id); setSource(undefined); setNotice(''); }}><strong>{catalogCopy.formats[item.scope]}</strong><span>{statusLabel(item.status, uiLanguage)} · {String(item.content.duration_minutes ?? '—')} {catalogCopy.minutes}</span><span>{short(item.policy_version_id)}</span></button></li>)}</ul>
      <div className={styles.editorPanel}>{record || !selected ? <><PolicyForm key={record ? `${record.policy_version_id}-${record.version}` : `new-${draftNumber}`} record={record} source={source} pricing={pricing.items || []} offers={offers.items || []} onBusy={setBusy} onSaved={result => { setNotice(copy.saved); setSelected(String(result.policy_version_id || result.resource_id)); setSource(undefined); records.reload(); }} />{record && <><Validation errors={record.validation_errors} />{record.status === 'draft' && <Approval kind="policies" record={record} onSaved={() => { setNotice(copy.approved); records.reload(); }} />}<button type="button" className={formStyles.signout} disabled={busy} onClick={() => { setSource(record); setSelected(''); setDraftNumber(value => value + 1); }}>{copy.clone}</button></>}</> : <p>{copy.loading}</p>}</div>
    </div>
  </section>;
}

function OffersWorkspace({ records, policies, pricing, subjects }: { records: Records<AdminOffer>; policies: Records<AdminPolicy>; pricing: Records<AdminPricing>; subjects: Records<Subject> }) {
  const uiLanguage = useSiteLanguage();
  const { copy, catalogCopy, policyCopy } = textByLanguage[uiLanguage];

  const [selected, setSelected] = useState(''); const [policyId, setPolicyId] = useState(''); const [notice, setNotice] = useState('');
  const record = records.items?.find(item => item.offer_id === selected);
  const policy = policies.items?.find(item => item.policy_version_id === policyId);
  const approvedPolicies = policies.items?.filter(item => ['draft', 'approved', 'published'].includes(item.status) && Number.isInteger(item.content.duration_minutes) && Number(item.content.duration_minutes) > 0 && (item.scope === 'private' || [2, 3, 4].includes(Number(item.content.group_target_size)) && Number(item.content.group_capacity) >= Number(item.content.group_target_size)) && pricing.items?.some(price => price.pricing_version_id === item.content.customer_pricing_version && ['draft', 'approved', 'published'].includes(price.status))) || [];
  return <section className={styles.editor} id="offers"><h2>{copy.offers}</h2><LoadState records={records} /><button className={formStyles.signout} type="button" onClick={() => { setSelected(''); setPolicyId(''); setNotice(''); }}>{copy.createOffer}</button>{notice && <p className={formStyles.saved} role="status">{notice}</p>}
    <div className={styles.editorColumns}><ul className={styles.recordList}>{records.items?.map(item => <li key={item.offer_id}><button type="button" aria-pressed={selected === item.offer_id} onClick={() => { setSelected(item.offer_id); setNotice(''); }}><strong>{item.title}</strong><span>{statusLabel(item.status, uiLanguage)} · {short(item.offer_id)}</span></button></li>)}</ul><div className={styles.editorPanel}>
      {record ? <><h3>{record.title}</h3><dl className={styles.summary}><div><dt>{catalogCopy.format}</dt><dd>{catalogCopy.formats[record.format]}</dd></div><div><dt>{copy.duration}</dt><dd>{record.duration_minutes}</dd></div><div><dt>{copy.tier}</dt><dd>{record.target_tier || catalogCopy.oneLearner}</dd></div><div><dt>{copy.status}</dt><dd>{statusLabel(record.status, uiLanguage)}</dd></div></dl>{record.status === 'draft' ? <IdentityForm action={`offers/${record.offer_id}/publish`} submitLabel={copy.publish} successMessage={copy.published} resettable={false} onSaved={() => { setNotice(copy.published); records.reload(); policies.reload(); pricing.reload(); }} payload={form => ({ expected_version: record.version, effective_at: new Date(String(form.get('effective_at'))).toISOString() })}><TextField name="effective_at" label={copy.effectiveAt} type="datetime-local" hint={copy.dateHint} /></IdentityForm> : <Link className={formStyles.primary} href={`/offers/${record.offer_id}`}>{copy.preview}</Link>}</> : selected ? <p>{copy.loading}</p> : <>
        {!approvedPolicies.length && <p className={styles.notice}>{copy.noApproved}</p>}
        <IdentityForm action="offers" submitLabel={copy.createOffer} successMessage={copy.saved} disabled={!policy} resettable={false} onSaved={result => { setSelected(String(result.offer_id)); setNotice(copy.saved); records.reload(); }} payload={form => { if (!policy) throw new Error('Policy required'); return { subject_id: form.get('subject_id'), format: policy.scope, duration_minutes: policy.content.duration_minutes, capacity: policy.scope === 'private' ? 1 : policy.content.group_capacity, target_tier: policy.scope === 'private' ? null : policy.content.group_target_size, pricing_version_id: policy.content.customer_pricing_version, policy_version_id: policy.policy_version_id }; }}>
          <Select name="subject_id" label={copy.subject} defaultValue=""><option value="">{policyCopy.choose}</option>{subjects.items?.map(subject => <option key={subject.subject_id} value={subject.subject_id}>{subject.title}</option>)}</Select>
          <Select name="policy_version_id" label={copy.policyRecord} value={policyId} onChange={setPolicyId}><option value="">{policyCopy.choose}</option>{approvedPolicies.map(item => <option key={item.policy_version_id} value={item.policy_version_id}>{label(item.scope, item.policy_version_id, item.status, uiLanguage)}</option>)}</Select>
          {policy && <dl className={styles.summary}><div><dt>{copy.duration}</dt><dd>{String(policy.content.duration_minutes)}</dd></div><div><dt>{copy.tier}</dt><dd>{policy.scope === 'private' ? catalogCopy.oneLearner : String(policy.content.group_target_size)}</dd></div></dl>}
        </IdentityForm>
      </>}
    </div></div>
  </section>;
}

function ProfileWorkspace({ records, subjects }: { records: Records<AdminTutor>; subjects: Subject[] }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [selected, setSelected] = useState(''); const [notice, setNotice] = useState('');
  const record = records.items?.find(item => item.tutor_id === selected);
  const pending = record?.profile_versions.find(item => item.profile_version_id === record.draft_profile_version_id && item.state === 'draft');
  const approved = record?.profile_versions.find(item => item.profile_version_id === record.approved_profile_version_id);
  return <section className={styles.editor} id="profiles"><h2>{copy.profiles}</h2><p>{copy.profileDescription}</p><LoadState records={records} />{notice && <p className={formStyles.saved} role="status">{notice}</p>}<div className={styles.editorColumns}><ul className={styles.recordList}>{records.items?.map(item => <li key={item.tutor_id}><button type="button" aria-pressed={selected === item.tutor_id} onClick={() => { setSelected(item.tutor_id); setNotice(''); }}><strong>{item.display_name}</strong><span>{short(item.tutor_id)}</span></button></li>)}</ul><div className={styles.editorPanel}>
      {!record ? <p>{copy.choose}</p> : <><h3>{copy.currentPublic}</h3>{approved ? <><p><strong>{approved.display_name}</strong></p><p className={styles.bio}>{approved.bio}</p><Link className={styles.textLink} href={`/tutors/${record.tutor_id}`}>{copy.preview}</Link></> : <p>{copy.noPublic}</p>}{pending ? <><h3>{copy.proposed}</h3><p><strong>{pending.display_name}</strong></p><p className={styles.bio}>{pending.bio}</p><ul>{pending.subject_ids.map(id => <li key={id}>{subjects.find(subject => subject.subject_id === id)?.title || short(id)}</li>)}</ul><IdentityForm key={`${record.tutor_id}-${record.version}-${pending.profile_version_id}`} action={`tutor-profiles/${record.tutor_id}/approve`} submitLabel={copy.reviewProfile} successMessage={copy.profileSaved} resettable={false} onSaved={() => { setNotice(copy.profileSaved); records.reload(); }} payload={form => ({ profile_version_id: pending.profile_version_id, decision: form.get('decision'), reason: String(form.get('reason')).trim(), expected_version: record.version })}><Select name="decision" label={copy.decision} defaultValue="approved"><option value="approved">{copy.approveProfile}</option><option value="rejected">{copy.rejectProfile}</option></Select><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm></> : <p className={styles.notice}>{copy.noProfiles}</p>}</>}
    </div></div></section>;
}

export function AdminCatalog({ isolated }: { isolated: boolean }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const pricing = usePagedRecords<AdminPricing>('pricing-versions'); const policies = usePagedRecords<AdminPolicy>('policies'); const offers = usePagedRecords<AdminOffer>('offers'); const tutors = usePagedRecords<AdminTutor>('tutors'); const subjects = usePagedRecords<Subject>('me/application-subjects');
  return <>{isolated && <p className={styles.notice}><strong>{copy.environment}.</strong> {copy.environmentHint}</p>}<nav className={styles.adminTabs} aria-label={copy.title}><a href="#pricing">{copy.pricing}</a><a href="#policies">{copy.policy}</a><a href="#offers">{copy.offers}</a><a href="#profiles">{copy.profiles}</a></nav><PricingWorkspace records={pricing} /><PolicyWorkspace records={policies} pricing={pricing} offers={offers} /><OffersWorkspace records={offers} policies={policies} pricing={pricing} subjects={subjects} /><ProfileWorkspace records={tutors} subjects={subjects.items || []} /></>;
}
