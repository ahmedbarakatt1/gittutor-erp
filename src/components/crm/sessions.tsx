'use client';
import { useStaffText } from '@/components/ar-staff-label';
import{useState}from'react';
import type{CrmSession}from'@/modules/crm/queries';
import{usePaymentList,PaymentReadState,State}from'../payments/shared';
import{CairoTimestamp,Select}from'../booking/shared';
import{formatFinanceAmount}from'@/modules/shared/format';
import{ExportWorkspace}from'./exports';
export function SessionDirectory(){
  const t = useStaffText();
const[state,setState]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[filters,setFilters]=useState<Record<string,string>>({}),query=new URLSearchParams(filters).toString(),list=usePaymentList<CrmSession>(`crm/sessions?${query}`);return <><form onSubmit={e=>{e.preventDefault();setFilters({...state?{state}:{},...from?{from:new Date(from).toISOString()}:{},...to?{to:new Date(to).toISOString()}:{}});}}><Select name="session_state" label={t("Session status")} value={state} onChange={setState}><option value="">{t("All statuses")}</option>{['draft','forming','confirmed','in_progress','completion_pending','completed','cancelled'].map(s=><option key={s} value={s}>{t(s.replaceAll('_',' '))}</option>)}</Select><label>{t("From (device time) ")}<input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>{t("Before (device time) ")}<input type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></label><button type="submit">{t("Filter sessions")}</button></form><PaymentReadState pending={!list.items} {...list}/>{list.items?.length===0&&<p>{t("No sessions match these filters.")}</p>}<ul>{list.items?.map(s=><li key={s.occurrence_id}><h2>{s.title}</h2><p><CairoTimestamp value={s.start_at}/> · <State value={s.state}/> · {s.learner_count}{t(" learner records")}</p><p>{t("Customer tuition: ")}{formatFinanceAmount(s.customer_tuition_minor)}</p><a href={`/admin/teaching?occurrence_id=${s.occurrence_id}`}>{t("Open session teaching record")}</a></li>)}</ul><ExportWorkspace kinds={['admin_sessions']} filters={filters}/></>;}
