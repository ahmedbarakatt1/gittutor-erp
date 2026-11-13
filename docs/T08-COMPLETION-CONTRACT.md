# T08 delivery boundary — implementation coordination

Prepared from owning business/API/data contracts. Executed implementation evidence is recorded in [T08-DATABASE-EVIDENCE.md](T08-DATABASE-EVIDENCE.md); remaining gates there are explicit.

Core ownership database: factual delivery, completion approval, approved delivery decisions, immutable earning/adjustment source and exact ledger effects, expense and finance projections. Payroll/destination transport can use the earning source independently after its schema freezes.

## Existing command shapes retained

All commands take p_expected_version (current occurrence version except amend/earning) and p_idempotency_key; current actor derived from verified JWT. Common result is command_id/resource_id/version.

- start_occurrence(occurrence_id,actual_start_at): T for current assignment or A; result state=in_progress. Never future actual time or before scheduled start.
- record_attendance(occurrence_id,actual_start_at,actual_end_at,entries): T/A; entries exactly {enrollment_id,attendance:unmarked|present|absent|excused,attended_seconds,reason:null|string}; result attendance_version. Immutable snapshots, all factual instants <=DB now, positive interval, integer observed seconds bounded by actual interval. Present means positive participation; absent/excused/unmarked means zero.
- submit_completion(occurrence_id,attendance_version,topic_summary,delivery_exception_ids): assigned T; result state=completion_pending. Immutable submitted snapshot pins assignment, fee agreement, occurrence policy, accepted current roster and factual attendance.
- approve_completion(occurrence_id,completion_version,approved_remedy_ids): A; result completion_id/base_earning_id. One approved base completion and one base earning per occurrence. No original ledger/history edits.
- amend_completion(completion_id,corrected_facts,evidence_file_id,reason): A; typed facts from API contract; result amendment_id/adjustment_ids. Current completion version; append old/new facts, adjustments must be explicit and bounded.

## Exact privileged read

get_occurrence_delivery(occurrence_id,view=tutor|admin) -> {
 occurrence_id,version,state,start_at,end_at,time_zone,
 assignment_id,tutor:{tutor_id,display_name},
 actual_start_at:null|instant,actual_end_at:null|instant,
 attendance_version:integer>=0,
 roster:[{enrollment_id,learner:{learner_id,display_name},attendance,attended_seconds,reason}],
 completion:null|{completion_id,version,state:submitted|approved,attendance_version,topic_summary,submitted_at,approved_at:null|instant},
 earning:null|{earning_id,amount_minor,currency:'EGP',posted_at},
 delivery_exceptions:[{delivery_exception_id,attendance_version,reason,created_at}],
 approved_remedy_ids:UUID[],
 review_context:null|{agreed_tutor_fee_minor,currency:'EGP',enrollments:[{enrollment_id,commercial_net_minor,reserved_credit_quanta}]},
 required_actions:string[],can_start,can_record_attendance,can_submit,can_approve,can_amend
 }

The current exact occurrence/session views supply lookup; no manual IDs/version inputs. Customer history is a separate explicit safe projection without assignment fees, earnings or payroll.

## Delivery/accounting invariants

Take complete financial graph locks before factual approval effects. Recheck current roster, source reconciliation and exact approved policy/fee/assignment. Missing attendance, unresolved whole-class partial delivery, or a no-show/individual departure requiring review cannot approve by boolean override.

For full approved delivery, each enrollment gets one immutable decision with exact approved cash tuition and reserved package quantity. Package consume kernel moves each actual allocation once and recognizes its carrying value. The separate cash tuition posting recognizes commercial net less active value-mode package application; named coverage's commercial charge is already reduced. Do not recognize the same package value twice. Zero-value complimentary seats remain legitimate outcomes; do not invent cash or a receivable.

Tutor base earning posts tutor expense/tutor payable for the exact saved fee. Cancellation/transfer/reassignment obligations use distinct source obligations and cannot double-post the same earning. Later fee changes are linked signed adjustments with effective and posting dates.

Reviewed partial delivery needs a saved exact decision, not nullable default amounts. Supplemental `review_delivery_exception` binds attendance snapshot, evidence, exact per-enrollment retained charge/consumed quanta and tutor fee; approval executes all source adjustments/consumption atomically. `submit_completion.delivery_exception_ids` selects that immutable decision. `approve_completion.approved_remedy_ids` must match the submitted decision IDs exactly; the command derives actual financial remedy plans from those approved terms and source lineage. These are never boolean overrides. Tutor views omit `review_context`; customer financial fields are confined to the admin review. Original agreed earnings remain immutable and the reviewed tutor total is reached by a referenced signed adjustment. Customer refunds still use the existing source-owned refund/remedy boundary.

Qualification-changing completion corrections and automatic group duration-proration remainder cases remain explicit gates in the evidence file. The initial factual amendment path refuses a changed qualification instead of inventing revised financial terms.

Events: completion_approved aggregate occurrence ID, payload {occurrence_id,completion_id}; tutor_earning_posted aggregate earning ID, payload {earning_id,occurrence_id,tutor_id}. No amounts/private destinations in notification payloads.

Historical test preparation must insert isolated consistent synthetic scheduling/admission history, never alter an existing immutable quote or claim a fake delivery qualification. Actual attendance/completion/earning commands under real Auth provide the T08 qualification. Future-factual rejection is tested against ordinary newly scheduled sessions.
