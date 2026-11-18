# Git Tutor project handoff

**Internal engineering and operations guide · 18 November 2026**

Start here if you are taking responsibility for the site, supporting a booking, or preparing Git Tutor for paying customers. The public site accepts a learner's own course material. Staff match that request to a scheduled lesson. Three different decisions follow: the learner accepts the quote, staff establish eligible funding, and the system confirms the seat. Teaching, attendance, earnings and payout each have their own records. A colleague investigating an issue should first identify which of those decisions has actually occurred.

[Complete printable report](../../output/pdf/Git-Tutor-Handoff.pdf) · [Shared testing site](https://gittutor-erp-rho.vercel.app/login) · [Private repository](https://github.com/ahmedbarakatt1/gittutor-erp) · [Implementation record](../IMPLEMENTATION-STATUS.md)

## Where to start

| Your immediate job | Start here | What you should be able to do afterward |
|---|---|---|
| Take over customer or tutor operations | [Product and workflows](01-product-and-workflows.md) | Follow one learner through request, offer, seat, payment, lesson and history. Explain which action each role can take when progress stops. |
| Review a pull request or change business logic | [Architecture and money](02-architecture-and-money.md) | Trace a page through its API handler, authorization, SQL transaction, outbox and provider. Identify balances and scopes that the change must preserve. |
| Start the app, operate the worker or plan a launch | [Operations and release](03-operations-and-release.md) | Bring up an isolated environment, run checks, diagnose provider failures, distinguish preview from production, and assign each launch gate. |
| Find a screen, endpoint, design asset or regression suite | [Route and evidence atlas](04-route-and-evidence-atlas.md) | Locate every page and HTTP handler in the source tree, the owning requirement, and the evidence to check before changing it. |

## State at transfer

| Item | Recorded state | Consequence for the colleague |
|---|---|---|
| Branch and deployment | The preparation work is on `codex/production-readiness`. The latest verified functional preview at the start of this handoff was `999ebad`. | Inspect the branch, PR and hosting revision independently. Pushing documentation does not switch the testing alias to a different customer database. [Pull request](https://github.com/ahmedbarakatt1/gittutor-erp/pull/1) |
| Working flow | A learner submitted sample slides, accepted a quote and passed a synthetic funding review. The assigned tutor downloaded the same bytes. Both test accounts entered a real Google Meet for the designated appointment. | This establishes the controlled one-to-one flow. Test group duration, production authorization, file scanning, real money and recovery separately before launch. [Executed pilot record](../IMPLEMENTATION-STATUS.md) |
| Verification | The full run on `459de31` passed 463 unit, 306 integration and 168 browser tests plus database checks and a production build. Two optional guided-demo browser cases were skipped in this run. | Treat those results as evidence for that revision. The formal acceptance register separately lists 147 cases as not run. [GitHub run](https://github.com/ahmedbarakatt1/gittutor-erp/actions/runs/44345460137) · [Recording acceptance evidence](../EVIDENCE-WORKFLOW.md) |
| Historical data | The authorized preview includes 139 workbook source rows. Operational mappings include 5 learner profiles, 11 tutors and 18 course labels. Missing fields and uncertain identity links are recorded. | Preserve the source reference, scope and reported status. Reconcile identities and independently verify opening balances before migration to production. [Import evidence](../ACTUAL-DATA-IMPORT.md) |
| Clean production | At the 18 November read-only check there was one unconfirmed owner account, zero staff grants, zero workbook import batches, zero financial postings and zero queued jobs. | Owner activation and a reviewed cutover are still required. Use the clean-host preflight and account bootstrap in their documented order. [Production inputs](../PRODUCTION-INPUTS.md) |

## How to take over an open booking

1. **Identify the environment and actor.** Record the host, role and private record reference in the authorized case system. Use the learner view for the customer symptom. Open the admin view separately if the investigation requires it. Limit screenshots and ticket content to what the recipient is allowed to see.
2. **Locate the last committed decision.** An uploaded file, submitted request, proposed schedule, held seat, accepted quote, verified transfer, confirmed enrollment and ready room are separate checkpoints. Use the detail page or scoped read for that checkpoint. Both the occurrence and individual enrollment matter for group sessions.
3. **Establish who owns the next action.** For example, customer service can match a request to an available slot or review assigned evidence. An administrator approves the exact teaching agreement. A customer accepts their quote. The worker prepares a room once a valid confirmation has committed.
4. **Follow the evidence.** A payment screenshot proves that the payer supplied an image. A separately evidenced settled transfer, reviewer authority and valid allocations establish eligible money. A spreadsheet label establishes a historical claim. A provider timeout may leave a remote operation unresolved.
5. **Verify the repair at both boundaries.** Reopen the same record as its authorized user and exercise denial or revocation for an unrelated user in an isolated environment. Reconcile original and resulting amounts, quantities, job references or file versions as appropriate. Keep private identifiers out of a shared defect report.

## Day-one access and custody

| Resource | Owner or authorized operator provides | First check |
|---|---|---|
| Source and CI | Access to the private repository, pull request, actions logs and branch | Open the application verification linked above, inspect its commit and compare the current diff. |
| Local development | Pinned Node/pnpm, PostgreSQL and Docker's Linux engine, disk space for an isolated checkout | Follow chapter 3. Confirm the startup guards select the disposable project before migrations, test seeds or browser runs. |
| Hosted testing | Separate test logins and the intended practice record through a private channel | Sign in to each assigned workspace, confirm the record and environment. Review the [preview guide](../ONLINE-PREVIEW.md). |
| Production infrastructure | Authorized access to the hosting team, Supabase projects, Google organizer and selected email provider, with privileges appropriate to the operator | Match the chosen project and origin to the deployment plan. Invite the colleague individually where supported. Enter replacements for previously shared credentials in the appropriate secret settings. |
| Finance and records | Authorized commercial policy owner, independent settlement evidence, reviewed payee and guardian mappings, retention decisions | Identify the person who can approve each decision. Leave unresolved names, balances or provider outcomes in review. |

The repository contains privileged internal authoring material. The PDF and handbook omit tutor compensation amounts, live credentials, real learner identities, room URLs and private sample files. The source links are for a colleague with repository access. Transfer secrets using the provider's access controls or the team's secure store. The project directory also contains ignored private operational material on the operator's machine. Give the colleague a clean clone and the minimum separate access needed for their job.

## First decisions for the next maintainer

The owner has confirmed customer prices, 90–105 minute sessions, Mailjet as the chosen sender and a free-services constraint. The current Vercel testing setup is in use. The proposed alternative commercial host is deferred. Start launch planning with the host, continuous worker and private scanner, then the permanent hostname, Auth redirects and Google organizer consent. In parallel, reconcile commercial terms and workbook identities, decide whether WhatsApp should launch with automation, and rehearse recovery. Chapter 3 assigns concrete checks and records where the next step is engineering work versus an owner decision. [Release decision](../RELEASE-READINESS.md)
