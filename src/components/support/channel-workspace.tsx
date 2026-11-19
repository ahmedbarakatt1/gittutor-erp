import { connection } from 'next/server';
import { whatsAppMode } from '@/server/config';
import { ManualWhatsApp } from './manual-whatsapp';
import { SupportWorkspace } from './workspace';

export async function ChannelWorkspace({ staff = false }: { staff?: boolean }) {
  await connection();
  const manualWhatsApp = whatsAppMode(process.env.WHATSAPP_ADAPTER) === 'manual';
  return <>{manualWhatsApp && <ManualWhatsApp staff={staff} />}
    <SupportWorkspace staff={staff} manualWhatsApp={manualWhatsApp} /></>;
}
