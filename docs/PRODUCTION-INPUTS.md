# Production inputs and activation

Updated 23 November 2026. The owner selected Vercel, Supabase Free, Mailjet, the existing Google organizer and manual WhatsApp replies. The hosted pilot remains the place to test with existing practice accounts. The separate Vercel project is `gittutor-erp-production`. Vercel team authentication protects every URL on that project. Public signup is disabled on its separate Supabase project. [Testing preview](ONLINE-PREVIEW.md) · [Release record](IMPLEMENTATION-STATUS.md).

The production owner has Administrator as the only active role. The first designated QA tutor has a verified login and one approved Software Engineering profile. The production Calendar callback and guest-free Google Meet verification passed. The protected site contains the authorized workbook and a submitted synthetic slide request. Paid bookings still lack a published commercial policy and an enabled receiving account. [Latest executed checks](IMPLEMENTATION-STATUS.md).

| Area | Prepared | Next action and owner |
| --- | --- | --- |
| Hosting and private uploads | Supabase Cron woke the Vercel worker. It scanned a private administration PDF with ClamAV 1.5.4 and rendered a synthetic learner's export. The learner downloaded the exact three requested customer columns. | Monitor retries, signature updates and free usage. Preserve quarantine on scan failure. [Hosting and operator instructions](FREE-SERVICE-PLAN.md) |
| Request slides in Google Drive | The owner connected Drive. Live Google rendering, viewer removal and owner-only access were verified using a separate synthetic PDF and both designated accounts. | Finish a confirmed request booking and reassignment using approved production terms. This proves that booking state drives the same real Google permission changes. [Request workflow](REQUEST-FLOW.md) |
| Owner access and email | Mailjet sent the test tutor invitation. The recipient activated. An owner sign-in email was opened successfully in Gmail and the admin role checked on production. | Verify inbox placement across customer destinations. Rotate the previously shared credentials in both the provider and the deployment secret stores. [Mail history](evidence/auth-mailjet-20261116.md) |
| Calendar and Meet | Production has one verified organizer. The existing Google Cloud web client includes the production Calendar callback. Git Tutor created and removed a guest-free Meet event during verification. | A second organizer and an actual overlapping-session rehearsal are needed for parallel lessons. Verify token renewal and a 90–105 minute group call. The OAuth project is still in Testing. [Organizer setup](GOOGLE-CALENDAR-SETUP.md) |
| WhatsApp and phone | Students and families use the existing contact number, +20 15 08823452. Staff reply in WhatsApp. Production selects `WHATSAPP_ADAPTER=manual`. | Staff cover the existing inbox. This workflow requires no Meta account, template, token or webhook. |
| Commercial terms and collections | Individual tuition is EGP 650. Group tuition is EGP 575, 550 or 500 per learner for groups of two, three or four. Sessions last 90–105 minutes. The production database contains its own authorized workbook revision. Its historical labels require review before financial activation. | The owner signs off cancellation, deposits/refunds, collection accounts, tutor agreements, guardian authority, reviewed opening balances and retention before accepting real customers or money. |
| Recovery | A hosted-source restore to a local target and a synthetic unknown-payout restore have been exercised. | The owner names a backup destination and recovery contact, plus acceptable data loss and downtime. Engineering rehearses a restore to a replacement host and verifies private files as well as balances. |

All working credentials belong in the deployment secret manager or the operator's private store. The repository contains example variable names and synthetic test inputs. The production origin and Auth callback are set. The release record tracks worker checks, financial activation and restoration to a replacement host separately.

## What would make the first paid booking possible?

The known tuition and session length are already recorded. The group pricing draft uses 90 minutes within the approved 90–105 minute range. The remaining decisions belong to the business.

| Where | What the owner or finance administrator supplies |
| --- | --- |
| Administration → Catalog & policies → Commercial terms | The deposit percentage, rounding, seat-hold time and payment deadline. Specify cancellation windows, refund percentages, available remedies, no-shows and partial lessons. For groups, specify the minimum class size and what happens if a group fails to form or someone drops out. |
| Private instructor agreements | Confirm the tutor's agreed terms for the first subject and session type. Keep the agreement in the privileged workflow. |
| Administration → Payments | Enter a receiving destination that the business actually controls and verify its ownership using the private evidence workflow. Keep banking details out of email, chat and the repository. |
| Administration → Sessions and availability | Publish an offer under the approved policy, schedule it with an eligible instructor, then match the original request. The family accepts the quote. Finance confirms actual settlement under those terms. |

For the reassignment rehearsal, the replacement must have an approved, same-subject tutor profile. The requested replacement address belongs to the Drive owner, whose Git Tutor account has only the Administrator role. A separate registered tutor can prove that the replacement gains Viewer access. The Drive owner always retains access to its file.

## Official service constraints checked

- [Resend test-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) and [domain verification](https://resend.com/docs/dashboard/domains/introduction).
- [Google App Password requirements](https://support.google.com/accounts/answer/185833) and [Gmail sending limits](https://support.google.com/mail/answer/22839).
- [Vercel terms](https://vercel.com/legal/terms) and [daemon limits](https://vercel.com/docs/daemons/limits).
- [Supabase free-plan limits](https://supabase.com/pricing) and [ClamAV Docker memory guidance](https://docs.clamav.net/manual/Installing/Docker.html).
