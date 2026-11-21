'use client';
import { supportText } from '@/locales/ar-support';
import { useSiteLanguage } from '@/components/site-language';
import { publicContact } from '@/locales/contact';
import { WhatsAppContactAction } from '../public-contact';

export function ManualWhatsApp({ staff = false }: { staff?: boolean }) {
  const language = useSiteLanguage();
  const text = (label: string) => supportText(language, label);

  return <section aria-label={text("WhatsApp support")}>
    <h2>{text("WhatsApp support")}</h2>
    {staff
      ? <p>{text("Read and reply to WhatsApp messages in the business app on")} <bdi dir="ltr">{publicContact.phoneDisplay}</bdi>{text(". Website conversations stay in the support inbox.")}</p>
      : <><p>{text("Our team replies directly in WhatsApp. To keep a conversation in your Git Tutor account, use website support.")}</p>
        <WhatsAppContactAction>{text("Message Git Tutor on WhatsApp")} <bdi dir="ltr">{publicContact.phoneDisplay}</bdi></WhatsAppContactAction></>}
  </section>;
}
