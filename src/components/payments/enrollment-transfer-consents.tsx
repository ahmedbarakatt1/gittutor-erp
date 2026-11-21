'use client';

import Link from 'next/link';
import type { EnrollmentTransferConsent } from '@/modules/booking/enrollment-transfers';
import { transferCopy as copy } from '@/locales/enrollment-transfers';
import { paymentCopy } from '@/locales/payments';
import { IdentityForm, TextField } from '../identity-form';
import { CairoTimestamp, Check, money } from '../booking/shared';
import { PaymentReadState, usePaymentClock, usePaymentList, usePaymentRecord } from './shared';
import styles from './payments.module.css';
import { transferCopy as arabicTransferCopy } from '@/locales/ar-transaction/enrollment-transfers';
import { paymentCopy as arabicPaymentCopy } from '@/locales/ar-transaction/payments';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy, paymentCopy },
  ar: { copy: arabicTransferCopy, paymentCopy: arabicPaymentCopy },
};

export function EnrollmentTransferConsentList() {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const records = usePaymentList<EnrollmentTransferConsent>('me/enrollment-transfer-consents');
  return <section className={styles.section}><h2>{copy.requests}</h2><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p>{copy.noRequests}</p>}<ul className={styles.list}>{records.items?.map(row => <li key={row.consent_id}><h3>{money(row.carryover_minor, 'EGP', uiLanguage)}</h3><p>{row.source_booking_reference} → {row.destination_booking_reference}</p><p>{copy.states[row.state] || row.state}</p><Link className={styles.link} href={`/learn/payments/enrollment-transfer-consents/${row.consent_id}`}>{copy.payerTitle}</Link></li>)}</ul></section>;
}
export function EnrollmentTransferConsentDetail({ id }: { id: string }) {
  const uiLanguage = useSiteLanguage();
  const { copy, paymentCopy } = textByLanguage[uiLanguage];

  const record = usePaymentRecord<EnrollmentTransferConsent>(`enrollment-transfer-consents/${id}`), now = usePaymentClock(), data = record.data;
  const current = data && now > 0 && now < Date.parse(data.expires_at) && data.can_accept;
  return <><Link className={styles.link} href="/learn/payments">{copy.backMoney}</Link><PaymentReadState pending={!data} {...record} />{data && <section className={styles.section}><p>{copy.payerDescription}</p><p>{copy.states[data.state] || data.state}</p><dl className={styles.facts}><div><dt>{copy.references}</dt><dd>{data.source_booking_reference} → {data.destination_booking_reference}</dd></div><div><dt>{copy.total}</dt><dd>{money(data.carryover_minor, 'EGP', uiLanguage)}</dd></div><div><dt>{copy.expires}</dt><dd><CairoTimestamp value={data.expires_at} /></dd></div></dl><ul className={styles.list}>{data.sources.map(source => <li key={source.transfer_id}>{paymentCopy.channelNames[source.channel]} · {money(source.amount_minor, 'EGP', uiLanguage)}<p><Link className={styles.link} href={`/learn/payments/transfers/${source.transfer_id}`}>{copy.source}</Link></p></li>)}</ul>{data.state === 'awaiting_acceptance' && <><IdentityForm action={`enrollment-transfer-consents/${id}/accept`} submitLabel={copy.payerAccept} successMessage={copy.payerAccepted} disabled={!current} resettable={false} onSaved={record.reload} payload={() => ({ terms_hash: data.terms_hash, expected_version: data.version })}><Check name="carryover_consent" label={copy.payerConsent} /></IdentityForm>{!current && <p>{copy.expired}</p>}<IdentityForm action={`enrollment-transfer-consents/${id}/decline`} submitLabel={copy.payerDecline} successMessage={copy.payerDeclined} resettable={false} onSaved={record.reload} payload={form => ({ reason: String(form.get('reason')), expected_version: data.version })}><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm></>}</section>}</>;
}
