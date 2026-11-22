# Vercel hosting and free-service limits

## Worker and private scanner

The owner selected Vercel for the website, background worker and private file scanner. Supabase continues to provide the database, authentication and private storage. The earlier Oracle proposal is withdrawn.

On 22 November 2026 the Vercel API reported a Hobby team, one ready testing worker and zero production worker instances. The existing continuous worker and ClamAV configuration requests 8 GiB. Hobby daemon sizes top out at 2 GiB and include 420 GB-hours per month across the team. Even a single continuously running 1 GiB daemon exceeds that allowance in a full month. [Vercel daemon limits](https://vercel.com/docs/daemons/limits) · [Private scanner configuration](../deploy/vercel-private-scanner.example.json)

A Vercel-only route to investigate for free testing is on-demand scanning in Vercel Sandbox. Hobby allows up to 8 GB per sandbox and sessions of up to 45 minutes. New sandbox creation pauses when the included quota is exhausted. A queued upload must stay private until a successful scan. Before adopting this design, measure cold start, validate fresh signatures and verify durable retry when a sandbox cannot start. Scheduling, notification and financial jobs still need their own timely execution. No on-demand scanner is deployed. [Vercel Sandbox limits and pricing](https://vercel.com/docs/sandbox/pricing)

The current production deployment procedure for a continuous Vercel daemon is in [Deployment](DEPLOYMENT.md). Enable live scanning only after the selected execution mode and capacity have been verified. The [implementation log](IMPLEMENTATION-STATUS.md) retains historical test results.

## Email and meetings

Use the selected Mailjet SMTP adapter for the verified owner address, with privately stored API/secret credentials. Clean production Auth settings are saved/read back; the two owner-only Auth messages arrived in Spam. Browser invitation and reset on the final hostname and final worker activation remain unverified. Never activate sending against a pilot backlog. Gmail's encrypted credential/helper remain available for rollback.

Mailjet's owner test arrived in Spam. The latest **use mailjet** instruction superseded the intermediate keep-Gmail choice. Its Free plan has6,000/month and200/day limits; a verified Gmail sender does not establish reliable Inbox delivery. The preview stays fake/manual and no customer queue was dispatched. [Mailjet setup](MAILJET-SETUP.md).

The existing Calendar/Meet integration needs a Google Cloud OAuth web client and organizer consent. Free Meet permits up to60minutes when three or more people join; a tutor plus two learners already reaches that limit. It cannot provide the promised90–105minute continuous group session. Before activation, select an existing organizer account with suitable meeting entitlement, or approve a different free meeting provider and its implementation/testing. A forced break/rejoin is a commercial-policy change and is not silently substituted. [Google Meet limits](https://support.google.com/meet/answer/7317473?hl=en).

WhatsApp launches in manual mode. The public link opens the existing business number, +20 15 08823452. Staff read and reply in WhatsApp. Website support keeps its own inbox and history. Manual mode requires no Meta credentials or automated messaging service. Any later use of the Cloud API requires separate provider setup and cost review.

## Recovery

Choose an off-device destination, recovery owner, retention period and recovery targets. Rehearse restoration of private files and financial records before launch. [Production inputs](PRODUCTION-INPUTS.md)
