import { afterEach,expect,test } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFakeCalendarAdapter,createGoogleCalendarAdapter,type CalendarDesired } from '../../src/server/providers/calendar';
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
function desired(id=randomUUID()):CalendarDesired {return {occurrence_id:id,occurrence_version:2,connection_id:randomUUID(),connection_version:1,credential_version:null,calendar_id:'synthetic@example.test',provider_event_id:`gt${id.replaceAll('-','')}`,meeting_generation:1,conference_request_id:randomUUID(),action:'upsert',start_at:'2030-02-13T15:00:00Z',end_at:'2030-02-13T16:00:00Z',tutor_email:'tutor@example.test',title:'Git Tutor session'};}
async function directory(){const path=await mkdtemp(join(tmpdir(),'git-tutor-calendar-'));directories.push(path);return path;}
test('fake timeout preserves one stable room across a new process adapter and retry',async()=>{const path=await directory(),d=desired();const first=createFakeCalendarAdapter(path,'timeout_after_success');expect((await first.apply(d)).outcome).toBe('unknown');const recovered=createFakeCalendarAdapter(path);const result=await recovered.reconcile(d);expect(result).toMatchObject({outcome:'ready',provider_event_id:d.provider_event_id});expect((await recovered.apply(d)).join_url).toBe(result.join_url);expect((await recovered.apply({...d,action:'cancel'})).outcome).toBe('revoked');expect((await recovered.reconcile(d)).outcome).toBe('revoked');});
test('fake pending is persisted and reconciles without a second event identity',async()=>{const path=await directory(),d=desired();expect((await createFakeCalendarAdapter(path,'pending').apply(d)).outcome).toBe('pending');expect(await createFakeCalendarAdapter(path).reconcile(d)).toMatchObject({outcome:'ready',provider_event_id:d.provider_event_id});});
test('each additional simulated organizer reconciles only its own calendar', async () => {
  const adapter = createFakeCalendarAdapter(await directory());
  const legacy = desired();
  const other = { ...legacy, connection_id: randomUUID(), calendar_id: 'new-organizer@example.test' };
  await adapter.apply(legacy);
  expect((await adapter.reconcile(other)).outcome).toBe('absent');
  await adapter.apply(other);
  await adapter.apply({ ...other, action: 'cancel' });
  expect((await adapter.reconcile(legacy)).outcome).toBe('ready');
});
test('Google uses GET before insert, exact persisted conference identity, and no learner/fee data',async()=>{const d=Object.assign(desired('3dcf1d1d-74c0-4317-afee-7985da478192'),{tutor_fee_minor:123456789,learner_email:'private-learner@example.test',internal_notes:'PRIVATE_CALENDAR_MARKER'}),requests:{url:string;init?:RequestInit}[]=[];const provider=createGoogleCalendarAdapter(async()=>'private-token',async(input,init)=>{requests.push({url:String(input),init});return requests.length===1?new Response('{}',{status:404}):Response.json({id:d.provider_event_id,etag:'v1',conferenceData:{createRequest:{status:{statusCode:'success'}},entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}]}});});const result=await provider.apply(d);expect(result.outcome).toBe('ready');expect(requests[0].init?.method).toBe('GET');const body=JSON.parse(String(requests[1].init?.body));expect(body.id).toBe(d.provider_event_id);expect(body.conferenceData.createRequest.requestId).toBe(d.conference_request_id);expect(body.attendees).toEqual([{email:d.tutor_email}]);expect(body).toEqual({
 id:d.provider_event_id,summary:'Git Tutor session',description:'Access your current Git Tutor session through your authorized portal.',
 start:{dateTime:d.start_at,timeZone:'Africa/Cairo'},end:{dateTime:d.end_at,timeZone:'Africa/Cairo'},attendees:[{email:d.tutor_email}],
 visibility:'private',guestsCanInviteOthers:false,guestsCanModify:false,guestsCanSeeOtherGuests:false,
 extendedProperties:{private:{git_tutor_occurrence_id:d.occurrence_id,git_tutor_occurrence_version:'2',git_tutor_meeting_generation:'1'}},
 conferenceData:{createRequest:{requestId:d.conference_request_id,conferenceSolutionKey:{type:'hangoutsMeet'}}},
});expect(requests[1].url).toContain('conferenceDataVersion=1');});
test('Google reschedule uses current event ETag and rejects an untrusted meeting URL',async()=>{const d=desired(),calls:RequestInit[]=[];const provider=createGoogleCalendarAdapter(async()=>'private-token',async(_input,init)=>{calls.push(init!);return Response.json({id:d.provider_event_id,etag:'original-etag',summary:'old',conferenceData:{createRequest:{status:{statusCode:'success'}},entryPoints:[{entryPointType:'video',uri:'https://attacker.example/room'}]}});});const result=await provider.apply({...d,occurrence_version:3});expect(calls[1].method).toBe('PUT');expect(new Headers(calls[1].headers).get('if-match')).toBe('original-etag');expect(result).toMatchObject({outcome:'failed',join_url:null,safe_error_code:'CALENDAR_LINK_INVALID'});});
test('Google auth denial and uncertain network result remain explicit without secrets in errors',async()=>{const d=desired();expect(await createGoogleCalendarAdapter(async()=>'secret',async()=>new Response('sensitive',{status:401})).reconcile(d)).toMatchObject({outcome:'failed',safe_error_code:'CALENDAR_AUTHORIZATION_REQUIRED'});expect(await createGoogleCalendarAdapter(async()=>'secret',async()=>{throw new Error('raw credential secret');}).apply(d)).toMatchObject({outcome:'unknown',safe_error_code:'CALENDAR_OUTCOME_UNKNOWN'});});
test.each([
  ['upsert', '3', '1'], ['cancel', '3', '1'], ['upsert', '2', '2'], ['cancel', '2', '2'],
] as const)('stale %s cannot overwrite provider occurrence version %s or generation %s', async (action,version,generation) => {
  const d = desired();
  const methods: string[] = [];
  const provider = createGoogleCalendarAdapter(async () => 'synthetic-token', async (_url, init) => {
    methods.push(init!.method!);
    return Response.json({ id: d.provider_event_id, etag: 'new-version', extendedProperties: { private: {
      git_tutor_occurrence_id: d.occurrence_id, git_tutor_occurrence_version: version, git_tutor_meeting_generation: generation,
    } } });
  });
  expect(await provider.apply({ ...d, action })).toMatchObject({ outcome: 'pending', matches_desired: false, join_url: null });
  expect(methods).toEqual(['GET']);
});

test('a Google event without an ETag waits for reconciliation before changing the booked time', async () => {
  const d = desired(), methods: string[] = [];
  const provider = createGoogleCalendarAdapter(async () => 'synthetic-token', async (_url, init) => {
    methods.push(init!.method!);
    return Response.json({ id: d.provider_event_id });
  });
  expect(await provider.apply(d)).toMatchObject({ outcome: 'unknown', safe_error_code: 'CALENDAR_ETAG_UNAVAILABLE' });
  expect(methods).toEqual(['GET']);
});

test('a deleted Google event cannot be recreated by a delayed job after its organizer time is released', async () => {
  const d = desired(), methods: string[] = [];
  const provider = createGoogleCalendarAdapter(async () => 'synthetic-token', async (_url, init) => {
    methods.push(init!.method!);
    return new Response(null,{status:410});
  });
  expect(await provider.apply(d)).toMatchObject({ outcome: 'failed', safe_error_code: 'CALENDAR_EVENT_REVOKED' });
  expect(await provider.reconcile({ ...d, action:'cancel' })).toMatchObject({ outcome: 'revoked', matches_desired: true });
  expect(methods).toEqual(['GET','GET']);
});
