# Hosting decision and earlier free-service proposal

## Current worker-only deployment, 22 November 2026

Keep the website on Vercel and the database, authentication and private files on Supabase. Run the background worker and ClamAV together on one Oracle Always Free Ampere A1 VM in the tenancy's home region. The scanner listens on container loopback and the worker initiates outbound connections. This deployment needs neither a public application port nor a new domain. The previous full-site migration proposal below is historical.

Use a Free Tier tenancy, `VM.Standard.A1.Flex`, **2 OCPUs, 8 GB RAM and one 50 GB boot volume**, within the tenancy's **remaining** Always Free allowance. At 744 hours these settings require 1,488 OCPU-hours and 5,952 GB-hours. Check both compute dimensions, storage and existing network use together before creating anything. Keep the account on Free Tier and the cost estimate at zero. Capacity is regional and Oracle can reclaim idle instances. A missing worker heartbeat or a pending private upload after a VM interruption requires operator attention. [Oracle allowances and reclamation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) · [Signup and verification](https://www.oracle.com/cloud/free/faq/)

### Operator procedure

1. Check home-region capacity and remaining allowance. Select an Always Free eligible ARM Linux image. Restrict SSH to the operator, allow outbound HTTPS, the production database connection and required provider endpoints, and keep the Docker daemon and ClamAV inaccessible from outside. Enable Docker to start at boot. Use the reviewed Git revision on the host.
2. From the repository root build the ARM64 image and record its ID. The image shares the Vercel scanner supervisor and its maximum-size, freshness and quarantine tests. Its architecture-specific runtime and engine are pinned. A separate pinned image supplies signed signature data only.

   ```sh
   docker buildx build --platform linux/arm64 --load -f deploy/arm-worker/Dockerfile -t git-tutor-background:reviewed .
   export GIT_TUTOR_WORKER_IMAGE="$(docker image inspect -f '{{.Id}}' git-tutor-background:reviewed)"
   docker image inspect -f '{{.Os}}/{{.Architecture}} {{.Id}}' "$GIT_TUTOR_WORKER_IMAGE"
   ```

3. On the fresh VM, run the scanner check with the same memory and privilege limits as the service. This check needs no site secrets or customer files. Use the named volume to retain fresh signatures for the worker. Run it before starting the service, with exclusive access to that volume.

   ```sh
   docker run --rm --init --platform linux/arm64 --read-only --memory 6g --memory-swap 6g \
     --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add KILL --security-opt no-new-privileges \
     --tmpfs /tmp:mode=1777,size=384m --mount type=volume,src=git-tutor-background_signatures,dst=/var/lib/clamav \
     "$GIT_TUTOR_WORKER_IMAGE" --verify-scanner
   ```

4. Place the production worker settings in an operator-controlled file with mode 0600 outside the checkout. The worker requires the restricted worker database role and the production provider settings. Confirm the production Vercel worker is stopped. Start the VM worker in its default `files.scan` mode and inspect its heartbeat. The first phase processes any pending file scans. All other job categories stay queued.

   ```sh
   export GIT_TUTOR_ENV_FILE=/etc/git-tutor/worker.env
   export GIT_TUTOR_WORKER_PURPOSE=files.scan
   docker compose -f deploy/arm-worker/compose.yml config --quiet
   docker compose -f deploy/arm-worker/compose.yml up -d
   docker compose -f deploy/arm-worker/compose.yml ps
   ```

5. Use the synthetic production test account for a clean upload and a harmless antivirus test fixture. Check quarantine, authorized retrieval of the clean file, heartbeat after restart, and pending work recovery. Review the live notification and finance queues before enabling general dispatch. After that review, set `GIT_TUTOR_WORKER_PURPOSE=''` explicitly and rerun the same Compose startup. To pause jobs, use `docker compose -f deploy/arm-worker/compose.yml stop`. Preserve the definitions volume and database leases for recovery.

On 19 November the owner selected the existing Vercel team for production and staff replies on the existing WhatsApp number. The clean Supabase project, Mailjet and Google organizer are retained. The production worker and scanner are prepared separately from the testing worker. The current selection, configuration and steps for activation are documented in [production inputs](PRODUCTION-INPUTS.md) and [deployment](DEPLOYMENT.md).

## Earlier Oracle proposal, deferred 15 November

