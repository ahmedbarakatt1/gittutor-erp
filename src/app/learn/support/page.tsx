import { pageMetadata } from '@/server/page-metadata';
import { supportText } from '@/locales/ar-support';
import { getSiteLanguage } from '@/server/site-language';
import {requireAccount} from '@/server/auth';
import {PortalShell} from '@/components/portal-shell';
import {ChannelWorkspace} from '@/components/support/channel-workspace';
export const generateMetadata = pageMetadata({title:'Support | Git Tutor',robots:{index:false,follow:false}});
export default async function Page(){
  const language = await getSiteLanguage();
  const text = (label: string) => supportText(language, label);
const account=await requireAccount();return <PortalShell kind="learn" account={account} title={text("Your support conversations")} description={text("Ask a question or continue a conversation with our team.")} activePath="/learn/support" showAccount={false}><ChannelWorkspace/></PortalShell>;}
