import { StaffMessage, StaffCairoLessonTime } from '@/components/ar-staff-label';
import { pageMetadata } from '@/server/page-metadata';
import Link from 'next/link';
import { PortalShell } from '@/components/portal-shell';
import { requireAccount } from '@/server/auth';
import { TutorProfileWorkspace } from '@/components/identity-workspaces';
import { renderDashboardOverview } from '@/components/workflow-import/staff-overview';
import { listTutorOccurrences } from '@/modules/booking/queries';
import { getWorkflowOperations } from '@/modules/workflow-import/operational-queries';
import { serverSupabase } from '@/server/supabase';
import styles from '@/components/auth.module.css';
import overviewStyles from '@/components/workflow-import/operational-workspaces.module.css';

export const generateMetadata = pageMetadata({ title: 'Tutor workspace | Git Tutor', robots: { index: false, follow: false } });
export default async function TutorPage() {
  const account = await requireAccount('tutor');
  const client = await serverSupabase();
  const from = new Date().toISOString();
  const [operations, sessions] = await Promise.all([
    getWorkflowOperations(client, 'tutor'),
    Promise.all((['confirmed', 'forming'] as const).map(state => listTutorOccurrences(client, { from, state, limit: 2 })))
      .then(pages => pages.flatMap(page => page.items.map(item => item.occurrence))
        .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.occurrence_id.localeCompare(b.occurrence_id)).slice(0, 2))
      .catch(() => null),
  ]);
  const schedule = <Link href="/tutor/schedule" className={overviewStyles.queueAction}>
    <span><StaffMessage text="Open teaching schedule" /></span>
    {!sessions?.length && <small><StaffMessage text={sessions ? 'No upcoming sessions in the next 90 days' : 'Schedule preview unavailable'} /></small>}
  </Link>;
  const upcoming = sessions && sessions.length > 0 && <section className={overviewStyles.upcoming} aria-labelledby="upcoming-sessions-title">
    <h2 id="upcoming-sessions-title"><StaffMessage text="Upcoming sessions" /></h2>
    <ul>{sessions.map(session => <li key={session.occurrence_id}>
      <Link href={`/tutor/schedule?occurrence=${session.occurrence_id}`}>
        <StaffCairoLessonTime instant={session.start_at} />
        <span><StaffMessage text={session.format === 'group' ? 'Group' : 'Individual'} /> · <StaffMessage text={session.state === 'forming' ? 'Forming' : 'Confirmed'} /></span>
      </Link>
    </li>)}</ul>
  </section>;
  const overview = renderDashboardOverview('tutor', operations, schedule);
  if (overview) return <PortalShell kind="tutor" account={account} title="Your teaching overview" description="Your assigned sessions and workbook figures." showAccount={false} activePath="/tutor" primaryAction={upcoming}>
    {overview}
    <details className={styles.accountTools}>
      <summary><StaffMessage text="Edit teaching profile" /></summary>
      <TutorProfileWorkspace />
    </details>
  </PortalShell>;
  return <PortalShell kind="tutor" account={account} primaryAction={<>{upcoming}<div className={overviewStyles.overviewToolbar}>{schedule}</div></>}><TutorProfileWorkspace /></PortalShell>;
}
