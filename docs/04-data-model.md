# Data model

## Common fields and schema boundaries

Implements R02–R18. Every application primary key is UUID. Mutable aggregates have integer `version`, `created_at` and `updated_at`. Audit and financial records also retain `effective_at`, `recorded_at`, `command_id` and source lineage. Use UTC `timestamptz`, `Africa/Cairo` business boundaries, `EGP` currency and integer `_minor` amounts. JSON integers must fit JavaScript's safe-integer range. Reject invalid values before casting. Foreign keys use restrictive deletion for financial, teaching and entitlement history.

Only `api` is Data API exposed. All tables below reside in `app_private` unless marked `finance_private`. No browser role receives raw-table privileges. Public DTOs project an approved subset. Published policies, accepted quotes, posted movements, settlements, completed delivery and audit entries are append-only. Corrections reference their original record.

## Identity and commercial records

| Table | Grain and essential fields | Keys and invariants |
|---|---|---|
| `people` | One person, display name, learner history completeness | Names and shared phones never establish uniqueness |
| `accounts` | One Auth user, optional person link, account kind, active flag, locale | PK/FK `auth.users.id`, visitors have no learner privileges |
| `account_roles` | One role assignment with grant/revoke times | One active assignment per account/role, admin-controlled |
| `verified_contacts` | One versioned person/channel destination, verification and consent | Preserve prior versions, only verified active destination dispatches |
| `guardian_links` | Guardian account, learner, scoped permissions, consent evidence and validity interval | Unique active relationship, explicit scope and revocation |
| `tutor_applications` | Applicant, submitted subjects/profile, review decision | Application approval grants tutor role through a separate audited command |
| `tutors`, `tutor_profile_versions` | Tutor identity and versioned draft/approved public teaching fields | Private contact and compensation excluded from public profile |
| `subjects`, `offers` | Subject and private/group product, publish state and contract references | Publish requires approved applicable policy and pricing versions |
| `policy_versions`, `pricing_versions` | Immutable version, scope, effective dates, approval and content hash | Used versions immutable, synthetic scope rejected by live publication |
| `availability_rules`, `availability_exceptions` | Tutor's Cairo weekly hours and dated deviations | Valid intervals, overlap validation, commitment checks on edits |

Imports preserve `source_system`, `source_record_id`, batch ID and original label in private lineage records. Match imported people through a reviewed mapping. Imported payment and completion labels retain `legacy_reported` provenance until verified. Verified historical coverage is explicit on the learner profile for first-ever attendance claims.

## Booking, delivery and packages

| Table | Grain and essential fields | Keys and invariants |
|---|---|---|
| `occurrences` | One teaching meeting, offer, format, target tier, capacity, tutor, UTC interval, zone, state | Private capacity one, group tier approved, end after start |
| `tutor_assignments` | One assignment version per occurrence | One active assignment, completed delivery pins immutable assignment |
| `tutor_reservations` | One active tutor/time interval per occurrence | GiST exclusion on tutor and overlapping `tstzrange`, including held group meetings |
| `enrollments` | One learner seat, occurrence, booker, state, hold expiry | Partial unique learner/occurrence for held or confirmed rows |
| `quotes`, `quote_acceptances` | One seat quote version and each authorized acceptance | Price, currency, terms, expiry and hash pinned to acceptance |
| `group_amendments`, `amendment_acceptances` | Proposed roster/price/fee changes against base occurrence version | Accepted versions and all required parties checked at atomic commit |
| `operation_proposals`, `operation_proposal_acceptances` | Typed reschedule, cancellation remedy, package coverage or package conversion against an aggregate/policy version | Immutable terms and scoped hashes, expiry, required parties, approval and single committed consumption |
| `attendance_entries` | One learner observation per occurrence version | Classification plus integer `attended_seconds`, bounded by actual interval |
| `completions`, `completion_amendments` | One approved occurrence closeout and later corrections | Unique base completion per occurrence, actual interval and roster required |
| `package_purchases` | One purchased contract, learner, base duration, eligible formats, coverage mode and expiry | Renewal creates a new purchase with preserved ancestry |
| `package_lots` | One grant or carried-value lot within a purchase | Integer `credit_quanta` and `_minor` carrying value, currency pinned |
| `entitlement_movements` | One append-only movement against a lot and optional enrollment | Type vocabulary from spine, linked restore/release, unique command line |
| `remedy_reservations` | One reservation of eligible entitlement and monetary remedy value | Shared lock with cash refund and restoration commands prevents double benefit |

