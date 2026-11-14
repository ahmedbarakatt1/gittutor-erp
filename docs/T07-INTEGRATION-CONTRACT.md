# T07 integration contract — preparation

Prepared 11 November 2026. This document freezes the local implementation boundary for T07; it does **not** record implemented features, executed acceptance tests or live-provider readiness. It was prepared before the T04–T06 integration checkpoint. A subsequent explicit user priority change authorized independent T07 work while that checkpoint remains pending; it did not close the checkpoint or waive its remaining verification. The owning requirements remain [the implementation plan](superpowers/plans/2026-11-11-git-tutor.md), [security/integrations](06-security-integrations.md), [API contracts](05-api-contracts.md), [data model](04-data-model.md) and [UI specification](07-ui-spec.md).

## 1. Existing surfaces to extend

| Existing file or database function | Reuse and exact missing work |
|---|---|
| `src/server/supabase.ts`: `requestSupabase`, `serverSupabase`; `src/server/auth.ts`: `getCurrentAccount`, `requireAccount` | Keep verified user JWTs and current database session/role checks for commands and content authorization. Storage credentials do not authorize a business action. |
| `src/server/http.ts`: `allowedOrigin`, `readJson`, `safeError`; `src/app/api/v1/[...path]/route.ts` | Reuse strict JSON registries, same-origin mutation checks, idempotency and safe errors. Add a dedicated Node-runtime content route for bounded binary streaming; never feed bytes through `readJson`. |
| `src/server/config.ts`: `parseServerConfig`, `publicConfig`, `integrationStates` | Existing modes are `CALENDAR_ADAPTER=fake\|google` and `FILE_SCAN_ADAPTER=fake\|clamav`; fakes are limited to isolated development/test. Required Google/scanner variables are checked but not yet returned as typed private configuration. Add private sections without changing the public allowlist. |
| `src/server/private-identifiers.ts`: `createIdentifierCipher` | Reuse the key-rotation design, not its payout/refund identifier context or 256-byte identifier format. Add a separate provider-token cipher with domain-separated HKDF/AAD and bounded token payloads. |
| `src/worker/claims.ts`: `claimJobs`, `completeJob`, `failJob`; `src/worker/execute.ts`: `executeLeasedJob`, `JobHandler` | Preserve lease-token fencing, reconciliation before redispatch, and unknown outcomes. `src/worker/index.ts` has no `calendar.sync` or `files.scan` handler yet. Existing booking transactions already enqueue `calendar.sync`. |
| `src/worker/auth-invitations.ts` | Reuse the narrow worker prepare/finalize pattern and provider reconciliation discipline, not its Auth-specific privileges. |
| `src/worker/statement-import.ts`: `statementImportHandler`, `StatementFileReader` | Inject a real bounded private Storage reader. The current default returns no bytes and records `awaiting_file_bytes`; do not relabel that result as a completed import. |
| `src/server/providers/manual-statement.ts`: `parseManualStatement`, `statementLimits` | Keep actual SHA-256 checks, CSV bounds and PDF/manual-review behavior. Parsing still never establishes settlement. |
| `src/modules/booking/scheduling.ts`: `formatCairoInstant`, `resolveCairoLocalTime`, `validateScheduledInterval` | Reuse UTC/Cairo and ambiguous/skipped-time handling; do not introduce machine-local timezone conversion. |
| `src/modules/booking/queries.ts`; `src/components/booking/customer-bookings.tsx`; `src/components/booking/shared.tsx`: `SessionTime`, `CairoTimestamp`, `useBookingRecord`, `ReadState` | Current customer enrollment has `meeting_status` and an empty `authorized_file_ids` projection. Add scoped material and meeting reads, polling/countdown and explicit simulated/live states. |
| `app_private.require_actor`, `require_role`, `assert_learner_scope`; current booking assignment and enrollment helpers | Every new RPC must recheck current authority before replay. Guardian materials access uses `materials`; payment evidence uses `payments`; meeting access uses `booking`. One scope does not imply another. |
| `app_private.occurrences`, `booking_apply_schedule`, `booking_try_confirm_locked`, cancellation/amendment/transfer event producers | Keep the canonical meeting states `not_requested\|pending\|ready\|failed\|revoked`. Current occurrence/version and assignment determine the desired provider action; an old event payload is not current authority. |
| `app_private.files`, `payment_source_immutable`, `payment_assert_file`, `payment_file_dto`, `api.list_payment_evidence` | T06 has immutable metadata with legacy `scan_state`, not an upload pipeline. Add the lifecycle below and replace every direct clean-state predicate with the authoritative current-file helper. Metadata-only fixture rows remain nondownloadable. |
| `tools/supabase-local.ts`, `supabase/config.toml`, database/worker grant verifier | Local Supabase Storage is running; no application private bucket is provisioned by the current source. Add idempotent private-bucket setup and exact narrow worker-function grants. Never reset existing data. |

