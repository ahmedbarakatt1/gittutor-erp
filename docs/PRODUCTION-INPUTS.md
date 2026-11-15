# Production inputs still needed

Updated15November2026. The owner requested free services only. No paid purchase, upgrade or subscription change is authorized. The existing hosted pilot can be tested, but it is not a live commercial release. See [implementation status](IMPLEMENTATION-STATUS.md) for executed checks.

## Already prepared

- Vercel and Supabase account access works through the selected private CLI profiles; no further login code is needed.
- Separate clean Supabase production project, migrations, encrypted database connections, restricted worker identity, private Storage and server encryption material are prepared. Values remain in ignored private configuration and must enter the final host's secret manager during activation.
- Owner/test recipient address has been supplied privately. No owner invitation or test email has been sent.
- A Resend send-only API key is stored privately. It is the appropriate application permission. A failed domain-list request with `restricted_api_key` does not mean the key is invalid. The implemented adapter requires signed webhook subscriptions for `email.sent`, `email.delivered`, `email.failed`, `email.bounced` and `email.suppressed`; provider activation remains off.

## Owner inputs and external decisions

| Area | What is needed | Why |
|---|---|---|
| Email with Resend | An owned domain and access to its DNS; a sender such as `hello@YOUR_DOMAIN` | Resend's test domain only sends to the account owner's email. Arbitrary customer mail requires a verified sender domain. A separate paid mailbox or email-hosting plan is unnecessary. The application key is already supplied; the webhook signing secret can be configured once the final endpoint/account is selected. |
| Email without buying a domain | Confirm Gmail SMTP as the alternative, then privately configure a Google App Password for the supplied owner Gmail account after enabling2-Step Verification | This requires a Gmail adapter and separate Auth SMTP tests; its delivery tracking differs from Resend. Never use the normal Gmail password. No App Password has been supplied or requested in public source. |
| Calendar/Meet | Google Cloud OAuth client configuration, approved organizer account/calendar ID and interactive organizer consent | Enables real scheduling and rooms; the browser consent step belongs to the organizer. Client secrets stay server-only. |
| WhatsApp automation | Meta Business/WhatsApp account, registered phone-number ID, permitted system-user token and app signing secret; approved message templates where required | The public WhatsApp/phone links already use the supplied number. Automated API messaging is a separate integration and cannot be represented as free without confirming its permitted usage and charging. |
| Continuous commercial hosting and malware scanning | A commercial-use-permitted host and enough reliable worker/scanner capacity within the owner's free-only constraint, or a revised feature/hosting decision | Vercel Hobby is personal/noncommercial and its daemon allowance is finite. ClamAV needs more memory than the current Hobby worker. No paid upgrade, unverified free-host promise or scan bypass is made. |
| Business activation | Approved exact session terms, tutor agreements, collection account evidence, identity/guardian review, opening balances and retention choices | The owner has confirmed customer rates and90–105 minute duration. That does not establish deposits, cancellations, historical settlement, tutor compensation or guardian authority. Existing history remains reported until independently reviewed. |
| Controlled live checks | Approval of concrete test recipients/content when a provider is configured | Delivery, bounce, organizer/learner admission, WhatsApp delivery and hosted recovery must execute before being recorded as passed. |

Engineering still required includes the hosted recovery rehearsal, remaining literal acceptance variants and the final provider-specific activation checks. These are not all credential requests, and a green unit/CI run does not substitute for them.

## Official service constraints checked

- [Resend test-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) and [domain verification](https://resend.com/docs/dashboard/domains/introduction).
- [Google App Password requirements](https://support.google.com/accounts/answer/185833) and [Gmail sending limits](https://support.google.com/mail/answer/22839).
- [Vercel terms](https://vercel.com/legal/terms) and [daemon limits](https://vercel.com/docs/daemons/limits).
- [Supabase free-plan limits](https://supabase.com/pricing) and [ClamAV Docker memory guidance](https://docs.clamav.net/manual/Installing/Docker.html).
