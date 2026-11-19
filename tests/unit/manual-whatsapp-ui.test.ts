import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { ChannelWorkspace } from '../../src/components/support/channel-workspace';
import { StaffSupportActions } from '../../src/components/support/actions';
import { publicContact } from '../../src/locales/contact';
import type { Conversation } from '../../src/modules/support/commands';

vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('../../src/components/payments/shared', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/components/payments/shared')>(),
  usePaymentRecord: () => ({ data: { is_admin: true, staff: [], templates: [], hours: { version: 1, weekly_intervals: [], response_target_minutes: null } }, reload: vi.fn() }),
}));
afterEach(() => { vi.unstubAllEnvs(); });

test('manual support shows the existing contact before sign-in and keeps the website inbox and staffed hours available', async () => {
  vi.stubEnv('WHATSAPP_ADAPTER', 'manual');
  const customer = renderToStaticMarkup(await ChannelWorkspace({}));
  expect(customer).toContain('href="' + publicContact.whatsappHref + '"');
  expect(customer).toContain('href="/brand/contact-icons.svg#whatsapp"');
  expect(customer).toContain(publicContact.phoneDisplay);
  expect(customer).toContain('Start a conversation');
  const staff = renderToStaticMarkup(await ChannelWorkspace({ staff: true }));
  expect(staff).toContain('business app');
  expect(staff).toContain('Support inbox');
  expect(staff).toContain('Configure staffed support hours');
  expect(staff).not.toContain('Register a provider-approved WhatsApp template');
  vi.stubEnv('WHATSAPP_ADAPTER', 'fake');
  const simulated = renderToStaticMarkup(await ChannelWorkspace({ staff: true }));
  expect(simulated).toContain('Register a provider-approved WhatsApp template');
  expect(simulated).not.toContain('business app');
});

test('a historical WhatsApp thread offers no dispatch or retry controls in manual mode', () => {
  const thread = { channel: 'whatsapp', can_reply: true, consent_status: 'opted_in', requires_template: false,
    conversation_id: 'test-thread', messages: [{ message_id: 'uncertain-message', can_reconcile: true }] } as Conversation;
  const render = (manualWhatsApp: boolean) => renderToStaticMarkup(createElement(StaffSupportActions, { thread, manualWhatsApp, onChanged: vi.fn() }));
  for (const control of ['Send WhatsApp reply', 'Send an approved WhatsApp template', 'Reconcile uncertain WhatsApp delivery']) {
    expect(render(true)).not.toContain(control);
    expect(render(false)).toContain(control);
  }
});