Pinned dependencies at this preparation point include `@supabase/supabase-js 2.119.0`, Supabase CLI `3.1.0`, Node runtime `24.22.1`; no Google or scanner SDK is installed. This document installs or upgrades nothing.

## 2. File identity, upload and immutable scan history

The existing `app_private.files` row has immutable `id,uploader_account_id,learner_id,charge_id,parent_type,parent_id,purpose,object_key,object_version,checksum_sha256,detected_mime,byte_size,scan_state,source_provenance,created_at`. Its immutable trigger rejects updates, including scan-state updates. Preserve that contract and all referenced evidence.

Add these private records, with RLS, explicit ownership/grants, immutable history and no browser table access:

| Record | Grain and state |
|---|---|
| `file_upload_intents` | One future file ID; immutable declared filename/type/size/hash and resolved parent, uploader/session, purpose/action, learner/charge. A separate versioned lifecycle records `created\|uploading\|uploaded\|finalized\|rejected\|expired`. |
| `file_upload_attempts` | One bounded PUT attempt, server-generated opaque object generation, lease and observed bytes/hash/type. Append terminal observations; one complete adopted object per file ID. |
| `files` | Insert only after an actual complete object has passed size/type/hash/archive validation. New rows start with immutable legacy `scan_state='pending'`; the new access projection supplies current state. |
| `file_scan_attempts` / `file_scan_results` | Immutable job/attempt, exact object generation/hash, adapter mode, engine/signature version, timestamps, and `clean\|infected\|error\|unknown` observation. Duplicate result identity is idempotent; late results cannot supersede a newer scan generation. |
| `file_access_states` | Current scan-result pointer, effective `pending\|clean\|quarantined`, version, withdrawal and retention state. Mutable only through narrow checked commands. An outage/error/unknown cannot produce clean access. |
| `file_publications` | Append-only publish/withdraw events for an immutable `shared_handout` file, occurrence, current assigned tutor/admin and access version. Private preparation is never silently converted into a group handout. |

`file_current_access(file_id, actor, purpose)` is the authoritative authorization/scan projection. An uploader may inspect own rejected/quarantined metadata, but nobody downloads unclean content. Assigned tutors do not see quarantined private-submission listings. Historical `synthetic_development_metadata_no_bytes` rows retain their original provenance and existing isolated financial-fixture semantics; they never acquire a storage object or a true `can_download`. Production evidence must use the real stored-object path. No customer RPC accepts a scan result, object key, uploader ID, ownership assertion or ready-state flag.

