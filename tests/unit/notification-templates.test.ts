import { mkdtemp,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect,test } from 'vitest';
import { renderNotification,notificationKinds } from '../../src/modules/notifications/templates';
import { createLocalEmailAdapter } from '../../src/server/providers/email';
test('strict customer templates reject compensation fields, privileged categories and unsafe links',()=>{
 const base={kind:'session' as const,locale:'en' as const,audience:'customer' as const,action_path:'/learn/bookings',starts_at:'2026-11-11T12:00:00Z'};
 for(const locale of ['en','ar'] as const){const content=renderNotification({...base,locale},'https://gittutor.example.test');expect(content.html).toContain(`lang="${locale}"`);expect(content.text).not.toMatch(/fee|margin|payout_destination/);}
 for(const changed of [{tutor_fee_minor:45000},{kind:'earning'},{action_path:'//attacker.example.test'},{action_path:'/admin/finance'}])expect(()=>renderNotification({...base,...changed} as typeof base,'https://gittutor.example.test')).toThrow();
 for(const kind of notificationKinds)expect(renderNotification({...base,kind,audience:'staff',action_path:'/admin'},'https://gittutor.example.test').subject.length).toBeGreaterThan(0);
});
test('local email persists before lost acknowledgement and reconciles without a second message',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'git-tutor-email-')),adapter=createLocalEmailAdapter(directory,true,'timeout_after_success');const message={attempt_id:randomUUID(),to:'synthetic@example.test',...renderNotification({kind:'session',locale:'en',audience:'customer',action_path:'/learn/bookings',starts_at:null},'http://localhost:3000')};
 expect((await adapter.send(message)).outcome).toBe('unknown');expect((await adapter.reconcile(message.attempt_id)).outcome).toBe('sent');expect((await adapter.send(message)).outcome).toBe('sent');expect(JSON.parse(await readFile(join(directory,`${message.attempt_id}.json`),'utf8')).message).toEqual(message);
 await expect(adapter.send({...message,text:'changed'})).rejects.toThrow('EMAIL_IDENTITY_CONFLICT');await expect(adapter.send({...message,attempt_id:randomUUID(),to:'real@example.com'})).rejects.toThrow('SYNTHETIC_EMAIL_REQUIRED');
});
