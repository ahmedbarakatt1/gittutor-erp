# Free-service deployment decision

Prepared15November2026. The owner requires free services and selected Gmail without a domain. No paid upgrade, trial-credit resource, new hosting account or production cutover is authorized by this document. The current Vercel pilot remains available for testing.

**Owner decision after review: keep the current testing preview for now.** The Oracle proposal below is deferred; no Oracle signup, access credential or provisioning is requested at this point. The owner also reports an existing longer-duration Meet account; verify that account and its capabilities instead of selecting a different provider.

## Proposed infrastructure

Retain the already prepared clean Free Supabase project for PostgreSQL, Auth and private files. A possible no-subscription host is **one Oracle Always Free A1 VM, 2 OCPUs / 12GB RAM**, with a modest boot volume within its200GB allowance. Deploy the existing non-root web/worker images from one reviewed commit using `compose.production.yml`; add HTTPS ingress and a private ClamAV service on that VM. Give ClamAV at least4GB RAM, bound the web/worker memory, and verify actual upload scans and update health before activation. Public ingress must expose only HTTPS/HTTP redirect; never expose the database, scanner or Docker API. Use a stable free DNS hostname controlled by the owner, with a valid HTTPS certificate, before configuring Auth and OAuth redirects.

This is a concrete capacity proposal, not a reserved machine or verified deployment. ARM image compatibility/builds, ingress, scanner signatures and complete hosted journeys still require execution on the selected host. Always Free capacity can be unavailable and idle instances can be reclaimed. The current official allowance is2 OCPUs/12GB, not the older4/24 allowance. Account registration requires the owner's identity/card verification and can create a temporary authorization hold; the agent must not receive card details or enable paid billing. Use only resources explicitly labelled Always Free and stop if free capacity is unavailable. [Oracle resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [account requirements](https://www.oracle.com/cloud/free/faq/).

Owner decision needed: approve this hosting change and create/sign into the Oracle Free account, then provide the tenancy/home-region identifier and a secure way to provision/access the selected VM. Do not paste an SSH private key or account password in chat. The existing Vercel/Supabase/GitHub connections do not grant Oracle access. No account or VM has been created.

Executed image-manifest checks found Linux ARM64 support in the existing `node:24.22.1-bookworm-slim` base. The ordinary `clamav/clamav:stable` tag currently supplies AMD64 only; use the official Debian variant for the proposed ARM host. `clamav/clamav:stable-debian13-slim` resolved an ARM64 image at `sha256:6e1a1e79153bb1b3732f68eba5da81cc64ebc8070735aaea5a5077d888eb86da` on15November2026. Pin the reviewed digest during deployment rather than tracking a moving stable tag. `docker buildx imagetools inspect ... --raw` exited0 for all three manifest reads; saved manifests are private setup evidence. No container was started and no ARM build or malware scan is claimed. [Official ClamAV images](https://github.com/Cisco-Talos/clamav-docker).

Vercel Hobby remains useful for the current isolated pilot but its terms restrict use to personal/noncommercial purposes. Its1GB daemon allowance also does not provide a full month of uninterrupted service, and the current worker lacks scanner memory. Keeping it unchanged therefore does not close commercial release readiness. [Vercel terms](https://vercel.com/legal/terms), [daemon limits](https://vercel.com/docs/daemons/limits), [ClamAV memory guidance](https://docs.clamav.net/manual/Installing/Docker.html).

## Email and meetings

Use the implemented Gmail SMTP adapter for the selected owner address, with a privately entered App Password. No bought domain or mailbox hosting is needed for this route. It has limited sending capacity and manual handling of uncertain outcomes; [Gmail setup](GMAIL-SETUP.md) records the exact verification steps. Configure Supabase Auth SMTP separately, then verify owner access. Never activate sending against a pilot job backlog.

Mailjet was subsequently prepared at the owner's request. Its approved owner test arrived in Spam, so the owner selected **Keep Gmail for now; retain Mailjet ready**. Mailjet's Free plan has6,000/month and200/day limits; a verified Gmail sender does not establish reliable Inbox delivery. The optional adapter and encrypted credentials remain inactive. [Mailjet setup](MAILJET-SETUP.md).

The existing Calendar/Meet integration needs a Google Cloud OAuth web client and organizer consent. Free Meet permits up to60minutes when three or more people join; a tutor plus two learners already reaches that limit. It cannot provide the promised90–105minute continuous group session. Before activation, select an existing organizer account with suitable meeting entitlement, or approve a different free meeting provider and its implementation/testing. A forced break/rejoin is a commercial-policy change and is not silently substituted. [Google Meet limits](https://support.google.com/meet/answer/7317473?hl=en).

Public WhatsApp/phone contact links already work. Automated WhatsApp still needs Meta account/token/webhook/template setup and has not been promised as free. The current production configuration requires its live adapter; a manual-only launch would need an explicit disabled-automation mode and reviewed workflow changes, not a fake adapter relabelled as production.

## Cutover and recovery

Keep the pilot's imported history and fictional practice separate from the clean production database. Reuse only reviewed source mappings and verified account ownership during cutover. Preserve confidential compensation through the existing privileged projections. An isolated local restore from the hosted pilot is useful recovery evidence, but it does not prove recovery onto a replacement cloud host or satisfy off-device backup requirements. An approved backup destination, retention schedule, restore-point/time targets and responsible owner remain necessary.

The free-only plan is viable only after actual account capacity, group meeting arrangements and operational safeguards are verified. No service availability, zero future cost or completed production activation is asserted.
