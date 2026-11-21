import { supportText } from '@/locales/ar-support';
import { getSiteLanguage } from '@/server/site-language';
import{requireAccount}from'@/server/auth';import{PortalShell}from'@/components/portal-shell';import{ChannelWorkspace}from'@/components/support/channel-workspace';
export default async function Page(){
  const language = await getSiteLanguage();
  const text = (label: string) => supportText(language, label);
const account=await requireAccount('customer_service');return <PortalShell kind="service" account={account} title={text("Support inbox")} description={text("Own the next response and keep private notes separate from the conversation.")} activePath="/service/support" showAccount={false}><ChannelWorkspace staff/></PortalShell>;}
