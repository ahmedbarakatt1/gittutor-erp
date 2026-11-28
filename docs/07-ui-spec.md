# Website and portal UI specification

## Shared design system

The development theme follows the earlier Git Tutor prototype. Use semantic tokens so the brand can approve a revised palette through one configuration change.

| Token | Starting value | Application |
|---|---|---|
| Brand | `#CF302F` | Primary actions and brand emphasis |
| Ink | `#202121` | Main text and navigation |
| Canvas | `#F8F6EF` | Page background |
| Surface | `#FFFFFF` | Forms, cards and tables |
| Accent | `#F9CB49` | Selected highlights and illustration details |
| Border | `#DDD9D0` | Separators and control outlines |

Use a readable sans-serif family with an Arabic-compatible fallback, a consistent spacing scale, clear focus indicators, and accessible contrast. Body copy is at least 16 CSS pixels in customer journeys. Dense administrative tables may use 14 pixels with adequate row height. Statuses have a text label and supporting icon.

Use the approved logo asset once supplied. A text Git Tutor wordmark is the development fallback. The supplied pricing image is an internal reference asset. Customer cards are rendered from the public pricing projection.

Application copy is externalized by locale. The initial English copy below is a draft. Components support RTL direction, logical CSS properties and locale-aware dates, numbers and currency. Countdown values derive from server-synchronized time and the saved occurrence start.

The website starts in English. The language button reads **العربية** in English and **English** in Arabic. Switching keeps the current route and query, including a sign-in return link. A site-wide cookie remembers the selection in that browser. The document uses Arabic and right-to-left direction from the server when Arabic is selected. The interface language is independent of teaching language, uploaded documents, user-entered text and the underlying records.

## Public website

| Route | Required content | Primary action |
|---|---|---|
| `/` | Brand promise, subjects, private/group formats, how booking works, tutor introduction, FAQ and support entry | Find a session |
| `/subjects` | Public descriptions and topic examples for the four study areas, plus requests for other subjects | Request tutoring after sign-in |
| `/offers` | Published individual and group tuition per student per session | Request a session |
| `/offers/[id]` | Verified accounts can read published topics, duration, customer tuition, eligible sessions and booking terms | Reserve a place |
| `/tutors/[id]` | Verified accounts can read approved biographies and teaching subjects | View available sessions |
| `/how-it-works` | Choose, reserve, pay, prepare, join and follow up | Browse sessions |
| `/faq` | Approved answers, payment steps, uploads, groups, cancellations and technical help | Get help |
| `/support` | FAQ and human-support entry, staffed hours and expected next step | Talk to a person |
| `/apply-to-teach` | Tutor application, subjects, experience and contact verification | Submit application |
| `/privacy`, `/terms` | Published policy versions and contact route | Open support |

### Draft homepage copy

**Bring the slide you are stuck on.**

Choose a private session or a small study group. Upload your course materials and work through the topic with a tutor.

**How it works**

1. Choose your topic and teaching format.
2. Reserve a place and review the payment terms.
3. Upload the slides or questions you want to discuss.
4. Join your session and keep the materials in your account.

### Customer group cards

| Group | Price displayed | Supporting content |
|---|---|---|
| Two students | EGP 575 per student | Published duration, start time and availability |
| Three students | EGP 550 per student | Published duration, start time and availability |
| Four students | EGP 500 per student | Published duration, start time and availability |

Every offer identifies its billing unit. A draft or incomplete offer remains accessible to authorized staff for review. Public search includes published offers with complete commercial terms.

## Customer portal

Navigation includes My sessions, Packages, Payments, Study files, Linked learners, Support and Account. A guardian chooses the authorized learner before opening a booking. The page header always identifies the learner and booking reference.

### Booking detail

Use one canonical detail page for private and group enrollments. Its sections are Schedule, Preparation, Payment, Terms and History.

- The header shows the topic, tutor, format, roster capacity, current enrollment state and next action.
- The schedule shows the saved timezone, local date, countdown, meeting readiness and Join action.
- Preparation separates private student files from shared teaching resources, with upload and scan progress.
- Payment shows the agreed charge, applied credits, confirmed allocations, refunds and balance. Evidence review and booking confirmation each have their own status.
- Terms show the accepted price/policy version and available cancellation or amendment actions.
- History explains schedule changes, charge adjustments and important delivery events in chronological order.

### Booking steps

1. Select the learner and offer.
2. Confirm topic, group size, duration and schedule.
3. Review package eligibility or money-funded payment terms.
4. Accept the quote and policy version.
5. Create the hold and show its expiry.
6. Present payment instructions or the package reservation result.

On a version conflict, show the current quote and ask for explicit acceptance of its changes. A seat lost during checkout returns the learner to available options and preserves any submitted evidence.

### Payment-proof screen

