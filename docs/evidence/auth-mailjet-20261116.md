# Owner Auth email delivery — 16 November 2026

The owner explicitly requested Auth tests to `gittutor2@gmail.com`. Exactly two requests were executed against the separate production Supabase project `yuchmvnijdmyfhohlnmx`, using its configured Mailjet SMTP service. The testing preview and its fake/manual queue were untouched. No customer or tutor message was sent.

## Executed checks

| Check | Observed result |
|---|---|
| Mailjet dashboard | Free plan,6,000/month,200/day;3 total messages after the two Auth tests, including the previously approved SMTP test. No purchase or upgrade. |
| Mailjet account tracking | Open/click tracking both disabled, saved, reloaded and checked false at23:11:54UTC. Auth sends began after23:22UTC, beyond the documented10minute propagation interval. |
| `node --max-old-space-size=384 --import tsx .local/production-setup/verify-backend.ts` before tests | Passed8 checks,154 migrations,35 restricted worker RPCs;0 accounts/imports/postings/jobs. |
| PowerShell parser validation of `.local/production-setup/test-auth-delivery.ps1` | Passed,0 syntax errors. |
| `powershell -NoProfile -File .local/production-setup/test-auth-delivery.ps1` | Exit0. Supabase `inviteUserByEmail` accepted at23:22:13.369UTC; `resetPasswordForEmail` accepted at23:22:15.265UTC. Original templates restored and SMTP/origin/closed-signup settings verified unchanged. Each send has a durable attempt file; rerunning cannot duplicate it. |
| Invitation in owner Gmail | Received in **Spam** at01:22Cairo. Actual subject **You've been invited**, body heading **Git Tutor Auth invitation test** and expected bounded test content. The requested custom invitation subject was not reflected in this first message despite Management API readback; no unsupported explanation or subject-change verification is claimed. |
| Recovery in owner Gmail | Received in **Spam** at01:22Cairo. Subject **Git Tutor Auth recovery test**, expected bounded content. Gmail details show Mailjet mailed-by/signed-by domains and TLS. |
| Mailjet delivery dashboard | Both exact messages show **Delivered** to the owner. This is separate from Gmail's observed Spam classification. |
| `node --max-old-space-size=384 --import tsx .local/production-setup/verify-owner-auth-test.ts` | Passed. Exactly1 unconfirmed owner customer account,0 staff roles,0 fixtures/imports/financial postings/jobs,0 unsafe private tables and35 worker RPCs. The legitimate owner Auth record is retained; the earlier empty-account baseline is now superseded. |

The clean project's current Auth origin is `http://localhost:3000`; the existing hosted preview uses a different database. The controlled tests therefore used temporary code-only email bodies, with no link to the wrong backend. No code was consumed, password changed, staff permission granted, browser invitation accepted or deployed password-reset journey completed. These results verify actual Auth email dispatch and receipt only, **not a complete production sign-in/reset flow or Inbox deliverability**. Permanent Auth origin and link-flow verification remain activation work.

Private evidence: `.local/production-setup/auth-{invite,recovery}-attempt.json`, `auth-delivery-receipt-report.json`, `auth-owner-boundary-report.json`, and encrypted original-template backup. No OTP, credential, private customer record or tutor compensation is included in tracked evidence. Formal acceptance remains0 passed/147 not_run.

References: [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [invitation API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [recovery API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [Mailjet tracking](https://documentation.mailjet.com/hc/en-us/articles/51109335532571-Email-Tracking-Pixels-and-Consent-CNIL-and-Garante-Guidance).