Capacity uses confirmed seats plus unexpired holds under the occurrence lock. A partial uniqueness constraint cannot evaluate clock expiry dynamically, so commands first expire relevant holds under lock. A scheduled tutor reservation remains while the meeting is operationally committed, even when learner holds expire. Booking and availability changes lock the same tutor scheduling resource.

Store lot movements as signed deltas for `available_credit_quanta`, `reserved_credit_quanta`, `consumed_credit_quanta`, `expired_credit_quanta` and corresponding value buckets. A standard session is 1000 quanta. The contract supplies `base_duration_minutes` and eligible formats. Reservation moves available to reserved, consumption moves reserved to consumed, and restoration reverses an identified consumption. Each movement validates the quantity and carrying-value conservation equations in the business rules. Paired transfers share a transaction and lineage ID. Refund remedies reserve the same original quantity/value used by entitlement remedies.

Package `coverage_rule` is `named_entitlement_covers_eligible_occurrence` or `allocated_value_with_explicit_top_up`. Named coverage uses funding source `reserved_named_package_entitlement`. An eligible 1000-quanta credit carrying 50000 covers the named service even when its standalone charge is 57500. Save the approved coverage adjustment, zero additional tuition debt and 50000 carrying-value revenue. Allocated-value coverage uses `reserved_eligible_package_value` and requires an accepted 7500 top-up in that example. `verified_payment_allocation` is the cash-funding source. Funding queries expose quanta satisfaction and value allocation separately.

Creating a package purchase creates its contract and charge. Usable grants activate only when the approved purchase-funding policy is satisfied, or through an explicitly approved and audited complimentary/credit grant. Receipt submission supplies evidence while that funding decision remains pending. A pending purchase therefore contributes zero usable entitlement to another booking.

## Financial records

All following tables belong to `finance_private`.

| Table | Grain and essential fields | Keys and invariants |
|---|---|---|
| `charges`, `charge_adjustments` | Issued enrollment/package obligation and linked debit/credit | `draft`, `issued`, `voided`, currency and accepted contract pinned |
| `payment_channel_settings`, `receiving_accounts` | Enabled methods and versioned verified collection destination | Approved customer instructions, controlled activation, per-tutor enabled payout methods |
| `incoming_transfers` | One receiving-account external transaction, amount, channel, settlement state and evidence | Unique receiving account/channel/external ID, positive amount |
| `receiving_accounts` | One versioned platform collection destination and approval record | Payment instructions pin the approved account version |
| `transfer_reversals` | One external partial/full reversal | Unique external reversal ID, original transfer reference |
| `payment_allocations`, `allocation_reversals` | Amount from one settled transfer to one charge | Aggregate allocations bounded by net settled available value under transfer lock |
| `refunds`, `refund_attempts` | Approved charge-funded or unapplied-credit remedy and each outgoing attempt | Typed source and original transfer lineage, reserved amount, verified destination version, refund states from business rules |
| `refund_destinations` | One proposed and verified payer refund destination version | Authorized payer/source linkage, encrypted identifier and independent ownership verification |
| `tutor_fee_agreements` | Exact approved fee version per occurrence | Approved tier range, tutor, duration, policy and acceptance retained |
| `tutor_earnings`, `earning_adjustments` | One base occurrence earning and later authorized changes | Unique base earning per occurrence, immutable delivered assignment |
| `cancellation_awards` | Approved compensation for cancelled occurrence | Unique fee-obligation award, prevents overlapping base compensation |
| `payout_destinations` | One encrypted destination version with verification evidence | Masked DTO, immutable version pinned by attempts |
| `payout_attempts`, `payout_allocations` | One attempt and its allocations to posted earnings | Pending/unknown reserves payable, settlement reduces owed once |
| `expenses`, `expense_settlements` | Incurred expense and its cash settlements | Separate cost recognition and cash dates |
| `ledger_transactions`, `ledger_lines` | One posting group and signed account entries | Sum of signed minor units zero per transaction/currency, unique source posting key |

