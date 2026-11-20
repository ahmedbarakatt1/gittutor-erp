import { connection } from 'next/server';
import { whatsAppMode } from '@/server/config';
import { ManualWhatsApp } from './manual-whatsapp';
import { SupportWorkspace } from './workspace';
import { WhatsAppContactAction } from '../public-contact';
import { publicSupportCopy as copy, supportCopy } from '@/locales/support';
import styles from './public-support.module.css';

export async function ChannelWorkspace({ staff = false, publicEntry = false }: { staff?: boolean; publicEntry?: boolean }) {
  await connection();
  const manualWhatsApp = whatsAppMode(process.env.WHATSAPP_ADAPTER) === 'manual';
  if (publicEntry) return <div>
    <div className={styles.channels}>
      <SupportWorkspace manualWhatsApp={manualWhatsApp} publicEntry />
      {manualWhatsApp && <section className={styles.option} aria-labelledby="whatsapp-support">
        <div><h2 id="whatsapp-support">{copy.whatsappTitle}</h2><p>{copy.whatsappBody}</p></div>
        <WhatsAppContactAction>{copy.whatsappAction}</WhatsAppContactAction>
      </section>}
    </div>
    <p className={styles.privacy}>{supportCopy.privacy}</p>
  </div>;
  return <>{manualWhatsApp && <ManualWhatsApp staff={staff} />}
    <SupportWorkspace staff={staff} manualWhatsApp={manualWhatsApp} /></>;
}
