import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {completionFixture} from '../helpers/completion';
import {approvePayrollEarning,payrollTools} from '../helpers/payroll';
import {raceBookingCalls} from '../helpers/booking';
import {getTutorStatement} from '../../src/modules/tutor_pay/payroll';
test('independent payout authorizations reserve the last payable once even after teaching access is revoked',async()=>{
 const f=await completionFixture(),tools=await payrollTools(f);try{
  const earning=await approvePayrollEarning(f),destination=await tools.destination();
  const role=(await f.database.query("select r.id,r.version from app_private.account_roles r join app_private.tutors t on t.account_id=r.account_id where t.id=$1 and r.role='tutor'and r.revoked_at is null",[f.tutorId])).rows[0];
  await f.rpc('revoke_staff_role',{p_role_grant_id:role.id,p_expected_version:role.version,p_reason:'Teaching access ended; earned payable remains',p_idempotency_key:randomUUID()});
  await expect(getTutorStatement(f.tutor)).rejects.toThrow('FORBIDDEN');
  const args={p_tutor_id:f.tutorId,p_destination_version_id:destination.versionId,p_allocations:[{earning_id:earning,amount_minor:25000}],p_idempotency_key:randomUUID()};
  const results=await raceBookingCalls([args,{...args,p_idempotency_key:randomUUID()}].map(args=>({client:f.admin,name:'authorize_payout',args})));
  expect(results.filter(x=>!x.error)).toHaveLength(1);expect(results.find(x=>x.error)?.error).toBe('INSUFFICIENT_PAYABLE');
  expect(await getTutorStatement(f.admin,f.tutorId)).toMatchObject({earned_minor:25000,owed_minor:25000,reserved_minor:25000,available_minor:0});
 }finally{await tools.close();await f.close();}
},60000);
