import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { dirname,resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertFakeProviderIsolation,isSafeFakeRecipient } from './fake-recipient';
export type CalendarDesired = { occurrence_id:string; occurrence_version:number; connection_id:string; connection_version:number; credential_version:string|null; calendar_id:string; provider_event_id:string; meeting_generation:number; conference_request_id:string; action:'upsert'|'cancel'; start_at:string; end_at:string; tutor_email:string; title:string };
export type CalendarObservation = { outcome:'absent'|'pending'|'ready'|'failed'|'unknown'|'revoked'; provider_event_id:string; etag:string|null; join_url:string|null; safe_error_code:string|null; observed_at:string; matches_desired:boolean };
export type CalendarAdapter = { reconcile(desired:CalendarDesired):Promise<CalendarObservation>; apply(desired:CalendarDesired):Promise<CalendarObservation> };
function observation(d:CalendarDesired,outcome:CalendarObservation['outcome'],extra:Partial<CalendarObservation>={}):CalendarObservation{return {outcome,provider_event_id:d.provider_event_id,etag:null,join_url:null,safe_error_code:null,observed_at:new Date().toISOString(),matches_desired:false,...extra};}
export function createFakeCalendarAdapter(directory:string,scenario:'success'|'pending'|'timeout_after_success'|'permanent_failure'='success'):CalendarAdapter {
  assertFakeProviderIsolation('FAKE_CALENDAR_REQUIRES_ISOLATION');
  const root=resolve(directory);
  function path(d:CalendarDesired) {
    if (!/^gt[a-f0-9]{32}$/.test(d.provider_event_id) || !z.uuid().safeParse(d.connection_id).success || !isSafeFakeRecipient(d.tutor_email)) {
      throw new Error('SYNTHETIC_CALENDAR_REQUIRED');
    }
    // Existing simulated rooms were stored in a single organizer directory.
    const directory = d.calendar_id === 'synthetic@example.test' ? root : join(root,d.connection_id);
    return join(directory,`${d.provider_event_id}.json`);
  }
  async function load(d:CalendarDesired):Promise<CalendarObservation|null>{try{return JSON.parse(await readFile(path(d),'utf8')) as CalendarObservation;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
  async function save(d:CalendarDesired,value:CalendarObservation){const target=path(d),temporary=`${target}.${randomUUID()}.tmp`;await mkdir(dirname(target),{recursive:true});await writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temporary,target);return value;}
  return {
    async reconcile(d){const previous=await load(d);if(!previous)return observation(d,'absent');const current={...previous,matches_desired:previous.outcome==='revoked'?d.action==='cancel':previous.etag===`fake:${d.occurrence_version}:${d.meeting_generation}`};if(current.outcome==='pending')return save(d,{...current,outcome:'ready',observed_at:new Date().toISOString()});return current;},
    async apply(d){const previous=await load(d);if(d.action==='cancel')return save(d,observation(d,'revoked',{matches_desired:true}));if(scenario==='permanent_failure')return save(d,observation(d,'failed',{safe_error_code:'CALENDAR_PROVIDER_FAILED'}));
      const room=`https://meet.example.test/${d.occurrence_id}/${d.meeting_generation}`;
      const result=observation(d,scenario==='pending'&&!previous?'pending':'ready',{join_url:room,etag:`fake:${d.occurrence_version}:${d.meeting_generation}`,matches_desired:true});
      await save(d,result);return scenario==='timeout_after_success'&&!previous?observation(d,'unknown',{safe_error_code:'CALENDAR_OUTCOME_UNKNOWN'}):result;
    },
  };
}
type GoogleEvent={id?:string;etag?:string;status?:string;start?:{dateTime:string;timeZone?:string};end?:{dateTime:string;timeZone?:string};extendedProperties?:{private?:Record<string,string>};conferenceData?:{createRequest?:{requestId?:string;conferenceSolutionKey?:{type:string};status?:{statusCode?:string}};entryPoints?:{entryPointType?:string;uri?:string}[]};[key:string]:unknown};
/** The caller supplies a refreshed access token through the encrypted-connection boundary. */
export function createGoogleCalendarAdapter(token:()=>Promise<string>,fetcher:typeof fetch=fetch):CalendarAdapter {
  async function request(d:CalendarDesired,method:string,event?:GoogleEvent,etag?:string){const base=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(d.calendar_id)}/events`;
    const url=method==='POST'?`${base}?conferenceDataVersion=1&sendUpdates=none`:`${base}/${encodeURIComponent(d.provider_event_id)}${method==='PUT'?'?conferenceDataVersion=1&sendUpdates=none':method==='DELETE'?'?sendUpdates=none':''}`;
    return fetcher(url,{method,headers:{Authorization:`Bearer ${await token()}`,'Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},...(event?{body:JSON.stringify(event)}:{}),signal:AbortSignal.timeout(10000)});
  }
  function failure(d:CalendarDesired,status:number){return observation(d,status===401||status===403?'failed':'unknown',{safe_error_code:status===401||status===403?'CALENDAR_AUTHORIZATION_REQUIRED':'CALENDAR_OUTCOME_UNKNOWN'});}
  function parsed(d:CalendarDesired,event:GoogleEvent){if(event.id!==d.provider_event_id)return observation(d,'unknown',{safe_error_code:'CALENDAR_IDENTITY_MISMATCH'});if(event.status==='cancelled')return observation(d,'revoked',{matches_desired:d.action==='cancel'});
    const matches=event.extendedProperties?.private?.git_tutor_occurrence_version===String(d.occurrence_version)&&event.extendedProperties.private.git_tutor_meeting_generation===String(d.meeting_generation)&&Date.parse(event.start?.dateTime??'')===Date.parse(d.start_at)&&Date.parse(event.end?.dateTime??'')===Date.parse(d.end_at);
    const state=event.conferenceData?.createRequest?.status?.statusCode;
    if(state==='failure')return observation(d,'failed',{safe_error_code:'CALENDAR_CONFERENCE_FAILED',etag:event.etag??null});
    const uri=event.conferenceData?.entryPoints?.find(point=>point.entryPointType==='video')?.uri;
    if(!uri||state==='pending')return observation(d,'pending',{etag:event.etag??null,matches_desired:matches});
    let valid=false;try{const url=new URL(uri);valid=url.protocol==='https:'&&url.hostname==='meet.google.com'&&!url.username&&!url.password&&!url.port&&/^\/[a-z0-9-]+$/.test(url.pathname);}catch{}
    return valid?observation(d,'ready',{join_url:uri,etag:event.etag??null,matches_desired:matches}):observation(d,'failed',{safe_error_code:'CALENDAR_LINK_INVALID'});
  }
  async function read(d:CalendarDesired) {
    const response = await request(d,'GET');
    if (response.status === 404) return {result:observation(d,'absent'),event:null};
    if (response.status === 410) return {result:observation(d,'revoked',{matches_desired:d.action==='cancel'}),event:null};
    if (!response.ok) return {result:failure(d,response.status),event:null};
    const event = await response.json() as GoogleEvent;
    return {result:parsed(d,event),event};
  }
  const adapter:CalendarAdapter={
    async reconcile(d){try{return (await read(d)).result;}catch{return observation(d,'unknown',{safe_error_code:'CALENDAR_OUTCOME_UNKNOWN'});}},
    async apply(d){try{const existing=await read(d);if(existing.result.outcome==='unknown'||(existing.result.outcome==='failed'&&!existing.event))return existing.result;
      // A delayed worker can read a newer event and its ETag after its own job was prepared.
      const recorded = existing.event?.extendedProperties?.private;
      if (Number(recorded?.git_tutor_occurrence_version) > d.occurrence_version ||
          Number(recorded?.git_tutor_meeting_generation) > d.meeting_generation) {
        return observation(d,'pending',{safe_error_code:'CALENDAR_VERSION_MISMATCH'});
      }
      if (existing.event && existing.result.outcome !== 'revoked' && !existing.event.etag) {
        return observation(d,'unknown',{safe_error_code:'CALENDAR_ETAG_UNAVAILABLE'});
      }
      if(d.action==='cancel'){if(existing.result.outcome==='absent'||existing.result.outcome==='revoked')return observation(d,'revoked',{matches_desired:true});const deleted=await request(d,'DELETE',undefined,existing.event?.etag);return deleted.ok||[404,410].includes(deleted.status)?observation(d,'revoked',{matches_desired:true}):failure(d,deleted.status);}
      if(existing.result.outcome==='revoked')return observation(d,'failed',{safe_error_code:'CALENDAR_EVENT_REVOKED'});
      const event:GoogleEvent={...(existing.event??{}),id:d.provider_event_id,summary:d.title,description:'Access your current Git Tutor session through your authorized portal.',start:{dateTime:d.start_at,timeZone:'Africa/Cairo'},end:{dateTime:d.end_at,timeZone:'Africa/Cairo'},attendees:[{email:d.tutor_email}],visibility:'private',guestsCanInviteOthers:false,guestsCanModify:false,guestsCanSeeOtherGuests:false,extendedProperties:{private:{git_tutor_occurrence_id:d.occurrence_id,git_tutor_occurrence_version:String(d.occurrence_version),git_tutor_meeting_generation:String(d.meeting_generation)}},conferenceData:{createRequest:{requestId:d.conference_request_id,conferenceSolutionKey:{type:'hangoutsMeet'}}}};
      const response=await request(d,existing.event?'PUT':'POST',event,existing.event?.etag);if(response.status===409)return adapter.reconcile(d);if(!response.ok)return failure(d,response.status);return parsed(d,await response.json() as GoogleEvent);
    }catch{return observation(d,'unknown',{safe_error_code:'CALENDAR_OUTCOME_UNKNOWN'});}},
  };return adapter;
}
