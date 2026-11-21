# Gmail SMTP verification — 15 November 2026

The owner supplied a Google App Password for the selected sender and explicitly approved one fixed test email. The credential was entered into the existing hidden PowerShell collector and saved only as current-Windows-user DPAPI ciphertext under ignored `.local/production-setup`. No credential value is included in this report, source control or ordinary verification output.

## Executed checks

| Command or action | Observed result |
|---|---|
| `powershell -NoProfile -File tools/configure-gmail.ps1` | Exit0; hidden input saved as encrypted private storage. No email sent by the collector. |
| `powershell -NoProfile -File .local/production-setup/check-gmail.ps1 -Mode verify` | Exit0; fixed Gmail SMTP TLS connection and authentication passed. No email sent. Private `gmail-smtp-verification.log`. |
| `node --max-old-space-size=384 --import tsx .local/production-setup/verify-backend.ts` before and after Auth settings change | Both exit0; all8 database checks passed,154 migrations,35 restricted worker RPCs, verified TLS/private Storage and zero accounts/imports/postings/jobs. Private `pre-smtp-boundary.log` and `post-smtp-boundary.log`. |
| `powershell -NoProfile -File .local/production-setup/configure-auth-smtp.ps1` | Exit0; exact clean production project/organization/healthy-status guards passed. SMTP settings saved through the existing Management API connection and read back. Private `gmail-auth-smtp-report.json` and `gmail-auth-smtp.log`. |
| `powershell -NoProfile -File .local/production-setup/check-gmail.ps1 -Mode send-approved` with the explicit one-message approval flag | Exit0; one attempted send was accepted by Gmail at19:59:08.478UTC. The prepared helper persisted the attempt before dispatch and refuses to dispatch again if that attempt file already exists. Private `gmail-owner-test.log` and `gmail-owner-test-attempt.json`. |
| Owner receipt confirmation | Owner explicitly selected **Received in Inbox** after the exact test. This is recipient-confirmed receipt, separate from the adapter's SMTP `sent` outcome. |

An initial Node-path shell command had an unmatched parenthesis and stopped at PowerShell parsing before running any operation. The corrected command then executed the post-change verifier successfully. The Gmail connector could not independently inspect the Inbox because it requires reauthentication; no mailbox contents were retrieved through that connector.

## Scope

Sender and sole recipient: `gittutor2@gmail.com`. Subject: **Git Tutor email setup test**. Body: **This is the approved Git Tutor email setup test. No customer records or tutor compensation are included.** No attachments, other recipients, customer messages or compensation were sent.

The clean Supabase production project `yuchmvnijdmyfhohlnmx` now has `smtp.gmail.com:465`, the selected Gmail sender and sender name **Git Tutor** configured. Signup remains disabled; anonymous access and autoconfirm remain disabled; existing Auth origins and the2-emails/hour Auth limit are preserved. The Management API accepts and returns these settings, but an actual email originating from Supabase Auth has not been tested.

This verifies the application Gmail adapter from the local setup environment and the owner's receipt of its one approved message. It does not verify SMTP connectivity from a future worker host, Supabase invitation/recovery delivery, bounce handling, OAuth/Meet entitlement or production activation. The current testing preview remains on its existing fake/manual provider configuration; no preview backlog was dispatched. No owner account/invitation, hosting change or paid resource was created. No formal acceptance catalogue status was changed.
