# Mailjet bounded setup verification — 15 November 2026

## Account and live checks

- The Free signup was opened in Brave and the owner address filled. The owner completed name/password entry, terms acceptance and email activation. The Mailjet Welcome Guide then showed account activation and API-key creation completed for `gittutor2@gmail.com`.
- The supplied API/secret pair was saved with Windows-current-user DPAPI under ignored `.local/production-setup`; no plaintext credential was added to the repository.
- `powershell -NoProfile -File .local/production-setup/check-mailjet.ps1 -Mode verify` exited0. Mailjet's authenticated sender lookup returned `Active` for the exact sender; certificate-validated SMTP connection/authentication passed without sending.
- With explicit approval for one prepared owner-only email, `powershell -NoProfile -File .local/production-setup/check-mailjet.ps1 -Mode send-approved` exited0. Subject: **Git Tutor Mailjet setup test**. Body: **This is the approved Git Tutor Mailjet setup test. No customer records or tutor compensation are included.** Attempt `a6572848-928a-41f6-9d93-9779f056ed83` was accepted at20:38:15.912UTC. A durable exclusive-create attempt file prevents another send, including after an uncertain crash.
- The owner confirmed **Received in Spam**. The original SMTP outcome remains `sent`; the recipient report is separate. No signed callback or verified Inbox result is claimed.
- The owner initially selected **Keep Gmail for now; retain Mailjet ready**, then instructed **use mailjet**. The latest instruction controls: `powershell -NoProfile -File .local/production-setup/configure-auth-mailjet.ps1` exited0 and saved/read back clean production Auth SMTP at `in-v3.mailjet.com:465`, with private API/secret credentials. Closed signup, disabled anonymous/autoconfirm, Auth origins and the existing2-emails/hour limit were preserved. Gmail DPAPI/helper remain for rollback. No additional email, owner invitation, preview change or production cutover occurred.
- `node --max-old-space-size=384 --import tsx .local/production-setup/verify-backend.ts` exited0 after the change: all8 checks,154 migrations,35 restricted worker RPCs, private Storage and zero accounts/import batches/financial postings/jobs. Private `mailjet-auth-smtp-report.json`, `mailjet-auth-smtp.log` and `post-mailjet-backend.log` record this result. Auth delivery, account-level tracking settings and final-host SMTP remain unverified.

Private logs: `.local/production-setup/mailjet-verification.log`, `mailjet-owner-test.log`, `mailjet-owner-test-attempt.json`. Browser follow-up reached a signed-out page with a reCAPTCHA connectivity error; that did not prevent the separately authenticated API/SMTP checks. No challenge bypass or paid action occurred. The exact account subscription page was not inspected; the selected Free signup and official published Free limits are recorded separately from SMTP verification.

## Local application checks

| Executed command | Result |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/unit/mailjet-email.test.ts` before implementation |9 failures as expected: unsupported `EMAIL_ADAPTER=mailjet` and missing Mailjet module; `mailjet-red.log`. |
| `node node_modules/vitest/vitest.mjs run tests/unit/mailjet-email.test.ts tests/unit/gmail-email.test.ts tests/unit/config.test.ts tests/unit/notification-templates.test.ts` first implementation |34 passed/1 failed. The real Nodemailer MIME writer normalizes header-name casing; the test incorrectly required exact capitalization. No production change was needed for this case-insensitive header check; `mailjet-green.log`. |
| Same focused command after correcting header assertions |35 passed/4 files; `mailjet-green-final.log`. Covers actual generated MIME privacy, forced tracking-off headers, one-recipient envelope, malformed input, failed/unknown outcomes, no automatic replay and private configuration. |
| `node --max-old-space-size=768 --max-semi-space-size=4 node_modules/typescript/bin/tsc --noEmit` |Passed; `mailjet-types.log`. |
| `node node_modules/vitest/vitest.mjs run tests/unit` |454 passed/66 files,31.69s; `mailjet-all-units.log`. |
| `node node_modules/eslint/bin/eslint.js .` |Passed; `mailjet-lint.log`. |
| `python tools/verify-pack.py` |Passed document links/24 JSON files,147 acceptance definitions and33 synthetic scenarios. |
| `node --import tsx tools/validate-evidence.ts` |Valid;0 recorded passed/147 not_run, unchanged. |
| `git diff --check` |Passed; only the existing CRLF-to-LF normalization warning. |

No database schema, customer UI, provider SDK dependency or hosted preview runtime configuration changed. Clean production Auth SMTP changed as recorded above. Full-release CI43759579123 on source revision779180e is in progress; no final result is claimed. Formal acceptance statuses remain unchanged. The SMTP adapter has no authenticated Mailjet callback receiver or automatic reconciliation; uncertain sends need evidence before any retry. [Setup and remaining gates](../MAILJET-SETUP.md).
