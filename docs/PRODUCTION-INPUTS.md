# Production inputs still needed

Updated15November2026. The owner requested free services only. No paid purchase, upgrade or subscription change is authorized. The existing hosted pilot can be tested, but it is not a live commercial release. See [implementation status](IMPLEMENTATION-STATUS.md) for executed checks.

Latest choices: keep the current testing preview; defer the Oracle proposal. The owner confirmed `gittutor2@gmail.com` as the account with longer Meet calls. Its App Password is stored encrypted; Gmail SMTP authentication and one explicitly approved, Inbox-confirmed owner message passed. Clean production Auth SMTP settings are saved; actual Auth delivery remains unverified. No Oracle account/access or alternative meeting-provider decision is requested now.

Latest email instruction: **use mailjet**, superseding the intermediate keep-Gmail choice. Account/sender activation and SMTP authentication passed; keys are encrypted locally. The approved owner test reached **Spam**. Clean production Auth SMTP is now saved/read back for Mailjet with signup restrictions, limits and origins preserved. No further email credential is needed. Account-level tracking-off, controlled Auth delivery and final worker-host/recipient checks remain; the preview stays fake/manual. [Mailjet setup and evidence](MAILJET-SETUP.md).

## Already prepared

- Vercel and Supabase account access works through the selected private CLI profiles; no further login code is needed.
- Separate clean Supabase production project, migrations, encrypted database connections, restricted worker identity, private Storage and server encryption material are prepared. Values remain in ignored private configuration and must enter the final host's secret manager during activation.
- Owner/test recipient address is confirmed. One explicitly approved setup email was received in Inbox; no owner invitation has been sent.
- Mailjet is selected and its clean production Auth SMTP settings are saved/read back. Gmail's encrypted credential/helper remain for rollback; its previous owner test reached Inbox. See [Mailjet setup](MAILJET-SETUP.md) and [Gmail evidence](evidence/gmail-smtp-20261115.md).
- A Resend send-only API key is stored privately. It is the appropriate application permission. A failed domain-list request with `restricted_api_key` does not mean the key is invalid. The implemented adapter requires signed webhook subscriptions for `email.sent`, `email.delivered`, `email.failed`, `email.bounced` and `email.suppressed`; provider activation remains off.

## Owner inputs and external decisions

| Area | What is needed | Why |
|---|---|---|
| Selected Mailjet email | No further email credential is needed. Inspect/disable account-level tracking, assess the Spam result and approve a concrete Auth test after host/origin selection. Eventual worker activation needs a reviewed queue/recipient set | [Mailjet setup](MAILJET-SETUP.md). Sender/SMTP authentication passed and Auth settings were saved. The one application test reached Spam; actual Auth delivery is unverified. |
| Calendar/Meet | For confirmed organizer `gittutor2@gmail.com`: Google Cloud OAuth **web application** client ID/secret, organizer calendar ID and interactive consent | [Exact setup](GOOGLE-CALENDAR-SETUP.md). The reported entitlement must still be checked with actual90–105minute group/admission tests. Client secrets stay server-only. |
| WhatsApp automation | Meta Business/WhatsApp account, registered phone-number ID, permitted system-user token and app signing secret; approved message templates where required | The public WhatsApp/phone links already use the supplied number. Automated API messaging is a separate integration and cannot be represented as free without confirming its permitted usage and charging. |
| Continuous commercial hosting and malware scanning | No new hosting credential is needed for the selected current testing preview. Revisit a permitted continuous commercial host/private scanner before live launch | The owner deferred the [free-host proposal](FREE-SERVICE-PLAN.md). Existing Vercel/Supabase access works; no upgrade or Oracle resource is approved. Keeping the pilot does not close commercial/scanner readiness. |
| Business activation | Approved exact session terms, tutor agreements, collection account evidence, identity/guardian review, opening balances and retention choices | The owner has confirmed customer rates and90–105 minute duration. That does not establish deposits, cancellations, historical settlement, tutor compensation or guardian authority. Existing history remains reported until independently reviewed. |
| Controlled live checks | The single owner-only setup email is approved and complete. Separate approval is needed for a concrete Auth invitation or Calendar invitations once their origin/recipients/content are prepared | The existing approval covers one completed test only. Provider-side Auth delivery, calendar admission and other live capabilities remain separate checks. |
| Recovery operations | Approved off-device backup destination, retention, recovery-point/time targets and responsible owner | A local restore rehearsal does not establish replacement-host recovery or a maintained backup schedule. |

Resend and Gmail remain implemented alternatives with private saved credentials. No additional Resend key, AWS account or email password is requested. Mailjet allows the verified Gmail sender but the observed Spam result remains a delivery limitation; no domain purchase is authorized.

Engineering still required includes provider activation checks, clean cutover, replacement-host recovery and remaining literal acceptance variants. These are not all credential requests, and a green unit/CI run does not substitute for them. The current production configuration also requires live WhatsApp; a manual-only release needs explicit engineering and scope approval.

The15November bounded review identified specific remaining financial/recovery assertions for GT-1403, GT-1405, GT-1317, GT-1510 and GT-806; see [implementation status](IMPLEMENTATION-STATUS.md). They require isolated executed checks, not additional owner credentials, and have not been declared passed or failed by review alone.

## Official service constraints checked

- [Resend test-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) and [domain verification](https://resend.com/docs/dashboard/domains/introduction).
- [Google App Password requirements](https://support.google.com/accounts/answer/185833) and [Gmail sending limits](https://support.google.com/mail/answer/22839).
- [Vercel terms](https://vercel.com/legal/terms) and [daemon limits](https://vercel.com/docs/daemons/limits).
- [Supabase free-plan limits](https://supabase.com/pricing) and [ClamAV Docker memory guidance](https://docs.clamav.net/manual/Installing/Docker.html).
