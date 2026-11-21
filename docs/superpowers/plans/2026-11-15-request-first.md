# Request-first customer journey

Owner correction, 15 November 2026: customers submit a tutoring request and lecture material before staff arrange a session. Subjects are examples, not an eligibility restriction. Replace the public offer catalogue with tuition: individual EGP650; groups of2/3/4 EGP575/550/500 per student. The owner specified sessions of1:30–1:45, interpreted as90–105 minutes. Exact confirmed start/end and approved terms remain required for booking. Tutor compensation stays private.

## Tasks

1. Add private persisted request drafts, submission, staff review/reply and optional link to a scheduled occurrence. Reuse current authenticated learner/guardian scopes, idempotency/version checks, private immutable uploads, scan gates and audited commands. Free-text topic and course; no published course prerequisite. No payment, enrollment or tutor earning is created by a request.
2. Replace public offers with the supplied price comparison; keep internal scheduling/approved quote contracts. Route subjects and primary calls to action to the request form. Preserve the Instagram logo and existing red/cream typography. Add customer request history and staff/admin review queues. Link a matched request into the existing quote/booking flow.
3. Execute focused database/privacy/concurrency and transport tests, existing affected regressions, static/unit/build checks and an actual desktop/mobile request/upload/review walkthrough. Use Playwright Agent CLI for screenshots and console/network inspection. Record only checks actually executed; do one batched UI review and at most one confirmation round.
4. Apply additive migrations to the authorized hosted pilot after local verification, deploy the updated pilot, and verify the public flow. Keep the clean production target closed until its separate activation gates pass. Update implementation status and scoped commits.
5. Independently finish the selected Resend adapter and authenticated callbacks using the existing notification contract. Keep fake/SES supported, unknown sends unreplayed, and secrets server-only. No actual email, domain purchase or production activation. A verified sender domain remains an external dependency; record exact configuration inputs.

## Decisions and ongoing production setup

Use the existing branch and stack; no reset of original or preview data. The new request is distinct from a booking, price consent or historical record. A matched session still needs a customer's reviewed quote and the normal payment/confirmation workflow. Existing synthetic60-minute offers are practice data, not advertised commercial terms. Production email setup remains separate: the supplied Resend key is private and send-only; a verified owned sender domain is still absent. The latest owner constraint is free services only; no paid upgrade is authorized.

Execution uses the installed subagent-driven-development skill for an isolated backend task and task/final review, while the main agent implements the public/customer UI. The existing codex/production-readiness branch is the authorized isolated development branch. Persistent progress lives in docs/IMPLEMENTATION-STATUS.md and the ignored plan ledger.
