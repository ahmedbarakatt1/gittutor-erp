import { mkdtemp,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect,test } from 'vitest';
import { renderNotification,notificationKinds } from '../../src/modules/notifications/templates';
import { createLocalEmailAdapter } from '../../src/server/providers/email';
test.each([
 ['en', 'ltr', 'View booking', 'Session time in Cairo', '22:30'],
 ['ar', 'rtl', 'عرض الحجز', 'موعد الجلسة بتوقيت القاهرة', '١٠:٣٠'],
] as const)('renders matching %s booking content and one first-party action in both formats', (locale, direction, action, timeLabel, time) => {
 const booking = { kind: 'reservation', locale, audience: 'customer', action_path: '/learn/bookings', starts_at: '2026-11-11T20:30:00Z' } as const;
 const origin = 'https://gittutor.example.test';
 const message = renderNotification(booking, origin);
 const url = origin + booking.action_path;
 expect(message.html).toContain(`dir="${direction}"`);
 expect(message.html).toContain('name="viewport"');
 expect(message.html.match(/href="/g)).toHaveLength(1);
 expect(message.html).toContain(`href="${url}"`);
 expect(message.html).not.toMatch(/<img\b|<script\b|<form\b/i);
 expect(message.text).toContain(url);
 for (const part of [message.text, message.html]) {
   for (const wording of [message.subject, action, timeLabel, time]) expect(part).toContain(wording);
 }
 const unscheduled = renderNotification({ ...booking, starts_at: null }, origin);
 for (const part of [unscheduled.html, unscheduled.text]) expect(part).not.toContain(timeLabel);
});
test('a staff payout update directs the reviewer to their workspace without attributing the payout to them', () => {
 const message = renderNotification({
   kind: 'payout', locale: 'en', audience: 'staff', action_path: '/admin/finance', starts_at: null,
 }, 'https://portal.example.test');
 expect(message.subject).toBe('Payout update');
 for (const part of [message.text, message.html]) {
   expect(part).toContain('Open workspace');
   expect(part).toContain('https://portal.example.test/admin/finance');
   expect(part).not.toContain('Your payout');
 }
});
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
