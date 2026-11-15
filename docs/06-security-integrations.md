# Security and integrations

## Database authority

Implements R02, R06–R09, R11–R18. The application uses the database boundaries in [03-architecture.md](03-architecture.md). All business authorization checks run again inside the atomic command, including current account state, staff membership, tutor assignment, guardian scope, accepted version and resource state.

| Surface | Mandatory implementation contract |
|---|---|
| Public reads | Grant `anon` and `authenticated` execution on `api.list_public_offers` and `api.get_public_tutor`, both sanitized |
| Other API functions | Revoke `EXECUTE` from `PUBLIC` and `anon`, grant only named functions to `authenticated` |
| Base tables | Unexposed `app_private` and `finance_private`, zero browser grants, explicit RLS |
| Sensitive RPC ownership | Dedicated `NOLOGIN`, `NOBYPASSRLS` owner with grants for its command family, separate table ownership |
| `SECURITY DEFINER` | Use only for the narrow privileged boundary, `search_path = ''`, fully qualified names, typed inputs, internal authorization and allowlisted output |
| Worker operations | Private functions granted only to a dedicated worker login, excluded from exposed schemas |
| Defaults | Revoke automatic table/sequence privileges and global default function execution for every migration-owner role |
| Views | Explicit projections and `security_invoker` when relying on caller RLS, privileged views remain private |

The exposed definer RPC is a deliberate boundary allowing authorized commands while raw tables remain inaccessible. Audit every function grant, overload and owner. Maintain RLS predicates matching the command actor's current scope. Avoid dynamic SQL over user-supplied identifiers. Test direct Data API calls as anon, anonymous Auth, learner, former guardian, tutor, CS and demoted admin. Function execution privileges require independent review because RLS governs table access. [Supabase database functions](https://supabase.com/docs/guides/database/functions) · [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)

Server identity verification uses signed claims. Authorization reads current database roles and relationships. User-editable metadata is unsuitable for role decisions. A private session-check helper validates `auth.uid()` and the signed `session_id` against `auth.sessions`, plus current application account status, for sensitive commands and file access. App logout revokes the corresponding session before returning success. Reuse of the old token then fails the next protected operation. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)

Static FAQs remain publicly readable. Website chat can create a Supabase anonymous Auth session. Anonymous users receive only own-conversation commands. All other account and business commands explicitly require a verified non-anonymous account. Upgrading identity or linking a WhatsApp thread requires a verified account and a single-use, expiring thread challenge. Shared phone numbers never authorize a learner relationship.

## Private files and exports

Store receipts, statements, preparation, shared handouts and export objects in private buckets. Use opaque generated keys and immutable object versions. A file row binds the uploader, learner, parent record, purpose, checksum and access scope. Create metadata, stream bounded bytes through the authorized server, verify actual size/type/checksum, then queue a scan. Expose content only after a clean scan and current authorization.

Receipt limits are 5 MiB for PDF, PNG, JPEG or WebP. Teaching files allow 25 MiB for PDF, PPTX, PNG, JPEG or WebP. Validate magic bytes and archive safety for PPTX, quarantine failures, and avoid rendering active uploaded content on the application origin. A scanner outage preserves quarantine. Retry interrupted uploads against their file identity and checksum.

Authorized statement imports accept CSV or PDF up to 25 MiB. Bound CSV rows, columns and cell size before parsing, preserve source hashes and reject malformed records into an owned review result.

Download routes recheck session, role, assignment, guardian consent and current enrollment scope before streaming. Portal links contain application record IDs. Shared handouts are visible to eligible confirmed learners, while private submissions stay with their learner, authorized guardian and assigned tutor. Receipt visibility is payer, case reviewer and authorized admin. Export generation materializes an authorized snapshot, records its grain/filters/count, and reauthorizes the requester at download. Escape CSV formula prefixes and expire objects under the approved retention schedule.

## Provider adapters and configuration

Define typed server-only adapters for calendar, transactional email, WhatsApp, scanning and statement reconciliation. Fake adapters deterministically emit success, pending, timeout-after-success, duplicate callback, out-of-order callback and permanent-failure scenarios. They accept synthetic identities and store local preview artifacts. Each live adapter requires its own staging verification and explicit deployment setting. External credentials never enter public DTOs, browser bundles, fixtures or logs.

