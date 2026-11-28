# Mailjet setup

Updated16November2026. The owner requested Mailjet and completed account creation/email activation for `gittutor2@gmail.com`. The authenticated dashboard now confirms **Free**,6,000 emails/month,200/day and1,000 stored contacts; no card, paid plan or upgrade was added. [Current pricing](https://www.mailjet.com/pricing/).

The supplied API/secret pair is saved only as Windows-current-user DPAPI ciphertext in ignored `.local/production-setup/mailjet-credentials.dpapi`. These are SMTP credentials; neither the Mailjet login password nor the Gmail App Password is used for Mailjet SMTP. No secret belongs in public environment variables, browser responses, committed files or normal logs.

## Executed result and owner decision

Mailjet's authenticated sender lookup returned **Active** for the owner address. Certificate-validated SMTP authentication passed. The owner approved one fixed **Git Tutor Mailjet setup test** message, Mailjet accepted it, and the owner confirmed receipt in **Spam**. SMTP `sent` and recipient-confirmed Spam are recorded separately; this is not verified Inbox delivery.

The latest owner instruction **use mailjet** supersedes the intermediate keep-Gmail choice. Clean production Supabase Auth now uses `in-v3.mailjet.com:465`, the private API/secret pair, and sender `gittutor2@gmail.com` / **Git Tutor**. Guarded settings readback and all8 clean-backend checks passed. Closed signup, Auth origins and the existing2-emails/hour limit are preserved. Gmail's encrypted credential/helper remain for rollback. The testing preview still uses fake/manual providers; no backlog or customer email was dispatched. [Original SMTP evidence](evidence/mailjet-smtp-20261115.md).

On16November, the explicitly authorized owner-only Supabase invitation and recovery tests both arrived in **Spam** and Mailjet shows both **Delivered**. Expected test content was inspected. Temporary code-only templates avoided the clean project's unconfigured production redirect; normal templates were then restored. No browser invitation acceptance or password reset was completed. The retained owner Auth identity is unconfirmed and has no staff role. [Auth delivery evidence and limitations](evidence/auth-mailjet-20261116.md).

Mailjet supports individual sender verification but warns that freemail senders can reach Spam or fail delivery. An owned domain authenticated for SPF/DKIM is the preferred Mailjet route; those DNS records cannot be configured for `gmail.com`. No domain purchase is authorized or required to retain the working Gmail route. Marking one message as not spam would not prove general recipient deliverability. [Sender guidance](https://documentation.mailjet.com/hc/en-us/articles/360042759253-How-to-add-a-sender-address), [SPF guidance](https://documentation.mailjet.com/hc/en-us/articles/360042561514-Understanding-SPF-and-how-it-works).

## Prepared application configuration

`EMAIL_ADAPTER=mailjet` requires private `EMAIL_FROM`, `MAILJET_API_KEY` and `MAILJET_SECRET_KEY`. It uses the existing pinned Nodemailer dependency and fixed `in-v3.mailjet.com:465`, certificate-validated TLS, finite timeouts and disabled SMTP logging. The default remains `fake`; adding credentials alone does not activate Mailjet.

The adapter receives the existing authorized notification projection. It sends one recipient, excludes arbitrary fields/headers/attachments/CC/BCC, disables file/URL access, and forces Mailjet open/click tracking off. Its Message-ID and `X-MJ-CustomID` identify the attempt for investigation; neither is treated as a deduplication guarantee. SMTP acceptance records `sent`, never `delivered`. Explicit rejection records a safe failure code; lost acknowledgements and ambiguous results stay `unknown` with no automatic replay.

Mailjet delivery/bounce callbacks and automated provider reconciliation are **not implemented** in this SMTP adapter. Do not point Mailjet callbacks at the SES/Resend endpoints or treat unauthenticated events as evidence. An authenticated callback/reconciliation integration and live recovery checks remain future work before claiming complete operational delivery tracking.

## Remaining activation checks

If the owner selects a domain they control, verify it in Mailjet and set both the worker and Supabase Auth to the approved address on that domain. Merge Mailjet's SPF authorization into the domain's existing SPF record, publish the DKIM record shown for that domain and confirm both in Mailjet. Set up the domain's DMARC policy and reporting with its DNS owner. Inspect a controlled message's authentication results for DMARC alignment with the visible From domain, then verify inbox placement and the Auth link at the intended recipient. [Mailjet SPF and DKIM guide](https://documentation.mailjet.com/hc/en-us/articles/360049641733-Authenticating-Domains-with-SPF-and-DKIM-A-Complete-Guide), [Mailjet DMARC guide](https://documentation.mailjet.com/hc/en-us/articles/20531905163419-Understanding-DMARC).

1. Mailjet is selected and clean Auth SMTP settings are saved. Resolve or explicitly assess the Spam result before representing delivery as reliable.
2. Privately inject the Mailjet keys into the selected server/worker environment. Recheck the intended sender and account limits.
3. Owner-only Auth delivery tests are approved and complete: both received in Spam. Eventual worker-host tests need their own concrete recipient/content scope; preserve unknown outcomes without resending.
4. Verify Auth invitations/recovery independently; the application test and settings readback do not prove Auth delivery. The owner explicitly approved these owner-only tests on16November. Account-wide open/click tracking were inspected, disabled, saved and verified after reload at23:11:54UTC on15November (16November Cairo); allow the documented10minutes for propagation. Supabase does not use this application's per-message tracking-off headers. [Mailjet tracking settings](https://documentation.mailjet.com/hc/en-us/articles/51109335532571-Email-Tracking-Pixels-and-Consent-CNIL-and-Garante-Guidance).
5. Activate against an intentionally reviewed queue and recipient set, never the historical/practice preview backlog.

Official implementation references checked15November2026: [SMTP configuration](https://dev.mailjet.com/docs/smtp-relay/configuration), [tracking headers](https://dev.mailjet.com/docs/smtp-relay/custom-headers), [sender verification](https://dev.mailjet.com/docs/email-api/senders-domains/create-sender). Context7 lookup failed with a transport error; official vendor documentation was used instead.
