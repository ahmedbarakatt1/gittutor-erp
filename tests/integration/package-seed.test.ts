import {expect,test} from 'vitest';
import {seedPackages,packageFixtureIds} from '../../tools/package-seed';
import {adminDatabase} from '../helpers/supabase';
test('canonical schema2 seed repetition preserves immutable source identities and actual balances',async()=>{
 await seedPackages();const database=await adminDatabase();
 try{
  async function snapshot(){return (await database.query("select r.label,r.content,p.version,p.purchase_state,l.balances,l.version as lot_version from app_private.synthetic_fixture_registry r join app_private.package_purchases p on p.id=(r.content->>'package_purchase_id')::uuid join app_private.package_lots l on l.id=(r.content->>'bonus_lot_id')::uuid where r.label in('package_named_v2','package_value_v2') order by r.label")).rows;}
  const before=await snapshot();expect(before).toHaveLength(2);await seedPackages();expect(await snapshot()).toEqual(before);
  expect((await database.query("select count(*)::int as n from app_private.policy_versions where id=any($1::uuid[]) and status='published' and schema_version=2",[[packageFixtureIds.namedPolicy,packageFixtureIds.valuePolicy]])).rows[0].n).toBe(2);
 }finally{await database.end();}
},60000);
