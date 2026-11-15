# Production inputs still needed

Updated15November2026. The owner requested free services only. No paid purchase, upgrade or subscription change is authorized. The existing hosted pilot can be tested, but it is not a live commercial release. See [implementation status](IMPLEMENTATION-STATUS.md) for executed checks.

Latest choices: keep the current testing preview; defer the Oracle proposal. The owner confirmed `gittutor2@gmail.com` as the account with longer Meet calls. Its App Password is stored encrypted; Gmail SMTP authentication and one explicitly approved, Inbox-confirmed owner message passed. Clean production Auth SMTP settings are saved; actual Auth delivery remains unverified. No Oracle account/access or alternative meeting-provider decision is requested now.

Mailjet follow-up: the account is activated, its supplied API/secret pair is encrypted locally, and sender verification/SMTP authentication passed. The approved owner-only test arrived in **Spam**. The owner explicitly chose to **keep Gmail for now and retain Mailjet ready**. No additional Mailjet key is needed; later activation needs an approved sender/deliverability decision and separate Auth checks. [Mailjet setup and evidence](MAILJET-SETUP.md).

## Already prepared

- Vercel and Supabase account access works through the selected private CLI profiles; no further login code is needed.
- Separate clean Supabase production project, migrations, encrypted database connections, restricted worker identity, private Storage and server encryption material are prepared. Values remain in ignored private configuration and must enter the final host's secret manager during activation.
- Owner/test recipient address is confirmed. One explicitly approved setup email was received in Inbox; no owner invitation has been sent.
- Gmail is the selected domain-free route. Its credential is saved encrypted, SMTP authentication passed, and clean production Auth SMTP settings are saved/read back. See [Gmail setup](GMAIL-SETUP.md) and [executed evidence](evidence/gmail-smtp-20261115.md).
- A Resend send-only API key is stored privately. It is the appropriate application permission. A failed domain-list request with `restricted_api_key` does not mean the key is invalid. The implemented adapter requires signed webhook subscriptions for `email.sent`, `email.delivered`, `email.failed`, `email.bounced` and `email.suppressed`; provider activation remains off.

## Owner inputs and external decisions

| Area | What is needed | Why |
|---|---|---|
| Selected Gmail email | No further Gmail credential is needed now. The eventual host must receive the private runtime secret, and Supabase Auth invitation/recovery flows need their own controlled test after host/origin selection | [Gmail setup](GMAIL-SETUP.md). Credential storage, local SMTP authentication and the approved owner message passed. Auth settings readback does not prove Auth-originated delivery. |
| Calendar/Meet | For confirmed organizer `gittutor2@gmail.com`: Google Cloud OAuth **web application** client ID/secret, organizer calendar ID and interactive consent | [Exact setup](GOOGLE-CALENDAR-SETUP.md). The reported entitlement must still be checked with actual90–105minute group/admission tests. Client secrets stay server-only. |
| WhatsApp automation | Meta Business/WhatsApp account, registered phone-number ID, permitted system-user token and app signing secret; approved message templates where required | The public WhatsApp/phone links already use the supplied number. Automated API messaging is a separate integration and cannot be represented as free without confirming its permitted usage and charging. |
| Continuous commercial hosting and malware scanning | No new hosting credential is needed for the selected current testing preview. Revisit a permitted continuous commercial host/private scanner before live launch | The owner deferred the [free-host proposal](FREE-SERVICE-PLAN.md). Existing Vercel/Supabase access works; no upgrade or Oracle resource is approved. Keeping the pilot does not close commercial/scanner readiness. |
| Business activation | Approved exact session terms, tutor agreements, collection account evidence, identity/guardian review, opening balances and retention choices | The owner has confirmed customer rates and90–105 minute duration. That does not establish deposits, cancellations, historical settlement, tutor compensation or guardian authority. Existing history remains reported until independently reviewed. |
| Controlled live checks | The single owner-only setup email is approved and complete. Separate approval is needed for a concrete Auth invitation or Calendar invitations once their origin/recipients/content are prepared | The existing approval covers one completed test only. Provider-side Auth delivery, calendar admission and other live capabilities remain separate checks. |
| Recovery operations | Approved off-device backup destination, retention, recovery-point/time targets and responsible owner | A local restore rehearsal does not establish replacement-host recovery or a maintained backup schedule. |

Resend remains an implemented optional alternative; it is not required for the selected Gmail route. Its previously supplied sending key stays private/inactive. No additional Resend key, domain or AWS account is needed for Gmail.

Engineering still required includes provider activation checks, clean cutover, replacement-host recovery and remaining literal acceptance variants. These are not all credential requests, and a green unit/CI run does not substitute for them. The current production configuration also requires live WhatsApp; a manual-only release needs explicit engineering and scope approval.

The15November bounded review identified specific remaining financial/recovery assertions for GT-1403, GT-1405, GT-1317, GT-1510 and GT-806; see [implementation status](IMPLEMENTATION-STATUS.md). They require isolated executed checks, not additional owner credentials, and have not been declared passed or failed by review alone.

## Official service constraints checked

- [Resend test-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) and [domain verification](https://resend.com/docs/dashboard/domains/introduction).
- [Google App Password requirements](https://support.google.com/accounts/answer/185833) and [Gmail sending limits](https://support.google.com/mail/answer/22839).
- [Vercel terms](https://vercel.com/legal/terms) and [daemon limits](https://vercel.com/docs/daemons/limits).
- [Supabase free-plan limits](https://supabase.com/pricing) and [ClamAV Docker memory guidance](https://docs.clamav.net/manual/Installing/Docker.html).
