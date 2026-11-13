# Shareable synthetic preview

Requested preview: `https://polo-issn-transmission-connecticut.trycloudflare.com`.

**Verified 13 November 2026:** the optimized app is running through the public HTTPS address. Actual browser sign-in passed for learner, guardian, tutor, customer service and admin. HTTPS-only/HTTP-only session cookies, identity checks, original logo, confirmed booking, exact-byte private downloads, customer payroll denial, independent transfer review, approved delivery and tutor payable checks passed. Ten public desktop/mobile states also passed with no console/page errors, warnings or failing HTTP responses. Evidence: `docs/evidence/online-check-report.json`, `online-check.log` and `online-public-inspection.json`. The complete mutating booking-to-delivery walkthrough ran locally against this same database; online checks inspected its resulting records and left the personal booking untouched.

## Launch the prepared server

The user successfully ran this in PowerShell and restarted it after the final build. Leave the terminal open. `pnpm build` passed for this handoff. The agent's original launch was rejected by automatic approval review (`blocked by policy`, no additional reason); the user completed that step, so the original HTTP 502 is resolved.

```powershell
Set-Location 'D:\GitTutor System'
$env:APP_ENV = 'development'
$env:APP_BASE_URL = 'https://polo-issn-transmission-connecticut.trycloudflare.com'
& 'C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1111-574-0_26.1111.574.0_x64__3k8sg7r9htsxt\dependencies\node\bin\node.exe' '.\node_modules\next\dist\bin\next' start --hostname 127.0.0.1 --port 3001
```

The first handoff assumed `pnpm` was available in the user's Windows PowerShell 5.1 PATH. It was not; the user reported `CommandNotFoundException`. The corrected command above invokes the verified installed Node 24.22.1 runtime and local Next CLI directly, with no new installation or global PATH change. On another machine, use its installed supported Node runtime instead of this desktop-specific path.

The development database, Auth and private Storage remain bound to loopback. The tunnel exposes only the application on port 3001. Authentication, current database authorization, private-file proxying and exact-origin checks remain enabled. Do not expose the database, email inbox or credentials. `APP_ENV=development` explicitly selects the existing synthetic/fake-provider configuration; this is not a live production deployment. The separate development server on port 3000 remains available for local testing.

The normal fake-provider worker must also run (`pnpm worker:dev`); it was restarted after the controlled demo verification. Emails, calendar meetings, WhatsApp and scanning are simulated. Captured email links currently use the local configured origin. Use the prepared logins rather than relying on email delivery to another device.

## Tunnel and lifetime

The tunnel was created with the required Cloudflare CLI:

```powershell
cf tunnels quick-start http://127.0.0.1:3001
```

`cf` version: **1.0.0-beta.14**. It installed the official cloudflared **2026.11.0** binary and verified its release checksum (`d5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a`). DNS, TCP, UDP and API prechecks passed; the tunnel registered a QUIC connection. Operational logs are private at `.local/online-preview-tunnel.log`.

This is a temporary [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/). The computer must stay awake with Docker/database, app server, worker and tunnel running. Restarting the tunnel can change the public address. Update the server's exact `APP_BASE_URL` and regenerate the private demo links if that happens. A permanent preview needs separately configured hosting and database services; no live-provider or permanent-hosting readiness is claimed.

Use the private `.local/demo/START-HERE.md` for current synthetic role logins, exact booking links and prepared files, together with [the walkthrough](DEMO-WALKTHROUGH.md). These credentials are deliberately excluded from Git. The supplied GitHub repository is private because the application source contains privileged commercial configuration.
