# T06 private identifier server boundary

Implementation draft, 2026-11-11. Uses built-in Node 24 crypto; no new SDK. Official reference checked: https://nodejs.org/docs/latest-v24.x/api/crypto.html (createCipheriv/createDecipheriv, AAD, authenticated tag, randomBytes, HKDF).

Use an AES-256-GCM envelope `{v:1,alg:'A256GCM',kid,nonce,ciphertext,tag}` with strict canonical base64url, nonce12bytes, tag16bytes, bounded ciphertext. Encryption uses a fresh random nonce. AEAD AAD is an ordered serialized tuple binding version/purpose/channel/refund ID/destination ID/immutable identifier_version1/payer account ID. Candidate lifecycle version is separately pinned by the artifact and must not alter decryption AAD. A candidate identifier is immutable; replacing it creates a fresh ID.

`SECRET_ENCRYPTION_KEY` is a 32-byte hex master key, `SECRET_ENCRYPTION_KEY_ID` defaults to `v1`. Optional `SECRET_ENCRYPTION_PREVIOUS_KEYS` is a private JSON map of retired key IDs to hex keys for reading immutable historical destination versions. New writes use only the current key. Bound key count, reject duplicate current key ID, and never emit any key value or env input in errors. HKDF-SHA256 derives separate encryption and fingerprint keys using fixed versioned context strings. Fingerprints are opaque keyed hashes including channel; old envelopes verify fingerprints using their own kid. Rotation retains old keys until all pinned records can be read under an approved migration; no in-place rewrite of approved destination versions.

Normalization is conservative: trim/NFC, reject controls/bidi/invisible control characters, bound UTF-8 bytes, preserve identifier semantics. Do not infer bank ownership or a universally valid identifier from formatting. Safe masked output contains only a fixed prefix and last4 visible ASCII letters/digits, never full short identifiers. Channel and normalized identifier produce a keyed fingerprint; cleartext is never stored, logged or returned in ordinary responses. Independent evidence and admin approval establish ownership.

Same-origin authenticated destination creation obtains actual verified payer context/current scope from the private prepare_refund_destination_context helper before encryption. Browser supplies no payer ID, candidate ID, mask, ciphertext, verification status, fingerprint, artifact or clock. For a first submission, generate a random candidate UUID and fresh random encryption nonce. For an exact prior committed actor/command/key/refund, decrypt its retained original request and compare normalized current plaintext and all business fields; matching retries reuse the exact original encrypted request, while changed bodies conflict. Concurrent first submissions reread once on SQL idempotency conflict and reuse only the logically identical winner. Preserve full SQL request hashes and ordinary changed-body conflicts; no deterministic nonce or weakened hash.

Worker-only `read_refund_destination_for_server(actor_account_id,auth_session_id,destination_id,purpose,refund_attempt_id nullable,reason)` authenticates the live session/admin scope and writes an access audit before returning the exact envelope/digest/immutable identity plus current candidate version. `verify_candidate` allows current unverified candidates. `reveal_for_attempt` requires the exact pinned verified destination of an authorized active refund attempt. Server checks AEAD and canonical mask/fingerprint before issuing any artifact or revealing the value. An arbitrary direct-RPC envelope remains unusable.

The private artifact issuer rechecks current admin/session/resource scope first. Exact committed approval replay returns its original artifact for the identical actor/command/key/approval body before checking the lifecycle version and artifact lifetime that the prior success consumed. The public user-JWT command similarly replays the exact completed full request after current authority checks; new mutations require current candidate version/digest, canonical masked metadata, purpose, matching actor/session and independent ownership evidence. SQL hashes the allowlisted approval body including idempotency identity and computes the fresh five-minute artifact expiry. Changed bodies conflict; new operations consume one matching artifact atomically. A valid encryption artifact is not ownership proof. Test lost acknowledgements after lifecycle advance/expiry and deny revoked or demoted callers even on replay.

Required regression coverage: exact roundtrip; random distinct nonce; tampered ciphertext/tag/AAD/kid rejection; malformed/noncanonical/oversized envelope rejection; missing/rotated key safe errors; cleartext absent from serialized projections; replay with same plaintext succeeds despite randomized encryption and changed plaintext conflicts; revoked session/demoted admin/forged direct RPC cannot produce a verified candidate; one-use artifact request/version/actor binding; customer/CS raw read denied; reveal audited and pinned; unknown refund preserves reservation.

## Frozen private SQL register

These functions live in `app_private`, outside exposed schemas. Only the restricted worker login receives EXECUTE. They retain the dedicated command owner, empty search path, current verified session/resource authorization, and exact verifier registration. No raw base-table grants or service-role/browser execution are added.

```text
prepare_refund_destination_context(
  p_actor_account_id uuid, p_auth_session_id uuid,
  p_refund_id uuid, p_idempotency_key text
) -> {
  payer_account_id,
  prior_request: null | {
    p_refund_id, p_destination_id, p_channel, p_encrypted_identifier,
    p_masked_identifier, p_identifier_fingerprint, p_payee_name,
    p_source_evidence_file_id, p_expected_version, p_idempotency_key
  }
}

read_refund_destination_for_server(
  p_actor_account_id uuid, p_auth_session_id uuid,
  p_destination_id uuid, p_purpose text,
  p_refund_attempt_id uuid default null, p_reason text default null
) -> {
  destination_id, refund_id, payer_account_id, channel,
  identifier_version: 1, version, encrypted_identifier, ciphertext_digest,
  masked_identifier, identifier_fingerprint, verification_status,
  destination_version_id: null | uuid
}

issue_destination_validation_artifact(
  p_actor_account_id uuid, p_auth_session_id uuid,
  p_destination_id uuid, p_destination_version integer,
  p_ciphertext_digest text, p_masked_identifier text,
  p_identifier_fingerprint text, p_purpose text,
  p_approval_request jsonb
) -> { validation_artifact_id, approval_request_hash, expires_at }
```

Prepare accepts only the current original payer or admin, and returns a prior request only through the exact committed actor/command/key/refund match. The retained private request contains ciphertext and original safe business fields, never plaintext.

Read requires current admin authority and writes an audit before returning. Purpose is exactly `verify_candidate` or `reveal_for_attempt`; the latter requires the candidate's pinned verified version on the authorized attempt and a bounded nonblank reason. The returned `version` is mutable lifecycle state; AEAD uses only immutable `identifier_version:1`.

Issuer purpose is exactly `verify_refund_destination`. The allowlisted `p_approval_request` is `{destination_id,expected_version,evidence_file_id,decision,reason,idempotency_key}`. SQL computes its canonical hash, excluding the artifact ID. Current authority is checked before committed replay; a matching committed approval returns the original artifact ID even after expiry/lifecycle advancement, including for the same actor using a new verified active session. A new request requires the current candidate version and creates a five-minute, one-use artifact. Public business verification still runs with the actual user's JWT and hashes its complete request including the reused original artifact ID.

Executed actual transport evidence: `tests/integration/refund-private-boundary.test.ts` passed the two creation/replay tests in302.83s, including a real five-minute artifact-expiry wait, fresh verified session, current-role removal and revoked-session denial (`.local/t06-refund-private-expanded.log`). After actual refund attempts were implemented, its focused private-reveal test passed1/1 (`.local/t06-private-attempt-reveal.log`): exact pinned pending/unknown attempts only, current admin and nonblank reason, reasoned audits, no second send while unknown, no access after settlement, and no plaintext/ciphertext in customer projections. These tests use synthetic identifiers, production restricted-worker transport and genuine local Auth. They do not claim live payment-provider execution.
