# T11 support and WhatsApp evidence

Verified locally on 13 November 2026 against actual Supabase Auth/PostgreSQL and the local application. No live WhatsApp message was sent.

## Implemented boundary

Website conversations have anonymous authenticated ownership, approved FAQ answers, sensitive-question handoff, immutable messages/private notes, concurrent claim protection, owner transfer, escalation, administrator return, resolution and reopening. Unassigned staff can preview public transcripts; only the assigned owner/admin sees private notes. Customer responses use a strict allowlist.

The original website owner can create a 15-minute, single-use linking challenge. A verified account must present that challenge and have current authority for the explicitly selected learner. The anonymous owner loses access after linking. Neither a shared number nor an account's default learner is used as identity proof. WhatsApp `link` requests return a channel challenge; the website linking form performs the same authorization. Analytics consumes explicit `support_account_links` separately.

WhatsApp uses separate fake/live adapters and channel identities. The live callback at `/api/webhooks/whatsapp` verifies the subscription token and HMAC-SHA256 over bounded raw bytes, verifies business/phone identifiers, deduplicates incoming message/status identities, and preserves callback observations. Website messages cannot reset the WhatsApp window. Unsupported attachments and sensitive requests reach a person. `STOP` withdraws permission; explicit `START`/`YES`/`SUBSCRIBE` records opt-in. An initial inbound message permits service replies in its window but does not grant outside-window template permission.

Free text requires a last verified WhatsApp user message within 24 hours. Templates require explicit opt-in, approved parameters and the correct provider mode. Approval withdrawal is append-only and checked again at dispatch. Current ownership generation, role, consent, window and configured phone are checked immediately before sending. Staff see queued/sent/read/failed/unknown/suppressed outcomes and recovery controls; customers do not receive private job metadata.

Versioned administrator settings configure weekly support intervals and a staffed-hours response target. Cairo opening boundaries, including summer/winter offsets, are calculated in PostgreSQL. Unconfigured hours remain explicit. The UI separates actual elapsed waiting time from staffed-hours targets; changing the schedule does not rewrite conversations.

## Dispatch/recovery decision

The business message and outbox commit occurs before external delivery. The worker holds only conversation/channel/template row locks across one provider call, bounded to 10 seconds. This serializes transfer, opt-out and template revocation with the final check/send operation. It does not hold a financial transaction. Committing the final check before the network call would leave an ownership/permission race.

The logical message UUID is the provider callback correlation. Generic failures persist `unknown`; an expired worker lease or a crash after provider acceptance is reconciled before any retry. A live adapter cannot prove absence by lookup, so it retains uncertainty until signed callback evidence arrives. Fake-provider recovery uses durable local artifacts and proves exactly one send. Failed sends retain the support case and allow a deliberately new reply after reviewing current restrictions. The worker purpose is `support.whatsapp_send`, event `support_whatsapp_dispatch`, aggregate/message ID and payload `{message_id}`. Worker-only functions are `record_whatsapp_event(text,text,jsonb)`, `prepare_whatsapp_send(uuid,uuid,uuid,text,text)` and `finalize_whatsapp_send(uuid,uuid,uuid,jsonb)`.

## Executed checks

- `pnpm exec vitest run tests/integration/support-whatsapp.test.ts tests/integration/support.test.ts tests/unit/support-contracts.test.ts tests/unit/whatsapp-provider.test.ts`: **10/10 passed**, including 5 actual database tests and 5 contract/provider tests. Log: `.local/t11-complete-focused.log`.
- `pnpm exec playwright test tests/e2e/support.spec.ts tests/e2e/support-ui.spec.ts tests/e2e/support-linking.spec.ts`: the first run passed the original desktop/mobile website tests (4/4), while the new linking test exposed an ambiguous accessible select name and a test selector matching a hidden option. These were corrected without changing authorization. Sequential browser cleanup prevents masking the original error.
- `pnpm exec playwright test tests/e2e/support-linking.spec.ts`: **2/2 passed**, desktop and mobile; log `.local/t11-link-browser.log`. It executes real challenge linking, staff escalation, administrator return, transfer and private-note isolation. Along with the unchanged original 4 checks, all 6 support browser cases have passing evidence. Root's combined release run repeats them together.
- Scoped ESLint and full typecheck passed after the final linking/staffed-hours changes (`.local/t11-eslint-final.log`, `.local/t11-typecheck-final.log`). Combined release validation is owned by T13.
- Screenshots `.local/screenshots/t11-support-conversation-{desktop,mobile}.png` and `t11-linked-conversation-{desktop,mobile}.png`; the mobile linked conversation was visually inspected with no horizontal overflow or private-note leakage.

