'use client';
import { useStaffText } from '@/components/ar-staff-label';
import{useState}from'react';
import{usePaymentList,PaymentReadState,State}from'../payments/shared';
import{IdentityForm}from'../identity-form';
import{CairoTimestamp,Select}from'../booking/shared';
import{exportSchemas,type ExportKind}from'@/modules/crm/exports';
import type{ExportView}from'@/modules/crm/queries';
const labels:Record<ExportKind,string>={own_account:'My learner records',own_tutor_statement:'My tutor statement',admin_customers:'Customer contacts and balances',admin_sessions:'Session totals',admin_finance:'Payment allocations'};
export function ExportWorkspace({kinds,learnerIds=[],filters:fixedFilters}:{kinds:ExportKind[];learnerIds?:string[];filters?:Record<string,unknown>}){
  const t = useStaffText();

 const[kind,setKind]=useState<ExportKind>(kinds[0]),[selected,setSelected]=useState<string[]>([...learnerIds]),[columns,setColumns]=useState<string[]>([...exportSchemas[kinds[0]]]),[from,setFrom]=useState(''),[to,setTo]=useState('');const list=usePaymentList<ExportView>('exports');
 function choose(value:string){const next=value as ExportKind;setKind(next);setColumns([...exportSchemas[next]]);}
 function filters(){return {...(kind==='own_account'?{learner_ids:selected}:{}),...(kind!=='admin_customers'&&from?{from:new Date(from).toISOString()}:{}),...(kind!=='admin_customers'&&to?{to:new Date(to).toISOString()}:{}),...fixedFilters};}
 return <section><h2>{t("Download records")}</h2><p>{t("Exports capture the selected records and financial postings now. Files expire after 24 hours and require your current access.")}</p>
 <IdentityForm action="exports" payload={()=>({kind,filters:filters(),columns,as_of:new Date().toISOString()})} submitLabel={t("Prepare CSV export")} successMessage={t("Export queued. Refresh below to see when the file is ready.")} disabled={!columns.length||(kind==='own_account'&&!selected.length)} onSaved={list.reload}>
 {kinds.length>1&&<Select name="export_kind" label={t("Records to export")} value={kind} onChange={choose}>{kinds.map(k=><option key={k} value={k}>{t(labels[k])}</option>)}</Select>}
 {kind==='own_account'&&<fieldset><legend>{t("Learners in this export")}</legend>{learnerIds.map((learner,index)=><label key={learner} style={{display:'block'}}><input type="checkbox" checked={selected.includes(learner)} onChange={e=>setSelected(values=>e.target.checked?[...values,learner]:values.filter(v=>v!==learner))}/>{t(" Learner ")}{index+1} · {learner.slice(0,8)}</label>)}</fieldset>}
 {kind!=='admin_customers'&&<fieldset><legend>{t("Optional date window (your device time zone)")}</legend><label>{t("From ")}<input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>{t("Before ")}<input type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></label></fieldset>}
 <details><summary>{t("Choose columns (")}{columns.length})</summary><fieldset><legend>{t("Included columns")}</legend>{exportSchemas[kind].map(column=><label key={column} style={{display:'block'}}><input type="checkbox" checked={columns.includes(column)} onChange={e=>setColumns(values=>e.target.checked?[...values,column]:values.filter(v=>v!==column))}/>{t(column.replaceAll('_',' '))}</label>)}</fieldset></details>
 </IdentityForm><h3>{t("My exports")}</h3><PaymentReadState pending={!list.items} {...list}/>{list.items?.length===0&&<p>{t("No exports yet.")}</p>}<ul>{list.items?.map(item=><li key={item.export_id}><strong>{t(labels[item.kind])}</strong> · <State value={item.state}/> · {item.row_count} {t('rows')} ({t(item.grain.replaceAll('_',' '))})<p>{t("Snapshot ")}<CairoTimestamp value={item.snapshot_at}/> · {t('Expires')} <CairoTimestamp value={item.expires_at}/></p>{item.safe_error_code&&<p role="status">{t("Export processing needs attention. Refresh to check recovery.")}</p>}{item.can_download&&item.download_path&&<a href={item.download_path} download>{t("Download CSV")}</a>}</li>)}</ul></section>;
}