Show the supported channel, approved recipient display, amount required for confirmation, total remaining amount and booking reference. The payer enters the transfer amount, time and available reference, then uploads the receipt. Permit reporting an amount greater than the outstanding charge so the service team can identify and allocate the actual funds.

After submission, show upload/scan status, review state and the expected next action. A replacement request names the reason and retains prior versions in history. Personal payment details are visible according to payer and guardian scope.

### Package screen

Show purchased entitlement, active reservations, consumed entitlement, restorations, transfers, expiry and remaining usable amount. Each line opens its related enrollment or adjustment. The customer can see the money paid and any remaining package balance independently from the teaching entitlement.

For an eligible named entitlement, show Covered by package and the exact credit quantity used. For value-funded coverage, show the package value applied and the explicitly accepted top-up. The current standalone price does not silently create additional tuition debt for a fully covered named entitlement.

## Tutor portal

Navigation includes Today, Schedule, Sessions, Learners, Earnings, Payout methods and Profile.

The home page prioritizes the next occurrence, preparation status, unresolved completion submissions and outstanding pay. The calendar provides list and week views with clear availability and confirmed commitments.

### Session workspace

Show the exact assigned occurrence, current schedule, countdown, meeting readiness, roster, learning goals, private learner files, shared resources and the tutor's agreed fee. Each attendance row records status and an optional operational note.

The completion action collects actual delivery times, attendance, covered topics and any exception. Present the saved policy's consequence before submission. Pending approval and approved completion have distinct states. A historical correction opens an auditable correction workflow.

### Earnings and payout methods

Display dated original earnings, adjustments, payout attempts, settled allocations and remaining balance. Provide a scoped statement export. A payout destination entry shows method, masked destination, verification state and verification history. Full values are collected through an authenticated form and retained only in the privileged storage path.

## Customer-service portal

Navigation includes My queue, Payment reviews, Support inbox, Follow-ups and Delivery issues.

The queue supports unassigned, mine, waiting for evidence, needs information, escalated and resolved views. Sort by age and operational deadline. Show ownership and case version so simultaneous claims have a clear result.

### Payment comparison

Use side-by-side panels on desktop and stacked panels on mobile.

| Payer evidence | Independently sourced transfer |
|---|---|
| Learner, payer relationship and uploader | Receiving account and channel |
| Receipt version and scan state | External transaction identity |
| Reported amount and time | Amount, currency and settlement |
| Booking or package charge | Existing allocations and available amount |

Actions include Claim, Request replacement, Match funds, Allocate, Escalate and Resolve according to permission and case state. Explain the exact unmet prerequisite next to a disabled action. A payment approval result shows the allocation and current booking outcome separately.

### Support inbox

Show the actual channel, conversation identity, last incoming time, response eligibility, waiting age, current owner and internal follow-up notes. Public web chat and WhatsApp conversations retain distinct channel state. FAQ automation visibly pauses when a human case is active.

Use the approved answer library for routine questions. Payment disputes, refunds, sensitive account requests, unclear questions and direct requests route to a human. A rep sees eligible template choices when a WhatsApp free-text reply falls outside its service window.

## Admin portal

Navigation includes Overview, Sessions, Groups, Customers, Tutors, Packages, Payment exceptions, Finance, Campaigns, Team, Notifications, Policies and Audit.

### Admin priorities

The overview opens with actionable queues for approaching classes, groups awaiting confirmation, unsettled exceptions, missing meeting links, overdue completion approvals and payout issues. Each card carries a count, date basis and drilldown.

The pricing editor separates customer tuition from internal compensation. An occurrence preview shows the priced roster, charges, exact approved tutor fee and contribution before other expenses. Group amendments show the before/after agreement and required acceptances.

The finance view shows earned revenue, cash movement, customer credit, package delivery obligations, tutor payables, expenses and refunds with clear period and settlement filters. Every number opens its underlying records.

The customer directory uses durable IDs and relationship links. Contact exports show their row grain. Financial exports use allocation-level or payer-level rows with additive totals. Export filters and scope appear in the confirmation and audit record.

## Consistent interaction states

Every data-driven view implements loading, empty, permission-limited, validation error, stale version, provider-pending and recoverable-failure states. Preserve form input after a transient failure. Use one logical operation key through a network retry.

Success messages reference the resulting record. Background operations state what is pending and how staff can recover it. Countdown expiry changes the next action according to the server state, including a late or rescheduled class.

## UI acceptance

- Keyboard users complete booking, upload proof, claim a review, record attendance and request an export.
- At 360 CSS pixels, primary actions and money amounts remain readable and reachable.
- At 200% zoom, controls remain usable and table regions have a clear scroll affordance.
- Form errors are associated with controls and announced to assistive technology.
- Role-specific direct URLs and stale tabs are verified with separate accounts.
- The customer network payload, rendered HTML and downloadable documents contain only authorized customer fields.
- The selected theme is applied consistently to website, portals, transactional email and generated statements.
