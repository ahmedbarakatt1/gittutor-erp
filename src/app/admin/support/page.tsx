import { supportText } from '@/locales/ar-support';
import { getSiteLanguage } from '@/server/site-language';
import{requireAccount}from'@/server/auth';import{PortalShell}from'@/components/portal-shell';import{ChannelWorkspace}from'@/components/support/channel-workspace';
export default async function Page(){
  const language = await getSiteLanguage();
  const text = (label: string) => supportText(language, label);
const account=await requireAccount('admin');return <PortalShell kind="admin" account={account} title={text("Support inbox")} description={text("Review ownership and unresolved customer conversations.")} activePath="/admin/support" showAccount={false}><ChannelWorkspace staff/></PortalShell>;}
