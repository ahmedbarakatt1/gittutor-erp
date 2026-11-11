# Git Tutor product specification

Prepared by Hossam Nabil Elsabbagh. Revision 1, 11 November 2026.

## Product goal

Git Tutor helps university students bring their course materials to an appropriate tutor, reserve private or group teaching, pay through supported Egyptian transfer channels, and follow their learning sessions. The operations platform supports the team from inquiry through delivery, payment reconciliation, tutor settlement and business reporting.

The implementation provides a responsive public website and four portal experiences. Student and guardian permissions share the customer portal. Customer service has its own staff workspace. All portals use one design system and authoritative records.

## Scope by requirement

| ID | Required behavior | Completion evidence |
|---|---|---|
| R01 | Public home, subjects, tutors, private/group offers, pricing, how it works, FAQs, support, tutor application and policy pages. Responsive, accessible, externalized copy and RTL-capable layout. | A visitor browses and enters a correctly priced booking journey on desktop and mobile. |
| R02 | Verified account identity, admin-assigned staff roles, linked guardian consent and per-record authorization. | Separate accounts pass allowed-action and denied-object tests, including revocation. |
| R03 | Versioned offers, group tiers, private pricing, exact tutor agreements and role-scoped projections. | Quotes and internal calculations match the supplied tiers. Customer outputs pass sensitive-field tests. |
| R04 | Tutor availability, private reservations, group formation, holds, confirmation and waitlists. | Concurrent final-seat requests yield one reservation. Changes retain the agreed policy. |
| R05 | Package purchases, eligible products, entitlement reservations, consumption, restoration and renewal transfers. | Credit quantity and value reconcile through cancellation and partial delivery. |
| R06 | InstaPay/Vodafone Cash instructions, payer-uploaded receipts, independent incoming-credit evidence and claimed CS review. | One verified allocation updates a balance once and preserves the review evidence. |
| R07 | Partial payments, overpayments, customer credit, refund approval, settlement and reversals. | Money conservation and related booking/entitlement outcomes pass tests. |
| R08 | Calendar availability, one meeting per occurrence, automatic Google Meet provisioning, rescheduling and countdown. | Provisioning failures are recoverable and reminder schedules track the latest occurrence version. |
| R09 | Private learner preparation uploads and shared tutor resources, safe file processing and access expiry. | Classmates cannot read private submissions. Authorized access changes take effect on the documented download path. |
| R10 | Planned and actual times, per-learner attendance, submitted completion, approval and correction history. | One approved completion creates the required delivery events and financial postings. |
| R11 | Tutor profile, subjects, availability, own fee agreements, earnings, payout methods and settlement history. | Tutor balances equal earnings plus adjustments less settled allocations. |
| R12 | CRM contacts, learner/payer/guardian relationships, inquiries, follow-ups, sessions and filtered CSV export. | Record drilldowns and exports reconcile to authorized source records. |
| R13 | Earned revenue, cash accounts, expenses, refunds, customer credit, package obligations, tutor payables and margins. | Reports reconcile to their transaction-level details. |
| R14 | Event-driven email for customers, tutors, CS and admin with recipient scope, retries and failure visibility. | Recipient and replay tests pass, then the configured provider passes a controlled delivery test. |
| R15 | Website FAQ preview, human escalation, conversation ownership and official WhatsApp continuation. | Bot pauses on handoff, one rep owns the response, and channel delivery restrictions are enforced. |
| R16 | Campaign source capture, deduplicated opportunities, first-attendance cohorts, student follow-up and staff workload. | Cohort cutoffs, returning students, unknown history and source evidence reconcile to drilldowns. |
| R17 | Authentication hardening, private files, security logging, observable jobs, backups and tested recovery. | Authorization, replay and restoration evidence is recorded before live release. |
| R18 | Synthetic fixture set, automated regression cases and task evidence. | Each release-critical acceptance case maps to an executed test or a recorded manual check. |

## Primary user journeys

### Visitor to confirmed booking

A visitor selects a subject, teaching format and offer. The offer presents duration, student price, available dates, group size, deposit terms and cancellation policy. The visitor signs in or creates an account, chooses the learner being booked, and enters a learning goal.

