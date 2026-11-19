import { publicContact } from '@/locales/contact';
import { WhatsAppContactAction } from '../public-contact';

export function ManualWhatsApp({ staff = false }: { staff?: boolean }) {
  return <section aria-label="WhatsApp support">
    <h2>WhatsApp support</h2>
    {staff
      ? <p>Read and reply to WhatsApp messages in the business app on <bdi dir="ltr">{publicContact.phoneDisplay}</bdi>. Website conversations stay in the support inbox.</p>
      : <><p>Our team replies directly in WhatsApp. To keep a conversation in your Git Tutor account, use website support.</p>
        <WhatsAppContactAction>Message Git Tutor on WhatsApp <bdi dir="ltr">{publicContact.phoneDisplay}</bdi></WhatsAppContactAction></>}
  </section>;
}
