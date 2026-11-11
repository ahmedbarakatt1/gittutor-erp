# Shared implementation contract

Prepared by Hossam Nabil Elsabbagh. Revision 1, 11 November 2026.

This pack specifies a tutoring website and operations platform for Git Tutor. The source workbook supplies operational scenarios. Development and automated tests use synthetic records.

## Shared choices

- Greenfield stack uses Next.js App Router, TypeScript, Supabase Auth/PostgreSQL/private Storage, a durable Node.js worker, Vitest, PostgreSQL integration tests, and Playwright. The implementation agent resolves and pins supported stable versions during bootstrap.
- One application repository and one modular domain model. Proposed source layout uses `src/app`, `src/modules`, `src/server`, `src/worker`, `tests`, and `supabase`.
- User roles are `student`, `guardian`, `tutor`, `customer_service`, and `admin`. Student and guardian share one portal with different relationship scopes. Staff roles are assigned by an administrator and checked against current database membership.
- Currency starts with `EGP`. Monetary values use integer minor units, so EGP 575 is `57500`. Store instants as UTC `timestamptz` and use `Africa/Cairo` for default display and business-date boundaries.
- Public customer DTOs use explicit field allowlists. Tutor fees, compensation ranges, margins, payout destinations, internal notes and provider credentials belong to privileged records and responses.
- API JSON fields and database columns use `snake_case`. IDs are UUIDs in the application. Synthetic fixture labels are test identifiers that the seeder maps to UUIDs.
- Package quantity uses integer `credit_quanta`, with `credit_quanta_per_session` fixed at 1000 for the initial contract. Each package declares `base_duration_minutes` and eligible formats. A half-credit example is 500 quanta. Actual participation uses integer seconds and UTC event times.
- Mutating endpoints accept `Idempotency-Key`. Versioned updates include `expected_version`. The server derives the actor from verified authentication.
- Generic response errors contain `code`, `message`, `request_id`, and optional field errors. Conflict responses use HTTP 409. Authorization failures disclose only the information the caller may access.
- The preferred Supabase boundary exposes narrow, authenticated RPCs for atomic commands and sanitized read interfaces. Compensation and operational secrets live in an unexposed private schema. Raw financial tables have no browser grants. Sensitive RPCs authorize the current actor and object inside the database transaction.

## Authoritative pricing inputs

| Group size | Seat price in minor units | Tutor fee minimum | Tutor fee maximum |
|---|---:|---:|---:|
| 2 | 57500 | 45000 | 45000 |
| 3 | 55000 | 60000 | 65000 |
| 4 | 50000 | 70000 | 75000 |

The exact tutor fee is approved for each occurrence. Contribution is tuition less the approved tutor fee. Pricing unit and duration are configurable. These figures are interpreted as EGP per occurrence for development scenarios. The product's published policy supplies the commercial unit and duration.

## Policy decisions

Confirmed requirements are the supplied group prices, internal tutor compensation, student/guardian receipts, independent transfer reconciliation, private and group teaching, tutor pay statements, role-scoped access, operational email, WhatsApp handoff, and attendance-based acquisition analytics.

Draft commercial policies cover duration, deposit threshold, hold expiry, group confirmation deadline, group amendment acceptance, cancellation/no-show treatment, partial-delivery remedies, package eligibility/expiry and refund options. Implement editable, versioned policies. Synthetic tests choose explicit values. An offer can be published once its required policy fields are complete and an admin records approval. Isolated development uses simulated published policies marked synthetic while the owner's unresolved commercial decisions remain draft.

## State vocabulary

| Record | States |
|---|---|
| Occurrence | `draft`, `forming`, `confirmed`, `in_progress`, `completion_pending`, `completed`, `cancelled` |
| Enrollment | `held`, `confirmed`, `cancelled`, `expired` |
| Attendance | `unmarked`, `present`, `absent`, `excused` |
| Receipt evidence | `uploaded`, `quarantined`, `ready_for_review`, `superseded`, `rejected` |
| Review case | `waiting_for_evidence`, `unassigned`, `claimed`, `needs_information`, `escalated`, `resolved` |
| Operation proposal | `proposed`, `accepted`, `approved`, `committed`, `declined`, `expired` |
| Incoming transfer | `pending`, `settled`, `reversed` |
| Payout attempt | `draft`, `pending`, `settled`, `failed`, `unknown`, `reversed` |
| Meeting provisioning | `not_requested`, `pending`, `ready`, `failed`, `revoked` |
| Package entitlement movement | `grant`, `reserve`, `release`, `consume`, `restore`, `transfer_out`, `transfer_in`, `expire`, `adjust` |

Payment and attendance outcomes are independent of occurrence and enrollment state. Published policy controls confirmation, financial obligations and remedies.

## Requirement IDs

| ID | Requirement |
|---|---|
| R01 | Public website, brand and responsive bilingual-ready UI |
| R02 | Authentication, roles, guardian links and current object permissions |
| R03 | Products, exact pricing, policy versions and field-level confidentiality |
| R04 | Private/group booking, holds, availability and concurrency |
| R05 | Packages, entitlement use, renewal and partial delivery |
| R06 | Receipt upload, independent reconciliation and payment allocations |
| R07 | Refunds, cancellations, credit adjustments and money conservation |
| R08 | Scheduling, Google Meet, countdown and calendar synchronization |
| R09 | Student/tutor materials, file privacy, scanning and access revocation |
| R10 | Attendance, controlled completion and auditable session history |
| R11 | Tutor profiles, fee agreements, earnings, destinations and payouts |
| R12 | Customer register, scoped exports, identity matching and source lineage |
| R13 | Cash, revenue, expenses, obligations and actionable finance reports |
| R14 | Email routing, outbox, retry and delivery visibility |
| R15 | Website support, WhatsApp FAQ and human handoff |
| R16 | Campaign attribution, student progression and staff workload |
| R17 | Security, recovery, observability and deployment verification |
| R18 | Synthetic fixtures, regression tests and evidence-based delivery |

## Document precedence

Current explicit user instructions take precedence. This pack's confirmed requirements and pricing inputs then control. Draft policies are identified in the decision register. Earlier PDF and HTML examples provide context and visual references. Resolve contradictory historical behavior using the business rules, contracts and acceptance cases in this pack.
