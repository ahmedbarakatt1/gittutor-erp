import type { Pool } from 'pg';
import type { ServerConfig } from '../server/config';
import type { ScanAdapter } from '../server/providers/file-scan';
import type { JobHandler } from './execute';
import { staffInvitationHandler } from './auth-invitations';
import { bookingDueHandler } from './booking-due';
import { packageDueHandler } from './package-due';
import { statementImportHandler } from './statement-import';
import { createPrivateObjectStore } from '../server/files';
import { fileScanHandler } from './file-scan';
import { createClamavScanAdapter, createFakeScanAdapter } from '../server/providers/file-scan';
import { calendarHandler } from './calendar';
import { calendarAdapterFactory } from '../server/calendar-provider';
import { notificationRouteHandler, notificationSendHandler } from './notifications';
import { createLocalEmailAdapter, createResendEmailAdapter, createSesEmailAdapter } from '../server/providers/email';
import { createGmailEmailAdapter } from '../server/providers/gmail';
import { createMailjetEmailAdapter } from '../server/providers/mailjet';
import { exportRenderHandler } from './exports';
import { whatsappSendHandler } from './whatsapp';
import { createWhatsAppAdapter, parseWhatsAppConfig } from '../server/providers/whatsapp';

export function createWorkerHandlers(pool: Pool, configuration: ServerConfig, scanner?: ScanAdapter) {
  const storage = createPrivateObjectStore(configuration);
  const liveScanner = scanner ?? (configuration.providers.file_scan === 'clamav' ? createClamavScanAdapter(configuration.file_scan_url!) : null);
  const liveEmail = configuration.gmail ? createGmailEmailAdapter(configuration.gmail)
    : configuration.mailjet ? createMailjetEmailAdapter(configuration.mailjet)
    : configuration.resend ? createResendEmailAdapter(configuration.resend)
    : configuration.email ? createSesEmailAdapter(configuration.email) : null;
  const whatsapp = parseWhatsAppConfig(process.env, configuration.isolated);
  const handlers: Record<string, JobHandler> = {
    'identity.staff_invitation': staffInvitationHandler(pool),
    'booking.process_due': bookingDueHandler(pool),
    'packages.process_due': packageDueHandler(pool),
    'payments.validate_statement': statementImportHandler(pool, file => file.source_provenance === 'stored_object' ? storage.read({ ...file, size_bytes: file.byte_size }) : Promise.resolve(null)),
    'files.scan': fileScanHandler(pool, file => storage.read(file), scenario => liveScanner ?? createFakeScanAdapter(scenario, configuration.isolated)),
    'calendar.sync': calendarHandler(pool, calendarAdapterFactory(pool, configuration)),
    'notifications.route': notificationRouteHandler(pool),
    'notifications.send': notificationSendHandler(pool, scenario => liveEmail ?? createLocalEmailAdapter('.local/email-inbox', configuration.isolated, scenario), configuration.app_base_url),
    'exports.render': exportRenderHandler(pool, storage),
    ...(whatsapp.mode === 'manual' ? {} : {
      'support.whatsapp_send': whatsappSendHandler(pool, scenario => createWhatsAppAdapter(whatsapp, scenario), whatsapp.mode, whatsapp.phone_number_id),
    }),
    'foundation.healthcheck': {
      execute: async job => `fake:healthcheck:${job.event_id}`,
      reconcile: async () => ({ outcome: 'not_sent' }), // Pure local healthcheck has no external side effect.
    },
  };
  return { handlers, channelMode: whatsapp.mode };
}