| Configuration | Purpose and allowed deployment |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public client identity configuration |
| `APP_BASE_URL` | Approved absolute origin for secure portal links |
| `WORKER_DATABASE_URL` | Restricted worker login, server only |
| `SUPABASE_SECRET_KEY` | Server-only Storage wrapper and controlled administrative Auth operations |
| `SECRET_ENCRYPTION_KEY` | Encrypt provider connections and private payout identifiers, versioned rotation |
| `EMAIL_ADAPTER` | `fake`, `ses`, `resend` or `gmail`; fake is isolated-development/test only |
| `CALENDAR_ADAPTER` | `fake` or `google` |
| `WHATSAPP_ADAPTER` | `fake` or `cloud` |
| `FILE_SCAN_ADAPTER`, `FILE_SCAN_URL` | `fake` or `clamav`, approved scanner endpoint |
| `PAYMENT_RECONCILIATION_ADAPTER` | `manual` |
| `AWS_REGION`, `EMAIL_FROM`, `EMAIL_SNS_TOPIC_ARN` | Live SES sender and allowed signed notification topic |
| `EMAIL_FROM`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Verified Resend sender, sending-only key and signed delivery callbacks |
| `GMAIL_SMTP_USER`, `GMAIL_APP_PASSWORD` | Owner-selected consumer Gmail sender and private App Password; see [Gmail setup](GMAIL-SETUP.md) |
| `EMAIL_FROM`, `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` | Selected Mailjet sender and private API/secret pair; [Mailjet setup](MAILJET-SETUP.md) records Auth settings and remaining delivery gates |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Optional server credential chain inputs when workload identity is unavailable |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_CALENDAR_ID` | Approved organizer OAuth configuration |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Live business account, send credentials and webhook verification |

Persist refresh tokens encrypted in `provider_connections`. Verify required settings at process startup. A public/publishable Supabase key is the browser credential. Privileged keys stay server-side and user financial commands always carry the user's JWT. [Supabase SSR client configuration](https://supabase.com/docs/guides/auth/server-side/creating-a-client)

## Calendar and payments

An administrator connects the approved Google organizer through OAuth state/PKCE validation and offline authorization. Request `openid`, `email` and `https://www.googleapis.com/auth/calendar.events` for the configured calendar. Store organizer identity and consent evidence. The staging pilot verifies write access, license capabilities, tutor hosting and external learner admission.

