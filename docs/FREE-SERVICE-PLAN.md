# Vercel hosting and free-service limits

## Worker and private scanner

The owner selected Vercel for the website, background worker and private file scanner. Supabase continues to provide the database, authentication and private storage. The earlier Oracle proposal is withdrawn.

On 22 November 2026 the Vercel API reported a Hobby team, one ready testing worker and zero production worker instances. The existing continuous worker and ClamAV configuration requests 8 GiB. Hobby daemon sizes top out at 2 GiB and include 420 GB-hours per month across the team. Even a single continuously running 1 GiB daemon exceeds that allowance in a full month. [Vercel daemon limits](https://vercel.com/docs/daemons/limits) · [Private scanner configuration](../deploy/vercel-private-scanner.example.json)

The production request flow now scans new enrolled uploads in an isolated Vercel Sandbox. The clean PDF and quarantine checks are recorded in the release log. The general worker can run on demand inside Vercel Functions. Supabase checks for due jobs every minute and calls the protected Vercel endpoint only for queues with work. The app applies its usual leases and retry rules. The scheduled function also checks for pending Drive grants and revocations. Monthly usage limits still apply. [Release evidence](IMPLEMENTATION-STATUS.md) · [Vercel Sandbox pricing](https://vercel.com/docs/sandbox/pricing)

For installation, set a random server-only `WORKER_WAKE_SECRET` on the production web deployment. Save the matching value in Supabase Vault as `git_tutor_worker_wake`; save the Vercel deployment-protection automation credential as `git_tutor_vercel_protection`. Test a signed POST to `/api/cron/worker` with `x-git-tutor-purpose: foundation.healthcheck`. An idle queue returns zero processed jobs. An unsigned POST must return 401. Review queued purposes and intended recipients before activating. Apply the [scheduler SQL](../deploy/supabase-worker-schedule.sql) on the production database. The scheduler reads its credentials at execution and sends them directly to the fixed HTTPS origin. The Vercel function acknowledges with 202 and performs the work after responding. Queue states and attempts show execution outcomes. [Supabase HTTP extension](https://supabase.com/docs/guides/database/extensions/http)

To pause general dispatch, run `select cron.unschedule('git-tutor-vercel-worker')` as the deployment operator. Review the durable queue before re-enabling. An expired lease can require reconciliation. Leave jobs with uncertain external delivery for investigation. The continuous daemon remains an alternative for a future operating budget. [Deployment](DEPLOYMENT.md)

Protected production ran the minute schedule and dispatched the real background worker on 23 November. A synthetic administration upload scanned clean with ClamAV 1.5.4 (signatures 28191). A queued learner export became available and downloaded with its requested columns. The continuous daemon has zero running instances.

## Email and meetings

Use the selected Mailjet SMTP adapter for the verified owner address, with privately stored API/secret credentials. Clean production Auth settings are saved/read back; the two owner-only Auth messages arrived in Spam. The first designated test tutor activated from the production invitation. Password recovery and general worker dispatch have separate release checks. Never activate sending against a pilot backlog. Gmail's encrypted credential/helper remain available for rollback.

Mailjet's owner test arrived in Spam. The latest **use mailjet** instruction superseded the intermediate keep-Gmail choice. Its Free plan has 6,000/month and 200/day limits; a verified Gmail sender does not establish reliable Inbox delivery. The preview stays fake/manual and no customer queue was dispatched. [Mailjet setup](MAILJET-SETUP.md).

The production organizer completed consent. Git Tutor verified creation and removal of a private Meet event. The owner identified this account as having longer calls. An actual 90–105 minute group session and parallel sessions with a second verified organizer remain release checks. [Google Meet limits](https://support.google.com/meet/answer/7317473?hl=en).

WhatsApp launches in manual mode. The public link opens the existing business number, +20 15 08823452. Staff read and reply in WhatsApp. Website support keeps its own inbox and history. Manual mode requires no Meta credentials or automated messaging service. Any later use of the Cloud API requires separate provider setup and cost review.

## Recovery

Choose an off-device destination, recovery owner, retention period and recovery targets. Rehearse restoration of private files and financial records before launch. [Production inputs](PRODUCTION-INPUTS.md)