Use one private bucket, `git-tutor-private`, and opaque random file/attempt paths without names, contacts, learner IDs or purpose in the key. The application generation UUID is `object_version`; do not assume that Supabase supplies recoverable object versioning. Upload with `upsert:false`, never overwrite an adopted object. Private buckets enforce Storage access; the server-only wrapper additionally requires the narrow database authorization result. Supabase documents private-bucket access and non-overwriting standard uploads. [Private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [JavaScript upload](https://supabase.com/docs/reference/javascript/storage-from-upload).

PUT is a full bounded retry, not a new multipart-upload product. A client retries the same file identity and checksum. A timeout after Storage success is reconciled by reading the exact candidate object and checking actual length/hash before adoption. A partial attempt never appears as an attachment; an interrupted attempt can be replaced by a new immutable attempt object. Concurrent PUTs cannot adopt two objects. Do not delete retained evidence or orphan candidates under an invented retention period; record cleanup candidates until an approved retention schedule is configured.

Limits are inclusive: receipts 5 MiB; teaching material and statements 25 MiB. New review-evidence uploads adopt the receipt envelope of 5 MiB as a bounded T07 technical choice; this does not rewrite historical T06 metadata. Receipts/review evidence allow PDF/PNG/JPEG/WebP; teaching adds PPTX; statements allow CSV/PDF. Validate actual magic/type, exact byte count/hash and filename normalization (1–255 characters, no path/control characters). PPTX validation rejects path traversal, encrypted/unsupported archives, macros, external relationships and excessive decompressed size/entry count before scanning; implementation must pin and test concrete parser limits. CSV retains existing parser limits. The `SCN-FILES` clean `.txt` fixture conflicts with the authoritative teaching allowlist: use a valid synthetic PDF payload for that scenario and document the transformation; do not broaden production MIME types.

### Vercel transport extension —14 November2026

The selected host limits each function request to4.5MB. To retain the specified file limits, the same authenticated PUT route additionally accepts `Content-Range: bytes START-END/TOTAL`. Pieces are exactly3MiB except the last, aligned from offset0, with a maximum total25MiB; TOTAL must equal the existing immutable intent. The original full-body PUT remains supported. Each piece rechecks the original uploader's current session and target scope. Partial responses are202 with only `{file_id,upload_state:'uploading'}`. The last piece assembles bounded server-held bytes and applies the existing complete size/type/hash/archive validation, immutable object adoption and fresh SQL authorization before returning the ordinary200 uploaded DTO. Missing pieces or inconsistent content cannot finalize or scan. Retries keep the same intent/hash; a verified already-adopted response stops remaining piece uploads.

Staging pieces are replaceable, private and unavailable through any download route, allowing correction after a corrupt attempt. Their keys derive only from the trusted file ID/checksum and bounded index, never a caller path. They are not adopted file generations; final objects still use `upsert:false`. Before any piece write, an immutable private `cleanup.json` manifest records its version, source identity/hash/size and exact staging keys. It remains after attempted post-adoption cleanup, preserving candidates across failure, process death and concurrent late writes. Provider deletion errors emit only a safe file-ID event. Abandoned parts remain pending the approved retention schedule; see the operator reconciliation procedure in [deployment instructions](DEPLOYMENT.md). No public DTO contains these keys or manifests.

Downloads and CSV exports use bounded response streams only after existing content validation and current authorization. Private/no-store attachment headers and customer allowlists are unchanged. This is a hosting transport adaptation, not live-host acceptance evidence. [Vercel function payload and streaming limits](https://vercel.com/docs/functions/limitations).

## 3. Finite upload purpose and evidence-action mapping

The public purpose vocabulary stays `private_preparation|shared_handout|receipt|statement_evidence|review_evidence`. Add optional `evidence_action`; its finite values below resolve the internal purpose and parent. For evidence, `parent_id` is the action target, which may differ from the internal stored parent. Never accept caller-supplied `parent_type`, learner, charge, scope or internal purpose. The action resolver must be shared with `list_payment_evidence` so upload and selection cannot disagree.

| Public purpose / evidence_action | Public parent target → stored purpose / parent | Authorization at intent, finalization and subsequent use |
|---|---|---|
| `private_preparation` / null | Enrollment → `private_preparation` / enrollment | Learner or current materials guardian; current enrollment determines learner and assigned tutor. Current tutor/admin may read by assignment/role, not upload on behalf of the learner. |
| `shared_handout` / null | Occurrence → `shared_handout` / occurrence | Currently assigned tutor or admin; clean upload remains unpublished until explicit publication. |
| `receipt` / `submit_receipt` or `replace_receipt` | Charge → `payment_receipt` / charge | Current payment authority for the charge and original uploader; downstream receipt command keeps its current evidence/claim/version rules. |
| `statement_evidence` / `create_statement_import` or `record_manual_transfer` | Receiving account → `statement` / receiving_account | Current CS/admin and valid receiving account. |
| `statement_evidence` / `verify_transfer_settlement` | Transfer → its receiving account, `statement` / receiving_account | Current CS/admin; existing settlement command independently verifies evidence and money. |
| `review_evidence` / `create_receiving_account` | null → `receiving_ownership` / receiving_account, null parent | Admin; only this action allows null parent. The eventual receiving-account command consumes that uploader-bound evidence. |
| `review_evidence` / `bind_transfer_payer` | Transfer → `payer_ownership` / transfer | Current CS/admin, with existing payer qualification rules unchanged. |
| `review_evidence` / `record_transfer_reversal` | Transfer → `transfer_reversal` / transfer | Admin. |
| `review_evidence` / `propose_refund_destination` | Refund → `refund_destination` / refund | Actual authorized source payer or permitted admin, under `refund_assert_scope`; uploader-bound evidence. |
| `review_evidence` / `verify_refund_destination` | Destination version → `refund_destination_verification` / refund_destination | Current independent admin verification rules. |
| `review_evidence` / `reconcile_refund` or `record_refund_reversal` | Refund attempt → `refund_outcome` or `refund_reversal` / refund_attempt | Admin; cash outcome remains independently evidenced and transactional. |
| `review_evidence` / `resolve_package_financing_hold` | Package purchase → `financing_hold` / package_purchase | Admin; uploaded proof does not establish source recovery. |

Unknown purpose/action pairs fail validation. Other future evidence families, including T08 payouts and T13 exports, require their own explicit additions; a generic `review_evidence` escape hatch is forbidden. Evidence content access inherits the existing actual payer/current claimed case reviewer/admin boundary, not broad CS role access. Statement/ownership/private operational files are staff-only. This upload path grants neither a CS claim nor financial approval.

## 4. File RPC, HTTP and DTO contract

All JSON schemas are strict. UUIDs, SHA-256 lowercase hex, UTC instants and positive bounded versions follow existing validators. Mutations include `p_idempotency_key`; versioned operations include `p_expected_version`. Actor/current object scope is checked before replay. `C` means the established `{command_id,resource_id,version}` envelope.

| HTTP / SQL API | Inputs after `p_` prefix | Result |
|---|---|---|
| `POST /api/v1/files` / `create_file_upload` | `purpose,parent_id,filename,declared_type,size_bytes,checksum_sha256,evidence_action=null,idempotency_key` | `C + {file_id,upload_path}`; 201 new / 200 replay. `upload_path` is same-origin `/api/v1/files/{id}/content`, never a Storage URL. |
| `PUT /api/v1/files/{id}/content` | Bounded request bytes, authenticated original uploader, same checksum identity | `{file_id,upload_state:'uploaded',size_bytes,checksum_sha256,version}` after trusted adoption; repeat identical complete bytes returns the same adopted identity. No scan success implied. |
| `POST /api/v1/files/{id}/complete` / `finalize_file_upload` | `file_id,checksum_sha256,idempotency_key` | `C + {scan_state,scan_job_id}`; 202 newly queued / 200 replay. Requires adopted actual bytes. |
| `GET /api/v1/files/{id}` / `get_file` | `file_id` | `FileView`, scoped metadata. |
| `GET /api/v1/files` / `list_files` | Exactly one `enrollment_id` or `occurrence_id`; optional `purpose,cursor,limit` | `Page<FileView>`, current scope; immutable `(created_at,id)` descending cursor, limit 25/default and 100/max. Payment evidence continues its action-specific existing selector. |
| `POST /api/v1/files/{id}/publish` / `publish_shared_file` | `file_id,expected_version,idempotency_key` | `C + {publication_state:'published'}`; clean current assigned-tutor/admin only. |
| `POST /api/v1/files/{id}/withdraw` / `withdraw_shared_file` | `file_id,reason,expected_version,idempotency_key` | `C + {publication_state:'withdrawn'}`; immediately removes current shared access. |
| `GET /api/v1/files/{id}/content` | No caller Storage key or destination | Reauthorize current session/scope/scan/publication immediately before streaming the exact stored generation. Attachment disposition, `nosniff`, private/no-store, no public CDN or signed URL. |

```ts
type FileView = {
  file_id: UUID; purpose: PublicFilePurpose; filename: string;
  detected_type: string | null; size_bytes: number; created_at: Instant;
  upload_state: 'created'|'uploading'|'uploaded'|'finalized'|'rejected'|'expired';
  scan_state: 'pending'|'clean'|'quarantined';
  publication_state: 'private'|'unpublished'|'published'|'withdrawn';
  integration_state: 'simulated'|'verification_required'|'verified';
  source_provenance: 'stored_object'|'metadata_only';
  version: number; can_download: boolean; can_publish: boolean;
  content_path: string | null; safe_error_code: string | null;
};
```

Metadata omits object keys, storage credentials, scan-engine output, other learners, payment identifiers, compensation and internal notes. `can_*` values are server-derived hints; actions still authorize again. Permission failures return existing non-disclosing errors.

Private worker/server functions are separate from exposed RPCs: `prepare_file_content(file_id,actor_session_reference)` obtains a checked one-attempt write lease; `record_file_object(file_id,attempt_id,lease_token,observed_object)` accepts trusted actual observations only; `prepare_file_scan(file_id,job_id,lease_token)` returns the exact immutable object descriptor; `finalize_file_scan(file_id,scan_generation,job_id,lease_token,observation)` fences stale results. The authenticated server obtains its actor/session reference through the original user-JWT authorization call; it never accepts that reference from request JSON. The restricted worker alone can attest object/scan observations, and finalizers recheck saved actor/session/scope where applicable. A customer cannot call an attestation RPC via PostgREST.

Register `files.scan`, use IDs-only outbox payloads, and supply the same immutable object reader to `statementImportHandler`. A previous `awaiting_file_bytes` import result remains history; a new explicit import command/job after a real file is available uses current evidence and does not overwrite the old result. Notification events `preparation_ready` and `handout_ready` are durable T07 outputs; external delivery belongs to T09.

## 5. Scanner adapter

Implement a server-only `ScanAdapter.scan({file_id,object_version,checksum_sha256,bytes})` returning `{outcome:'clean'|'infected'|'error'|'unknown',engine_version,signature_version,reference,safe_error_code}`. The trusted worker obtains bytes; no scanner URL or arbitrary filesystem path comes from customers. Verify the immutable hash before and after any temporary-file boundary.

Fake mode uses persisted deterministic scenarios keyed by scan generation, selected only by guarded development fixtures. It exercises clean, quarantine, outage, timeout-after-result and stale-result ordering with real uploaded synthetic bytes. Its clean result is visibly simulated; it is never a live malware-scan attestation.

For `clamav`, interpret `FILE_SCAN_URL` as an approved private `tcp://host:port` clamd endpoint (or explicitly supported local socket), not an assumed undocumented HTTP API. Stream bounded bytes using ClamAV `INSTREAM`; cap time, response length and in-flight requests. A timeout, stale signatures or unavailable scanner leaves access quarantined and an owned retry task. Clamd TCP is not an authenticated Internet service; deploy it on the private worker network and refresh signatures operationally. [ClamD protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html).

## 6. Calendar connection, adapter and projection

Add `app_private.provider_connections` with separate immutable encrypted credential versions and mutable connection status; add `calendar_events` (one active organizer/event mapping per occurrence), immutable `calendar_attempts`/observations and immutable meeting-generation replacement decisions. Save organizer identity, configured calendar ID, granted scopes, consenting admin, credential key ID and connection version. No refresh/access token is returned in a public or admin DTO or written to logs/outbox payloads.

Google authorization uses the approved exact redirect URI, single-use ten-minute state bound to current admin/session, PKCE, scopes `openid`, `email`, `https://www.googleapis.com/auth/calendar.events`, and offline access. Callback rechecks the same current admin/session before binding tokens. Missing refresh token on reconnect preserves only an existing valid matching credential; it never invents a connected state. Key rotation uses provider-specific AAD containing connection ID and credential version. The official web-server flow describes offline refresh-token authorization; the official Node authentication library is the proposed SDK, to be version-verified and pinned when implementation starts. [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [official Node auth library](https://github.com/googleapis/google-auth-library-nodejs).

| HTTP / SQL API | Exact boundary |
|---|---|
| `GET /api/v1/calendar/connection` / `get_calendar_connection()` | Admin-only `{connection_id:UUID\|null,version,mode:'fake'\|'google',state:'not_connected'\|'connected'\|'reauthorization_required'\|'revoked',integration_state,organizer_masked_email:string\|null,last_verified_at:Instant\|null,safe_error_code:string\|null}`. No token/calendar secret. |
| `POST /api/v1/calendar/connect` | Admin creates durable OAuth state/PKCE record using the current JWT, then returns `{authorization_url,expires_at}`. Fixed configured provider/redirect only. Fake mode explicitly creates a simulated organizer connection without external consent. |
| `GET /api/v1/calendar/oauth/callback` | Server-only code exchange; no browser RPC taking arbitrary tokens. Restricted finalize records encrypted credential observations under the current admin-bound state. Redirect to fixed admin integration page. |
| `POST /api/v1/calendar/connection/revoke` / `revoke_calendar_connection(connection_id,expected_version,idempotency_key)` | `C`; immediate local denial/dispatch invalidation, separately audited best-effort provider revocation. Unknown external revocation remains visible. |
| `POST /api/v1/occurrences/{id}/meeting/retry` / `retry_meeting_provisioning(occurrence_id,expected_version,idempotency_key)` | Admin `C + {job_id}`; 202 new. Reconcile current event before redispatch. |
| `POST /api/v1/occurrences/{id}/meeting/replace` / `replace_meeting_access(occurrence_id,reason,expected_version,idempotency_key)` | Admin `C + {meeting_generation,job_id}`. Persist explicit replacement decision; revoke old portal generation immediately. Does not assert that a copied provider URL is unusable. |
| `GET /api/v1/occurrences/{id}/meeting` / `get_occurrence_meeting(occurrence_id,view='customer',learner_id=null)` | `MeetingView`; explicit tutor/admin view checks current assignment/role. Customer view remains the default for dual-role accounts. |
| `GET /api/v1/occurrences/{id}/meeting/access` / `get_meeting_access(occurrence_id,view='customer',learner_id=null)` | Fresh authority check; `{occurrence_id,occurrence_version,meeting_generation,join_url,integration_state}` only if ready and currently permitted. No persistent public redirect/cached URL. |

```ts
type MeetingView = {
  occurrence_id: UUID; occurrence_version: number; meeting_generation: number;
  start_at: Instant; end_at: Instant; server_now: Instant;
  meeting_status: 'not_requested'|'pending'|'ready'|'failed'|'revoked';
  integration_state: 'simulated'|'verification_required'|'verified';
  can_join: boolean; join_path: string | null;
  reason: 'NOT_CONFIRMED'|'PROVISIONING'|'AUTHORIZATION_REQUIRED'|'ACCESS_REVOKED'|
    'PROVIDER_FAILED'|'LIVE_VERIFICATION_REQUIRED'|'SESSION_ENDED'|null;
};
```

The customer requires current confirmed enrollment and booking authority; the tutor requires current assignment. Cancelled/expired/removed seats, revoked guardians, former tutors and invalid sessions cannot retrieve access. Completed/cancelled occurrences cannot join. Do not invent a commercial early-join window: confirmed ready future meetings remain available, with a countdown to start. A fake ready room uses a clearly labelled simulated preview; it is not represented as a usable live class. Live customer access requires the controlled provider configuration/admission check; admin pilot inspection remains scoped and explicit.

`CalendarAdapter.reconcile(desired)` and `CalendarAdapter.apply(desired)` take a server-owned descriptor: occurrence ID/current version, connection/credential version, calendar ID, provider event ID, meeting generation, conference request ID, desired action `upsert|cancel`, UTC start/end, current tutor verified email and safe title. They return an observation `{outcome:'absent'|'pending'|'ready'|'failed'|'unknown'|'revoked',provider_event_id,etag,join_url,safe_error_code,observed_at}`. Private provider references are stored; ordinary meeting DTOs omit them.

Derive Google event ID as `gt` plus the occurrence UUID without hyphens; save it before dispatch. Save a new conference request UUID only for a new meeting generation. Retries use the same identities; a genuine replacement uses a new conference request on the existing occurrence event, with history. Google supports caller-defined base32hex event IDs and conference creation status; conference request IDs distinguish new requests. [Event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [event creation](https://developers.google.com/workspace/calendar/api/guides/create-events).

Use `events.get` to reconcile, `events.insert(...conferenceDataVersion=1)` when verified absent, and GET plus ETag-guarded `events.update` to change existing times/attendees/conference data. Never recreate an event because a timeout omitted the response. Cancellation uses the existing event identity with `events.delete`; a repeated absent/deleted result is reconciled. Keep organizer/current tutor as the only attendees and app-specific portal links in safe content; no learner names, group email lists, fees, notes or payment details. [Get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get), [insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [update](https://developers.google.com/workspace/calendar/api/v3/reference/events/update), [delete](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete).

Private worker seams: `prepare_calendar_sync(occurrence_id,job_id,lease_token)` validates the actual queued aggregate/version and returns current desired state; `finalize_calendar_sync(occurrence_id,expected_occurrence_version,connection_version,meeting_generation,job_id,lease_token,observation)` stores immutable observation and applies it only if all current versions still match. An old observation may be retained but cannot restore readiness/access after reschedule, reassignment, cancellation or connection revocation. Queue a current sync when stale completion leaves a mismatch. Do not hold database locks across network calls.

Canonical `meeting_status` never gains an `unknown` value. Unknown is a provider-attempt outcome; the current meeting stays pending/failed and cannot expose an unverified link. `pending` conference creation schedules bounded polling/reconciliation without a second insertion. Existing outbox lease recovery remains authoritative. Fake scenarios persist provider-side state so a new process can reconcile timeout-after-success, duplicates and out-of-order observations. Only trusted fixture controls select scenarios; never HTTP request bodies.

## 7. Local operational dependencies: GT-305, GT-306 and GT-405

These cases cannot be claimed from file/calendar handlers alone. Current source has no durable future-series grouping, unavailability ownership queue or completed tutor-reassignment workflow. The following is the bounded local supplement; implement and test it before claiming the respective case complete.

| Case | Required transaction/UI surface and ordinary decision |
|---|---|
| GT-305 — tutor suddenly unavailable | `report_tutor_unavailability(tutor_id,from_at,to_at,reason,expected_version,idempotency_key)` by current tutor for self or admin; append an availability incident and block new admissions in the interval under tutor-first locking. Create one affected-occurrence case per future nonterminal assignment with an explicit owner (initially the authoring admin or designated admin queue owner), without changing completed meetings or money. Admin `assign_unavailability_case(case_id,owner_account_id,expected_version,idempotency_key)` and paginated `list_unavailability_cases` expose owner/status. Resolve cases only by a referenced genuine reschedule, reassignment or cancellation outcome; do not auto-cancel and invent financial remedies. |
| GT-306 — selected occurrence versus future series | Add immutable `occurrence_series_members` grouping independently scheduled occurrences; Calendar still uses one event per occurrence. An admin change set explicitly freezes selected IDs/versions or a future-from selection, with per-occurrence proposed UTC interval and current policy/consent references. `create_series_change_set(series_id,selection,changes,idempotency_key)` returns a versioned set of ordinary operation-proposal IDs; each consumption uses existing authorized reschedule transactions. Results are per occurrence, with no false all-success claim after a partial conflict. Exclude completed/in-progress factual records and preserve attendance, original charges and immutable history. No provider recurring-event bulk edit. |
| GT-405 — tutor replacement revokes saved material access | Add a reviewed `tutor_reassignment` operation supplement with source assignment/version, destination tutor, availability proof, compatible exact fee agreement and scoped customer/old/new tutor terms. Reuse immutable proposal/consent, current fee-approver and booking/financial lock rules; commit only after genuine required consent. Update assignment atomically, enqueue current calendar/material events and immediately invalidate old tutor retrieval/queued delivery. Preserve prior agreement, completed credited tutor and future T08 earning history. This is not a raw `tutor_id` edit. |

For parallel planning, proposed operational read items are `{case_id,occurrence_id,start_at,end_at,owner_account_id,status:'open'|'resolved',version,resolution_proposal_id:UUID|null}` and `{change_set_id,series_id,state:'proposed'|'partially_committed'|'committed'|'closed',items:[{occurrence_id,proposal_id,base_version,state}],next_cursor}`. Case lists and change-set items must page; initial creation is bounded to 100 selected occurrences and explicitly rejects a larger selection rather than silently truncating. The reassignment supplement needs a dedicated contract review against T06 transfer/cancellation helpers before coding, because existing transfer moves learners, not tutor assignments. These dependencies are visible scope, not acceptance passes or a reason to delay independent files/calendar work.

## 8. Verification and external boundaries

Planned checks below are **not executed T07 results**. Keep the original acceptance catalogue unchanged until its required layers execute with the implementation commit SHA, exact command, timestamps and run-owned artifacts.

| Planned evidence | Required checks / dependency |
|---|---|
| `tests/integration/files.test.ts` plus HTTP tests | Actual private Storage bytes, no public objects, MIME/size/hash/PPTX rejection, immutable object/scan history, guessed IDs, uploader/guardian/current tutor/reviewer authorization, explicit publication, current revoke/logout, metadata-only denial. Generated customer DTOs, provider content and filenames must never copy private compensation or internal fields. |
| `tests/integration/calendar.test.ts` and provider-contract tests | One event/room after timeout-after-success and duplicate work; stale reschedule/reassignment/cancel/connection observations cannot publish; credential reconnect; current tutor-only attendee set; no stale room delivery. |
| Recovery tests | Interrupted PUT identity replay, Storage-success/DB-ack-loss reconciliation, scanner outage/retry, expired worker lease, crash after provider success and stale result fencing. |
| `tests/e2e/session-materials.spec.ts` | Independent customer/guardian/tutor/admin sessions, private versus shared material, visible scan/simulated state, countdown/current schedule, revoked access, responsive/RTL/accessibility review. Use installed Playwright CLI for actual browser inspection/screenshots/console/network alongside executed tests. |
| GT-301/302 | Existing Cairo scheduling checks are reusable evidence inputs; rerun owning boundary tests when integrations affect schedule/cutoff consumption. They do not substitute for GT-305/306. |
| GT-401/404/406/407 | Locally achievable with real Storage, fake provider controls and actual authorization/recovery checks. Map exact required layers from the catalogue before recording results. |
| GT-305/306/405 | Require the operational supplements above. A guarded historical completed fixture can prove immutability before T08; it cannot prove a real T08 completion workflow. |
| GT-402 | Local credential failure/reconnect/replacement and durable deduplicated change events are T07. Actual once-per-participant application notice delivery requires T09 recipient resolution, templates, delivery/reconciliation and current-authorization checks. |
| GT-403 | App revocation is locally testable. Preventing admission through a copied old Meet invitation requires a controlled live organizer/license/host/admission test, including removed and external accounts. Calendar deletion/replacement alone is not evidence of provider admission denial. |

Live prerequisites: approved Google organizer/Calendar ID, OAuth app/redirect/scopes and usable credentials, provider licensing/host/admission configuration, private production Storage and secret separation, an available supported scanner with fresh signatures, and separately configured T09 delivery. These credentials/configuration are not supplied by synthetic fixtures. The deployment readiness record must distinguish `simulated`, `verification_required` and evidenced `verified`; configuration presence is not a passed pilot. Retention approval, complete backup/restore and production release checks remain T13 dependencies.

Official documentation was consulted on 11 November 2026, including the [Supabase changelog](https://supabase.com/changelog.md), the API links above and [Storage download](https://supabase.com/docs/reference/javascript/storage-from-download). Current repository versions remain pinned; recheck official SDK documentation and pin any new dependency at implementation time. No provider call, malware scan, upload, browser scenario or acceptance test was performed for this preparation document.

## 9. Bounded parallel implementation sequence after checkpoint

1. **Files/Storage lane:** additive immutable lifecycle and action resolver, strict file module/DTOs, private Storage wrapper and authenticated streaming, actual receipt/statement bytes, scanner fake/live port, direct-RPC/HTTP/recovery tests. Own `src/modules/files`, file migrations and `tests/integration/files.test.ts`.
2. **Calendar lane:** provider credential/OAuth boundary, calendar mapping/history and narrow worker functions, deterministic fake plus live adapter, current-version reconciliation and provider-contract tests. Own `src/modules/teaching/meetings.ts`, calendar adapters/migrations and `tests/integration/calendar.test.ts`. Coordinate worker registration/config changes through one integration owner.
3. **UI/integration lane:** thin HTTP routes, uploads/materials/evidence selectors, countdown/meeting states and admin connection/recovery screen; separate operational dependencies GT-305/306/405 with frozen consent contracts. Own UI/browser checks; keep customer DTO imports free of provider secrets and compensation.
4. **Checkpoint owner:** coordinate additive migration windows and exclusive mutating test lanes; review grants, fake/live gates, source confidentiality and T06 evidence compatibility. Run focused checks, independent review and scoped commit; update implementation status with actual commands/results and remaining T09/live dependencies. No T07 success is inferred from this document.