Use one event per occurrence, a deterministic application event ID and a stored conference request ID. Request conference data and retain `pending`, `ready` or `failed` until reconciled. Retry event insertion using the same event identity. Rescheduling updates the existing event and invalidates reminders for the earlier occurrence version. Reconcile before recreating anything after a timeout. [Google Calendar event creation](https://developers.google.com/workspace/calendar/api/guides/create-events)

For group privacy, invite organizer and tutor on the shared calendar event and send each learner their own authorized portal notice. Adding learner attendees requires a separately tested configuration that suppresses peer guest visibility. A copied Meet URL remains a provider-controlled capability. Validate restricted admission and host controls against removed members and external accounts. Record a replacement link decision when access risk requires a new room. App consent revocation immediately blocks future portal retrieval and queued delivery.

InstaPay and Vodafone Cash use manually verified receiving-account statements in the initial adapter. Preserve source files, receiving account, channel, external reference, currency, amount and settlement evidence. Reconciliation ingests candidates, then an authorized reviewer verifies settlement. Outgoing tutor payments and refunds are recorded and reconciled against independently evidenced transfers. A timeout or uncertain manual result remains `unknown` with its reservation until evidence resolves it.

## Email event and recipient matrix

`L` means the affected learner. `G` means a currently authorized guardian with notification scope for that learner. `P` means the authorized payer. `T` means the currently assigned tutor. `CS` and `A` mean verified staff recipients assigned to the relevant queue or decision. Resolve each identity and verified destination at dispatch. Combine duplicate destinations only when their authorized content is identical.

| Committed event | Recipients | Content and secure action |
|---|---|---|
| Auth verification, password recovery and staff invitation | Intended account destination | Auth-managed, expiring single-use action with redirect allowlist |
| `guardian_link_accepted`, `guardian_link_revoked` | Learner, affected guardian | Own relationship change and current account permissions |
| `tutor_application_reviewed`, `tutor_profile_approved` | Applicant or affected T | Review outcome and authorized next action |
| `tutor_fee_agreement_approved` | Affected T | Own exact agreement and occurrence link |
| `package_activated`, `package_renewed` | L/G/P | Own funded purchase, usable entitlement and terms |
| `package_transferred`, `package_restored`, `package_expiring` | L/G/P | Own quantity/value change, expiry and linked history |
| `enrollment_held` | L/G | Own quote, expiry and booking link |
| `hold_expiring`, `hold_expired` | L/G, assigned CS | Own next action and reservation status |
| `group_amendment_proposed` | Each affected L/G, T | Each party's own terms and acceptance link |
| `group_amendment_committed` | Each affected L/G, T, assigned CS | Own accepted changes |
| `occurrence_confirmed` | Each L/G, T | Time, preparation and meeting status |
| `occurrence_rescheduled` | Each L/G, T, assigned CS | Current time/version, replace stale reminder |
| `occurrence_cancelled` | Each L/G, T, assigned CS | Own remedy status and next action |
| `session_reminder` | Each L/G, T | Current scheduled time and authorized portal link |
| `receipt_submitted` | P, assigned CS queue | Acknowledgment or review action |
| `receipt_needs_information`, `receipt_rejected` | P/L/G | Own reason and replacement link |
| `payment_allocated` | P/L/G | Own allocation/balance, booking status |
| `transfer_exception`, `transfer_reversed` | A, assigned CS, affected P | Scoped exception and recovery action |
| `refund_approved`, `refund_settled`, `refund_failed` | P, assigned A | Own amount and resolution status |
| `preparation_ready` | T | Authorized private material link |
| `handout_ready` | Each eligible L/G | Shared material portal link |
| `tutor_assignment_changed` | Current T, affected L/G, assigned CS | Current assignment and preparation |
| `completion_approved`, `attendance_corrected` | Affected L/G, T | Own attendance/learning record |
| `completion_submitted` | Assigned A or authorized operations reviewer | Review task and delivery exception status |
| `tutor_earning_posted` | Affected T | Own new earning and current statement link |
| `tutor_earning_adjusted` | Affected T, A | Own statement and reason |
| `payout_destination_submitted`, `payout_destination_verified` | A, affected T | Review status and masked identifier |
| `payout_settled`, `payout_unknown`, `payout_failed` | Affected T, assigned A | Own statement and reconciliation state |
| `support_assigned`, `support_returned` | Assigned CS, affected account | Scoped handoff and conversation link |
| `export_ready`, `critical_delivery_failed` | Authorized requester or assigned owner | Protected export or retry task |

Use an outbox uniqueness key containing event, recipient account, channel and template version. Store queued/sent/delivered/bounced/suppressed/failed observations separately from attempts. Verify signed SNS callbacks and the permitted topic, deduplicate provider IDs and preserve monotonic delivery outcomes. A hard bounce creates a contact-verification task. An uncertain send is reconciled before resend.

The owner selected domain-free Gmail on15November2026. Gmail SMTP acceptance establishes sent only. It provides neither a provider idempotency key nor the signed delivery/bounce callback implemented for SES/Resend. A stable Message-ID supports investigation without guaranteeing deduplication. Timeout/ambiguous outcomes remain unknown and cannot be automatically resent. Live readiness requires separate SMTP, received-content and Auth SMTP checks plus an evidenced procedure for unresolved outcomes; selecting Gmail does not waive these controls. Resend's signed terminal outcomes likewise cannot be overwritten by a later HTTP acceptance.

The selected Mailjet SMTP adapter follows the same sent/unknown boundary and content allowlist, with open/click tracking forced off. Its CustomID/Message-ID are investigation references, not deduplication guarantees. Authenticated Mailjet callbacks/automated reconciliation are not implemented. The owner-approved test reached Spam; the latest instruction selected Mailjet and clean Auth configuration is saved while the preview stays fake/manual. Supabase Auth needs separate account-level tracking inspection before token-bearing mail. No unverified Mailjet webhook is accepted as delivery evidence.

Supabase Auth owns its verification, recovery and invitation token lifecycle. Configure its approved SMTP sender and templates and test those deliveries separately from application-outbox email. The application sends each business event through the outbox once its transaction commits. Package-funded delivery and routine completion use the corresponding own-customer and own-tutor projections.

Dispatch rechecks guardian scope, staff membership, assignment, verified address, preference and current business version. Automatic operational notices use current event entitlement independently of an interactive login. User-requested privileged export jobs also revalidate the requester's authority and session. Separate marketing consent from operational notices. Bodies omit attachments, raw payout destinations, other learners' details and internal notes. English/Arabic templates use approved terminology and Cairo time.

## WhatsApp and human ownership

Verify webhook subscription challenges with the verify token and message callbacks using `X-Hub-Signature-256`, HMAC-SHA256 over raw request bytes and constant-time comparison. Deduplicate message/status IDs before changing a thread. Store separate channel identities and `last_whatsapp_user_message_at`. Only authenticated incoming WhatsApp messages reset that channel's 24-hour customer-service window.

Before every send, check current opt-in/opt-out, destination, owner and window. Outside the window, require an eligible approved template and validated parameters. A free-text request returns `WINDOW_CLOSED` or `TEMPLATE_REQUIRED`. FAQ automation uses approved answers and escalates disputed payments, personal records or unresolved intent. Human handoff atomically claims one owner, pauses bot dispatch and retains transcript/reason. A stale queued bot response checks the current ownership version before sending. [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)

Show staffed hours, elapsed wait and staffed-hours target separately. Thread transfers preserve ownership history and private notes. Account linking uses a single-use challenge and verified learner authority before exposing personal data. Channel delivery success never establishes payment settlement or attendance.

## Recovery and security evidence

Log request ID, command ID, actor ID, aggregate/version, event ID, provider reference, attempt and safe error code. Redact contacts, tokens, receipt content and message bodies from ordinary telemetry. Alert named owners on aged jobs, provisioning failures, unmatched transfers, unknown disbursements, overdue cases and reconciliation variance.

Approve recovery targets, retention and owners before deployment. Back up PostgreSQL and private objects with a linked manifest and checksums. Restore into an isolated environment, replay later committed work, and reconcile capacity, customer funds, package quanta/value, tutor liabilities and delivery deduplication. Test current permission enforcement after logout, staff demotion, guardian revocation and tutor reassignment. Retain execution evidence for the current acceptance suite. The earlier 84-case workbook remains a planned register until its cases are run.