`receipt_evidence` and `review_cases` reside in `app_private` with tightly scoped access. Evidence stores learner, authorized uploader, target enrollment/charge, file version, checksum and status. A review stores owner, evidence version, decision and linked transfer/allocation IDs. Matching never accepts a pending transfer or a staff-uploaded substitute for the required payer evidence.

Maintain a chart of accounts for channel cash, receivables, customer advances/unapplied funds, deferred tuition, tuition revenue, tutor expense/payable and operating expense/payable. Settlement records incoming cash and an obligation. Allocation reduces the corresponding receivable. Delivery recognizes applicable tuition or package carrying value. Tutor earnings create expense/payable. Payout settlement reduces cash/payable. Refund and reversal postings retain source, effective period and adjustment lineage. Approved opening balances use a separate controlled posting.

| Posting event | Debit | Credit |
|---|---|---|
| Issue tuition/package charge | Receivable | Deferred tuition/package obligation |
| Independently verify incoming settlement | Channel cash | Unapplied customer funds |
| Allocate settled funds to a charge | Unapplied customer funds | Receivable |
| Approve eligible delivery | Deferred tuition/package obligation | Tuition revenue |
| Post tutor earning | Tutor expense | Tutor payable |
| Settle tutor payout | Tutor payable | Channel cash |
| Recognize operating cost | Operating expense | Expense payable |
| Settle operating cost | Expense payable | Channel cash |

Channel values are `instapay` and `vodafone_cash`. Use the linked credit, reversal and remedy rules for refunds, partial delivery and account credit. A package-funded enrollment consumes the existing deferred carrying value through its coverage allocation. Its coverage adjustment prevents a second receivable or deferred obligation for the same service.

Enforce net charge balance from issued charges, linked credits and net allocations. Unapplied settled value remains identifiable customer credit. Approved/pending/unknown refunds reserve refundable value. Pending/unknown tutor payouts reserve available payable while the amount owed still includes them. Reversals preserve actual external cash effects and open a reconciliation exception when prior assumptions fail.

## Integration and reporting records

| Table | Grain and constraints |
|---|---|
| `files` | One immutable object version, opaque storage key, owner/scope, checksum, scan state and retention date |
| `calendar_events` | One occurrence/provider event, unique occurrence/organizer, provisioning state and request ID |
| `provider_connections` | Encrypted organizer/account credential reference and authorization status |
| `command_results` | Unique actor/command/idempotency key, canonical request hash and safe committed response |
| `domain_events`, `outbox_jobs` | Immutable event and durable delivery work, unique event/job purpose, lease token and retry metadata |
| `notification_deliveries`, `delivery_attempts` | Unique event/recipient/channel/template version, provider IDs and ordered status observations |
| `webhook_events` | Unique provider/external event ID, verification result, raw private retention and processing outcome |
| `conversations`, `messages`, `handoffs` | Channel thread, immutable provider message, versioned human ownership and private notes |
| `follow_ups`, `export_jobs`, `export_rows` | Named owner/due date, requester/filter/snapshot and immutable export rows |
| `lead_inquiries`, `learner_links` | Timestamped source evidence and reviewed contact-to-learner link |
| `campaigns`, `campaign_spend_entries` | Stable source/campaign identity and dated currency-specific spend with provenance, revisions and optional expense reference |
| `attribution_revisions` | Learner's selected acquisition inquiry, policy version and superseded credit |
| `audit_events`, `reconciliation_exceptions` | Append-only actor/action/evidence record and owned unresolved discrepancy |

Select the earliest eligible inquiry from retained history before filtering its Cairo first-inquiry date into a cohort. Preserve verified organic, verified campaign and unknown attribution separately. Attendance conversions require approved completed occurrences and verified individual participation. Unknown lifetime history remains an explicit classification. Export financial facts at declared additive grain.

Index foreign keys and current queue predicates, including due jobs, active case owners, hold expiry, learner/occurrence, transfer identity, and effective/posting dates. Validate concurrency constraints with real PostgreSQL transactions and inspect query plans using representative synthetic volumes. Sensitive read views, when used, require `security_invoker` and explicit grants. [Supabase database functions](https://supabase.com/docs/guides/database/functions) · [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
