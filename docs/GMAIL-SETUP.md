# Gmail without a domain

Latest15November decision: the owner subsequently instructed **use mailjet**. Clean production Auth now uses Mailjet; this Gmail configuration/evidence is retained for rollback. The Gmail App Password stays encrypted. [Current Mailjet setup](MAILJET-SETUP.md).

The owner selected Gmail on15November2026. The application now supports `EMAIL_ADAPTER=gmail`, a consumer Gmail sender and a separate Google App Password. It uses pinned Nodemailer10.5.0, certificate-validated TLS to `smtp.gmail.com:465`, finite timeouts, no pooling or automatic resend, and the existing customer-content allowlist. Files, arbitrary headers, CC and BCC are not accepted from notification input. SMTP acceptance records **sent**, not verified delivery.

Current execution: the App Password is saved in Windows-encrypted private storage; Gmail SMTP authentication passed; one explicitly approved owner-only message was accepted, and the owner confirmed receipt in Inbox. Clean production Auth SMTP settings were saved/read back, with signup restrictions and the existing rate limit preserved. Supabase invitation/recovery delivery and the eventual worker host still require their own checks. [Exact evidence](evidence/gmail-smtp-20261115.md).

## Configure the credential privately

1. Sign into the intended Gmail sender account and enable2-Step Verification.
2. Create a separate App Password named **Git Tutor** at [Google App Passwords](https://myaccount.google.com/apppasswords). Do not use or share the ordinary Google login password.
3. Run `powershell -NoProfile -File "D:\GitTutor System\tools\configure-gmail.ps1"` in Windows PowerShell. Paste the App Password at the hidden prompt. The helper stores it under ignored `.local/production-setup/gmail-app-password.dpapi`, encrypted for the current Windows account. It makes no network calls, sends no mail and does not activate a provider.
4. The deployment operator can then inject `GMAIL_SMTP_USER` and `GMAIL_APP_PASSWORD` into the selected host's secret settings. Do not commit decrypted values, put them in `NEXT_PUBLIC_*`, or configure live sending against a preview notification backlog.

Google may require a sign-in/security review for the deployment's IP. A changed Google password revokes App Passwords. [Google's requirements](https://support.google.com/accounts/answer/185833).

### If Google says the setting is unavailable

The owner initially supplied the unavailable-setting screen on15November, then confirmed2-Step Verification and the app-name/**Create** form. Credential creation, encrypted saving and SMTP authentication subsequently succeeded. For future rotation, enter **Git Tutor**, click **Create**, and use the hidden collector described above. No app needs to be added elsewhere beforehand. The earlier screenshot alone did not establish the cause.

Google also lists security-key-only2-Step Verification, organizational accounts and Advanced Protection as reasons the option can be absent. Do not use the ordinary account password, disable Advanced Protection or weaken an organization policy to bypass this. If2-Step Verification is already enabled, identify the applicable account restriction before choosing another route. Google OAuth email would require separate implementation/configuration and would not by itself configure Supabase Auth SMTP; no such fallback is currently claimed live. [Official troubleshooting](https://support.google.com/accounts/answer/185833?hl=en).

## Controlled verification before activation

The owner explicitly approved and received the first message, subject **Git Tutor email setup test**, body **This is the approved Git Tutor email setup test. No customer records or tutor compensation are included.** It was sent only to the owner. Record SMTP acceptance separately from recipient-confirmed Inbox receipt. This approval covers that one message; do not repeat it or infer approval for other recipients/invitations.

Supabase Auth email has a separate SMTP configuration: host `smtp.gmail.com`, port465, sender/user equal to the Gmail account, password equal to its App Password. These settings are saved on the clean production project; origins remain unchanged and signup remains closed. After the production host/origin is selected, separately approve and test an owner invitation and sign-in/password flow. App notification success does not prove Auth SMTP delivery.

Gmail has no provider send-idempotency key or signed delivery/bounce callbacks here. The stable `Message-ID` identifies an attempt for inspection; it does not prevent duplicate delivery. A lost acknowledgement remains **unknown** and cannot be blindly retried. Automated reconciliation intentionally remains unknown. Do not mark an email delivered from SMTP acceptance or treat an empty search as proof it was never sent. The existing admin operations queue shows unresolved attempts for investigation; an evidenced Gmail resolution procedure remains part of live readiness.

Personal Gmail has sending limits and is intended for a small initial operational workload, not campaigns. [Gmail sending limits](https://support.google.com/mail/answer/22839). No paid mailbox, domain, Workspace upgrade or Resend activation is required for this selected sender route.

Official implementation references: [Nodemailer SMTP](https://nodemailer.com/smtp), [Gmail configuration](https://nodemailer.com/usage/using-gmail), [message options](https://nodemailer.com/message). The installed package includes its own TypeScript declarations; no external DefinitelyTyped package is needed.
