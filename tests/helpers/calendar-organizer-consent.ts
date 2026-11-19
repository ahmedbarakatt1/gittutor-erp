import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

/** Synthetic consent observations only. Both principals use their real database roles. */
export async function exerciseOrganizerConsent(db:Client, claims:object) {
  const envelope={v:1,alg:'A256GCM',kid:'test',nonce:'A'.repeat(16),tag:'A'.repeat(22),ciphertext:'AA'};
  const grant=async(request:{request_id:string;connection_id:string}, subject:string, email:string, calendar='primary', credential=randomUUID())=>{
    await db.query('set local role git_tutor_worker');
    const {rows}=await db.query('select app_private.record_calendar_organizer($1,$2,$3,$4,$5,$6,$7,$8) r',
      [request.request_id,request.connection_id,credential,email,calendar,envelope,'test',subject]);
    await db.query('reset role');
    return rows[0].r;
  };
  const request=async(id?:string,version?:number)=>{
    await db.query('set local role authenticated');
    const {rows}= id
      ? await db.query('select api.create_calendar_reconnection_request($1,$2,$3) r',[id,version,randomUUID()])
      : await db.query('select api.create_calendar_connection_request($1) r',[randomUUID()]);
    await db.query('reset role');
    return rows[0].r;
  };
  const expectRejected=async(action:()=>Promise<unknown>,message:RegExp)=>{
    await db.query('savepoint denied_consent');
    await assert.rejects(action,message);
    await db.query('rollback to savepoint denied_consent');
  };
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
    const first=await request(), second=await request(), subject=randomUUID(), otherSubject=randomUUID();
    const email=`first.${randomUUID()}@example.test`, otherEmail=`second.${randomUUID()}@example.test`;
    const calendar=`controlled.${randomUUID()}@example.test`, credential=randomUUID();
    await grant(first,subject,email,calendar,credential);
    await grant(second,otherSubject,otherEmail);
    assert.equal((await grant(first,subject,email,calendar,credential)).version,1);
    const duplicate=await request();
    await expectRejected(()=>grant(duplicate,subject,'changed@example.test'),/STATE_CONFLICT/);
    await expectRejected(()=>grant(duplicate,randomUUID(),email.toUpperCase()),/STATE_CONFLICT/);
    await expectRejected(()=>grant(duplicate,randomUUID(),'different@example.test',calendar),/STATE_CONFLICT/);
    await expectRejected(()=>grant(duplicate,randomUUID(),'different@example.test',otherEmail),/STATE_CONFLICT/);
    const reauthorize=await request(first.connection_id,1), stale=await request(first.connection_id,1);
    await expectRejected(()=>grant(reauthorize,otherSubject,otherEmail),/STATE_CONFLICT/);
    const changed=await grant(reauthorize,subject,email);
    assert.equal(changed.connection_id,first.connection_id);
    assert.equal(changed.version,2);
    await expectRejected(()=>grant(stale,subject,email),/VERSION_CONFLICT/);
    const saved=(await db.query(`select id,version,state,calendar_id from app_private.provider_connections
      where id=any($1::uuid[]) order by version desc`,[[first.connection_id,second.connection_id]])).rows;
    assert.deepEqual(saved,[
      {id:first.connection_id,version:2,state:'preview_connected',calendar_id:calendar},
      {id:second.connection_id,version:1,state:'preview_connected',calendar_id:'primary'},
    ]);
    // A legacy live connection copied into a test database cannot participate
    // in the ordinary pool, even if its old state still says "connected".
    await db.query("update app_private.provider_connections set state='connected' where id=$1",[first.connection_id]);
    const { rows:[legacy] }=await db.query(`select app_private.calendar_connection_in_scope(c,o.id) eligible
      from app_private.provider_connections c cross join app_private.occurrences o where c.id=$1
      and not exists(select 1 from app_private.calendar_booking_pilots p where p.occurrence_id=o.id) limit 1`,[first.connection_id]);
    assert.equal(legacy.eligible,false);
    // Credentials cannot be read directly, even by an authenticated admin or by the worker.
    for(const role of ['authenticated','git_tutor_worker']){
      await expectRejected(async()=>{
        await db.query(`set local role ${role}`);
        return db.query('select encrypted_credentials from app_private.provider_credential_versions');
      },/permission denied/);
    }
  } finally { await db.query('rollback'); }
}