The system creates a time-limited seat reservation. A package may supply eligible entitlement. A money-funded reservation displays its configured payment instructions and amount required for confirmation. The student or linked guardian uploads proof, then sees evidence review and booking status separately.

After the transfer is independently matched and the policy threshold is met, confirmation checks the occurrence's current state, price version and remaining capacity. The system queues the appropriate notifications and meeting provisioning. An expired seat leads to an explicit rebooking/refund case with the funds retained in the financial record.

### Customer preparation and attendance

The customer opens a booking to see the schedule, countdown, meeting readiness, private preparation files, shared teaching resources, payments and applicable terms. A guardian chooses among authorized linked learners. Each child or university learner retains an independent record.

The learner can upload slides, PDFs and question images within the configured allowed types and size limit. Files become available according to scan state and object permissions. Tutor-authored shared resources have an explicit group visibility setting.

### Customer service payment review

A rep signs in to a dedicated workspace, claims a case, checks the latest eligible payer-uploaded receipt, and selects independently sourced incoming funds. The case shows currency, channel, approved receiving account, external transaction identity, amount, settlement and allocation status.

Approval atomically rechecks permission, ownership, versions and allocation capacity. The rep may request clearer evidence or escalate an exception. Admin resolves refund, reallocation and pricing exceptions under the relevant permission.

### Tutor delivery and pay

An invited tutor completes their profile, teaching subjects, verified contact channels and availability. They see assigned occurrences and learner preparation materials. The session workspace includes the roster, time remaining, Meet readiness and their own exact agreed fee.

After teaching, the tutor records actual delivery and attendance, then submits completion. Operations approval creates the earned fee according to the saved agreement. The tutor statement displays original earning entries, dated adjustments, payout attempts, settled payments and outstanding balance. A proposed payout destination becomes usable after internal verification.

### Admin operations and finance

Admin publishes offers and policy versions, approves tutor agreements, manages capacity, handles exceptional changes and closes completed sessions. Customer charges and tutor compensation have distinct approval and reporting paths.

Admin records and reconciles expenses, incoming transfers, refunds and tutor payouts. Reports show period definitions, currency, status filters and source drilldowns. Administrative corrections append history and preserve a reproducible financial trail.

### Support and growth

Website FAQ responses use approved content for formats, booking, uploads and payment steps. A direct request or sensitive unresolved question creates a human support case. The conversation retains its source, transcript, owner, waiting age and next action.

Campaign source evidence links inquiries to verified learner opportunities, enrollments and attendance. Reports identify the first eligible inquiry before applying the cohort date filter. The student and team dashboards turn unresolved stages into assigned follow-up actions.

## Commercial decision register

| Decision | Current status | Local implementation behavior |
|---|---|---|
| Group seat amounts and compensation ranges | Supplied by the user | Encode exact amounts from the pricing contract. |
| Currency and billing unit | EGP and per occurrence are contextual development assumptions | Keep them explicit in offer configuration and fixture labels. |
| Duration and private-session prices | Owner-configured | Draft offers and explicit synthetic values support development. |
| Deposit threshold, holds and group cutoff | Owner-configured | Use versioned policy fields and boundary fixtures. |
| Price protection after group dropout | Proposed policy | Implement policy selection and approved amendment history. |
| Refund, cancellation, no-show and partial-delivery terms | Owner-configured | Policy engine uses explicit rules saved with each agreement. |
| Package eligibility, unit, expiry and transfer remedies | Owner-configured | Draft product settings and deterministic fixture rules support tests. |
| Canonical logo and color palette | Brand review required | Use the existing red/ink interface tokens as the development starting point. |
| Default interface language | English development copy | Externalize messages and support RTL layouts for Arabic localization. |

## Source interpretation

The workflow workbook contributes scenarios around packages, mixed tutor assignments, installments, fee overrides, shortened lessons, renewal credits, cancellations, relationships and reconciliation. Development uses newly created synthetic records. The supplied group-pricing image controls the current tier amounts. Its contribution arithmetic is recalculated in the internal contract.

## Product completion

The local implementation is complete when all R01–R18 journeys have working persisted behavior and the applicable automated tests pass. The release record additionally identifies live provider configuration, approved commercial policies, verified sending/receiving accounts, retention settings and recovery evidence.

Each incomplete external dependency has an owner and exact verification step. The implementation agent continues independent local tasks while those dependencies are recorded.