Retain the already prepared clean Free Supabase project for PostgreSQL, Auth and private files. A possible no-subscription host is **one Oracle Always Free A1 VM, 2 OCPUs / 12GB RAM**, with a modest boot volume within its200GB allowance. Deploy the existing non-root web/worker images from one reviewed commit using `compose.production.yml`; add HTTPS ingress and a private ClamAV service on that VM. Give ClamAV at least4GB RAM, bound the web/worker memory, and verify actual upload scans and update health before activation. Public ingress must expose only HTTPS/HTTP redirect; never expose the database, scanner or Docker API. Use a stable free DNS hostname controlled by the owner, with a valid HTTPS certificate, before configuring Auth and OAuth redirects.

This is a concrete capacity proposal, not a reserved machine or verified deployment. ARM image compatibility/builds, ingress, scanner signatures and complete hosted journeys still require execution on the selected host. Always Free capacity can be unavailable and idle instances can be reclaimed. The current official allowance is2 OCPUs/12GB, not the older4/24 allowance. Account registration requires the owner's identity/card verification and can create a temporary authorization hold; the agent must not receive card details or enable paid billing. Use only resources explicitly labelled Always Free and stop if free capacity is unavailable. [Oracle resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [account requirements](https://www.oracle.com/cloud/free/faq/).

This earlier proposal would require the owner to approve a hosting change and create/sign into the Oracle Free account, then provide the tenancy/home-region identifier and a secure way to provision/access the selected VM. Do not paste an SSH private key or account password in chat. The existing Vercel/Supabase/GitHub connections do not grant Oracle access. No account or VM has been created.

Executed image-manifest checks found Linux ARM64 support in the existing `node:24.22.1-bookworm-slim` base. The ordinary `clamav/clamav:stable` tag currently supplies AMD64 only; use the official Debian variant for the proposed ARM host. `clamav/clamav:stable-debian13-slim` resolved an ARM64 image at `sha256:6e1a1e79153bb1b3732f68eba5da81cc64ebc8070735aaea5a5077d888eb86da` on15November2026. Pin the reviewed digest during deployment rather than tracking a moving stable tag. `docker buildx imagetools inspect ... --raw` exited0 for all three manifest reads; saved manifests are private setup evidence. No container was started and no ARM build or malware scan is claimed. [Official ClamAV images](https://github.com/Cisco-Talos/clamav-docker).

Vercel Hobby remains useful for the current isolated pilot but its terms restrict use to personal/noncommercial purposes. Its1GB daemon allowance also does not provide a full month of uninterrupted service, and the current worker lacks scanner memory. Keeping it unchanged therefore does not close commercial release readiness. [Vercel terms](https://vercel.com/legal/terms), [daemon limits](https://vercel.com/docs/daemons/limits), [ClamAV memory guidance](https://docs.clamav.net/manual/Installing/Docker.html).

## Email and meetings

Use the selected Mailjet SMTP adapter for the verified owner address, with privately stored API/secret credentials. Clean production Auth settings are saved/read back; the two owner-only Auth messages arrived in Spam. Browser invitation and reset on the final hostname and final worker activation remain unverified. Never activate sending against a pilot backlog. Gmail's encrypted credential/helper remain available for rollback.

Mailjet's owner test arrived in Spam. The latest **use mailjet** instruction superseded the intermediate keep-Gmail choice. Its Free plan has6,000/month and200/day limits; a verified Gmail sender does not establish reliable Inbox delivery. The preview stays fake/manual and no customer queue was dispatched. [Mailjet setup](MAILJET-SETUP.md).

The existing Calendar/Meet integration needs a Google Cloud OAuth web client and organizer consent. Free Meet permits up to60minutes when three or more people join; a tutor plus two learners already reaches that limit. It cannot provide the promised90–105minute continuous group session. Before activation, select an existing organizer account with suitable meeting entitlement, or approve a different free meeting provider and its implementation/testing. A forced break/rejoin is a commercial-policy change and is not silently substituted. [Google Meet limits](https://support.google.com/meet/answer/7317473?hl=en).

WhatsApp launches in manual mode. The public link opens the existing business number, +20 15 08823452. Staff read and reply in WhatsApp. Website support keeps its own inbox and history. Manual mode requires no Meta credentials or automated messaging service. Any later use of the Cloud API requires separate provider setup and cost review.

## Cutover and recovery

Keep the pilot's imported history and fictional practice separate from the clean production database. Reuse only reviewed source mappings and verified account ownership during cutover. Preserve confidential compensation through the existing privileged projections. An isolated local restore from the hosted pilot is useful recovery evidence, but it does not prove recovery onto a replacement cloud host or satisfy off-device backup requirements. An approved backup destination, retention schedule, restore-point/time targets and responsible owner remain necessary.

The free-only plan is viable only after actual account capacity, group meeting arrangements and operational safeguards are verified. No service availability, zero future cost or completed production activation is asserted.