Applied additions are `20261113173000_support_whatsapp.sql`, `173100_support_channel_qualification.sql`, `180000_support_hours_and_recovery.sql`, `180100_support_cairo_clock.sql`, and `180200_support_template_lock_permission.sql`. Earlier applied migrations were preserved. Rollback validation and focused tests caught SQL identifier/row-lock permission issues; additive corrections retain the full history. The one-column template UPDATE grant enables row locking only: the immutable-row trigger continues to reject actual updates.

## Acceptance mapping

| Case | Actual test file/name and assertions |
|---|---|
| GT-1101 | `tests/integration/support.test.ts` — anonymous website FAQ/handoff test; sensitive unresolved inquiry becomes one durable waiting conversation with transcript. `tests/e2e/support.spec.ts` exercises the real human-handoff journey. |
| GT-1102 | `support.test.ts` races genuine authenticated claim commands through independent database connections and verifies no bot answer during handoff. `support-whatsapp.test.ts` suppresses a queued bot message after ownership changes. |
| GT-1103 | `support-whatsapp.test.ts` — WhatsApp boundary test rejects free text at hour 25, validates template parameters and requires opt-in. `tests/unit/whatsapp-provider.test.ts` independently tests the live request/correlation and ambiguous transport behavior. Controlled live policy verification remains external. |
| GT-1104 | Same WhatsApp test queues a template, records STOP, executes the worker and verifies suppression and unchanged artifact count. It separately revokes template approval before dispatch. Controlled live opt-out remains external. |
| GT-1105 | `support-whatsapp.test.ts` — website challenge test rejects another learner/account, anonymous linking and challenge reuse; actual website messages cannot operate on a WhatsApp thread. FAQ never projects personal account facts. `support-linking.spec.ts` exercises the selected-learner authority path; account/payment/file authority is independently covered by owning identity/payment/file suites. |
| GT-1106 | `support.test.ts` — two independent real Auth/database sessions yield one successful owner and one ownership-history transition. Workload projection is verified by T12. |
| GT-1107 | `support-whatsapp.test.ts` — versioned support-hours test checks Cairo opening/end boundaries, summer/winter offsets and overlapping schedule rejection. Website browser cases display preserved waiting timestamp and explicitly unconfigured staffed hours/target. |
| GT-1108 | WhatsApp boundary test replays inbound events, rejects changed content under an existing ID, preserves read over delayed delivered/sent and failed over delayed sent. Signature unit test rejects modified raw bytes and wrong business account. Controlled live callback replay remains external. |

Extra recovery assertions simulate provider acceptance followed by rollback/process loss, expose a staff reconciliation action, reconcile without a second provider artifact, and keep failed conversations assigned. The hours test runs configuration changes inside a rollback transaction, preserving existing settings.

## Live-provider gate

The operator must supply an approved Meta business/phone account, access token, app secret, verify token, explicit supported `WHATSAPP_GRAPH_VERSION`, HTTPS callback, approved template evidence and consent process. Configure staffed hours/targets separately. Then verify signed ingress, own-account/phone rejection, one free-text response within the service window, an opted-in approved template outside it, opt-out-before-dispatch suppression, duplicate/out-of-order callbacks, and lost-acknowledgement reconciliation in the configured test account. No fixture result claims that this controlled live check has passed.

Implementation used Meta's [Business Messaging Policy](https://business.whatsapp.com/policy) (current policy observed 13 November 2026) and [official webhook signature/subscription behavior](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/). The SDK reference documents the protocol; no deprecated SDK was installed. The adapter uses direct HTTPS with explicit configured API version and disabled automatic retries.
