# Account email checks, 22 November 2026

The invitation, signup confirmation and password recovery emails each use one application link, an English and Arabic instruction, and a text wordmark. The ordinary account invitation asks the recipient to set a password. The staff invitation explains that team access starts when the recipient accepts the invitation.

## Captured local messages

A separate Supabase Auth v2.197.0 project sent four messages to its loopback Mailpit inbox with synthetic `example.test` addresses. Each message supplied a plain-text alternative containing its callback URL. Chromium rendered each captured HTML message at 320, 390 and 760 pixels without horizontal scrolling. Each action was at least 44 by 44 pixels and remained readable with inline styles removed. The Arabic instructions rendered right to left.

| Captured email | Actual subject | Verified action |
| --- | --- | --- |
| Signup confirmation | Confirm your Git Tutor account | `email` token verified for the new account |
| Password recovery | Reset your Git Tutor password | `recovery` token verified for the confirmed account |
| Account invitation | Your Git Tutor invitation | `invite` token verified without staff metadata |
| Staff invitation | Your Git Tutor invitation | `invite` token verified with the original invitation reference preserved |

Supabase accepted each local token once and rejected its replay. The seven callback tests verified the application destinations, expired-token handling and existing provider code-exchange flow. Run `pnpm exec vitest run tests/unit/auth-recovery-callback.test.ts`. The local capture report is `.local/nov22-auth-design/auth-email-results.json`. Screenshots are in the same ignored directory.

## Hosted readback before publication

Production had the previous three application callback bodies and the intended subjects. The pilot had the three default Supabase bodies and subjects. The local config now uses the invitation subject that production already used. Run `./tools/auth-email-templates.ps1 -Target pilot` or `-Target production` with the existing project operator's `SUPABASE_ACCESS_TOKEN` for a fresh comparison. To publish the three subjects and bodies to the selected project, add `-Apply`. The command checks the project identity and site URL, then compares all six saved fields against the local source. [Supabase email templates and Management API](https://supabase.com/docs/guides/auth/auth-email-templates)

Mailjet reported the configured Gmail sender as Active, and its TLS SMTP authentication succeeded without sending a message. The preceding owner-only invitation and recovery reached Spam. Current inbox placement requires a recipient observation. Gmail specifically cautions against third-party mail using Gmail From addresses. Authenticating a domain managed by the sender allows Mailjet to verify SPF and DKIM and supports DMARC alignment. [Previous recipient evidence](auth-mailjet-20261116.md) · [Gmail sender requirements](https://support.google.com/a/answer/81126) · [Mailjet domain authentication](https://documentation.mailjet.com/hc/en-us/articles/360049641733-Authenticating-Domains-with-SPF-and-DKIM-A-Complete-Guide)
