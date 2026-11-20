'use client';
import { useRef, useState } from 'react';
import { LinkConversation, ConversationChallenge, StaffSupportActions, TemplateSettings, StaffedHours } from './actions';
import type { Conversation, ConversationSummary } from '@/modules/support/commands';
import { publicSupportCopy, supportCopy as copy } from '@/locales/support';
import { IdentityForm, TextField } from '../identity-form';
import { usePaymentList, usePaymentRecord, PaymentReadState, State } from '../payments/shared';
import { CairoTimestamp } from '../booking/shared';
import styles from './workspace.module.css';
import publicStyles from './public-support.module.css';

export function SupportWorkspace({ staff = false, manualWhatsApp, publicEntry = false }: {
  staff?: boolean; manualWhatsApp: boolean; publicEntry?: boolean;
}) {
  const [ready, setReady] = useState(staff);
  const [error, setError] = useState('');
  async function start() {
    setError('');
    try {
      const response = await fetch('/api/v1/support/session', { method: 'POST' });
      if (!response.ok) throw Error();
      setReady(true);
    } catch { setError(copy.error); }
  }
  if (ready) return <Inbox staff={staff} manualWhatsApp={manualWhatsApp} />;
  return <section className={publicEntry ? publicStyles.option : undefined}>
    {publicEntry
      ? <div><h2>{publicSupportCopy.websiteTitle}</h2><p>{publicSupportCopy.websiteBody}</p></div>
      : <p>{copy.privacy}</p>}
    <button className="button button-primary" onClick={start}>{copy.start}</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
function Inbox({staff,manualWhatsApp}:{staff:boolean;manualWhatsApp:boolean}){const[filter,setFilter]=useState(''),[selected,setSelected]=useState<string|null>(null),threads=usePaymentList<ConversationSummary>(`support${staff?'/queue':''}${filter?`?state=${filter}`:''}`);return <div className={styles.workspace}><aside><h2>{staff?copy.queue:'Your conversations'}</h2>{staff&&<label>Status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All</option>{['waiting','assigned','escalated','resolved'].map(s=><option key={s}>{s}</option>)}</select></label>}<button onClick={threads.reload}>{copy.refresh}</button><PaymentReadState pending={!threads.items} {...threads}/>{threads.items?.length===0&&<p>{copy.empty}</p>}<ul className={styles.threads}>{threads.items?.map(t=><li key={t.conversation_id}><button aria-pressed={selected===t.conversation_id} onClick={()=>setSelected(t.conversation_id)}>{t.topic}<State value={t.state}/></button></li>)}</ul>{!staff&&<IdentityForm action="support" payload={f=>({channel:'website',topic:String(f.get('topic')),source_token:null})} submitLabel={copy.start} successMessage={copy.create} onSaved={r=>{setSelected(String(r.conversation_id));threads.reload();}}><TextField name="topic" label={copy.topic} maxLength={200}/></IdentityForm>}{!staff&&<LinkConversation onChanged={threads.reload}/>} {staff&&<TemplateSettings manualWhatsApp={manualWhatsApp}/>}{threads.cursor&&<button onClick={threads.loadMore}>Load more conversations</button>}</aside><section>{selected?<Thread key={selected} id={selected} staff={staff} manualWhatsApp={manualWhatsApp} onChanged={threads.reload}/>:<p>Select a conversation to see its transcript.</p>}</section></div>;}
function Thread({id,staff,manualWhatsApp,onChanged}:{id:string;staff:boolean;manualWhatsApp:boolean;onChanged:()=>void}){const messageId=useRef<string|null>(null);const thread=usePaymentRecord<Conversation>(`support/${id}`),t=thread.data;function refresh(){thread.reload();onChanged();}if(!t)return <PaymentReadState pending {...thread}/>;return <><h2>{t.topic}</h2><p>{t.channel==='website'?'Website conversation':'WhatsApp conversation'} · <State value={t.state}/></p>{(!manualWhatsApp||t.channel==='website')&&<p>{t.bot_paused?copy.paused:copy.bot}</p>}<StaffedHours thread={t}/><button onClick={refresh}>{copy.refresh}</button><ol className={styles.transcript} aria-label="Conversation transcript">{t.messages.map(m=><li key={m.message_id} data-author={m.author}><strong>{m.author}</strong> <CairoTimestamp value={m.created_at}/><p>{m.text}</p><small>{m.delivery_state}</small></li>)}</ol>{t.earlier_messages_available&&<p>Showing the latest 100 messages.</p>}
 {!staff&&t.channel==='website'&&<IdentityForm key={`message:${t.version}`} action={`support/${id}/messages`} payload={f=>({client_message_id:messageId.current??(messageId.current=crypto.randomUUID()),text:String(f.get('text'))})} submitLabel={copy.send} successMessage={copy.saved} onSaved={()=>{messageId.current=null;refresh();}} clearFieldsOnSuccess><TextField name="text" label={copy.message} multiline maxLength={4000}/></IdentityForm>}
 {!staff&&t.can_handoff&&<IdentityForm key={`handoff:${t.version}`} action={`support/${id}/handoff`} payload={()=>({reason:'Customer asked to speak to a person',expected_version:t.version})} submitLabel={copy.human} successMessage={copy.saved} onSaved={refresh}>{null}</IdentityForm>}
 {staff&&t.can_claim&&<IdentityForm action={`support/${id}/claim`} payload={()=>({expected_version:t.version})} submitLabel={copy.claim} successMessage={copy.saved} onSaved={refresh}>{null}</IdentityForm>}
 {staff&&t.can_reply&&t.channel==='website'&&<IdentityForm key={`reply:${t.version}`} action={`support/${id}/reply`} payload={f=>({text:String(f.get('text')),template_id:null,template_parameters:[],expected_version:t.version})} submitLabel={copy.reply} successMessage={copy.saved} onSaved={refresh}><TextField name="text" label={copy.reply} multiline maxLength={4000}/></IdentityForm>}
 {staff&&t.can_reply&&<IdentityForm key={`note:${t.version}`} action={`support/${id}/notes`} payload={f=>({private_note:String(f.get('note')),expected_version:t.version})} submitLabel="Save private note" successMessage={copy.saved} onSaved={refresh}><TextField name="note" label={copy.note} multiline maxLength={2000}/></IdentityForm>}
 {staff&&t.private_notes&&<details><summary>{copy.privateLabel}</summary>{t.private_notes.map(n=><p key={n.note_id}>{n.text}</p>)}</details>}
 {staff&&t.can_resolve&&<IdentityForm key={`resolve:${t.version}`} action={`support/${id}/resolve`} payload={f=>({resolution_code:'answered',private_note:String(f.get('resolution')),expected_version:t.version})} submitLabel={copy.resolve} successMessage={copy.saved} onSaved={refresh}><TextField name="resolution" label="Private resolution note" maxLength={2000}/></IdentityForm>}
 {!staff&&t.can_link&&<ConversationChallenge thread={t}/>} {staff&&<StaffSupportActions manualWhatsApp={manualWhatsApp} thread={t} onChanged={refresh}/>} </>;}
