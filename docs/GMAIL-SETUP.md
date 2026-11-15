# Gmail without a domain

The owner selected Gmail on15November2026. The application now supports `EMAIL_ADAPTER=gmail`, a consumer Gmail sender and a separate Google App Password. It uses pinned Nodemailer10.5.0, certificate-validated TLS to `smtp.gmail.com:465`, finite timeouts, no pooling or automatic resend, and the existing customer-content allowlist. Files, arbitrary headers, CC and BCC are not accepted from notification input. SMTP acceptance records **sent**, not verified delivery.

## Configure the credential privately

1. Sign into the intended Gmail sender account and enable2-Step Verification.
2. Create a separate App Password named **Git Tutor** at [Google App Passwords](https://myaccount.google.com/apppasswords). Do not use or share the ordinary Google login password.
3. Run `powershell -NoProfile -File "D:\GitTutor System\tools\configure-gmail.ps1"` in Windows PowerShell. Paste the App Password at the hidden prompt. The helper stores it under ignored `.local/production-setup/gmail-app-password.dpapi`, encrypted for the current Windows account. It makes no network calls, sends no mail and does not activate a provider.
4. The deployment operator can then inject `GMAIL_SMTP_USER` and `GMAIL_APP_PASSWORD` into the selected host's secret settings. Do not commit decrypted values, put them in `NEXT_PUBLIC_*`, or configure live sending against a preview notification backlog.

Google may require a sign-in/security review for the deployment's IP. A changed Google password revokes App Passwords. [Google's requirements](https://support.google.com/accounts/answer/185833).

## Controlled verification before activation

The first proposed message is to the owner address only, subject **Git Tutor email setup test**, body **This is the approved Git Tutor email setup test. No customer records or tutor compensation are included.** Obtain approval for that exact send; then verify received content and record SMTP acceptance separately from inbox receipt. No test has been sent by preparing this guide.

Supabase Auth email is a separate SMTP configuration: host `smtp.gmail.com`, port465, sender/user equal to the Gmail account, password equal to its App Password. Configure it only on the clean production project after host/origin selection, then separately test an owner invitation and sign-in/password flow. App notification success does not prove Auth SMTP success.

Gmail has no provider send-idempotency key or signed delivery/bounce callbacks here. The stable `Message-ID` identifies an attempt for inspection; it does not prevent duplicate delivery. A lost acknowledgement remains **unknown** and cannot be blindly retried. Automated reconciliation intentionally remains unknown. Do not mark an email delivered from SMTP acceptance or treat an empty search as proof it was never sent. The existing admin operations queue shows unresolved attempts for investigation; an evidenced Gmail resolution procedure remains part of live readiness.

Personal Gmail has sending limits and is intended for a small initial operational workload, not campaigns. [Gmail sending limits](https://support.google.com/mail/answer/22839). No paid mailbox, domain, Workspace upgrade or Resend activation is required for this selected sender route.

Official implementation references: [Nodemailer SMTP](https://nodemailer.com/smtp), [Gmail configuration](https://nodemailer.com/usage/using-gmail), [message options](https://nodemailer.com/message). The installed package includes its own TypeScript declarations; no external DefinitelyTyped package is needed.
