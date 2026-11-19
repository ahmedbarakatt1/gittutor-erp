import type {Metadata} from 'next';
import {requireAccount} from '@/server/auth';
import {PortalShell} from '@/components/portal-shell';
import {ChannelWorkspace} from '@/components/support/channel-workspace';
export const metadata:Metadata={title:'Support | Git Tutor',robots:{index:false,follow:false}};
export default async function Page(){const account=await requireAccount();return <PortalShell kind="learn" account={account} title="Your support conversations" description="Ask a question or continue a conversation with our team." activePath="/learn/support" showAccount={false}><ChannelWorkspace/></PortalShell>;}
