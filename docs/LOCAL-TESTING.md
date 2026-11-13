# Testing Git Tutor locally

Open [Git Tutor](http://127.0.0.1:3000), [Subjects](http://127.0.0.1:3000/subjects) or [Sign in](http://127.0.0.1:3000/login). The local environment uses synthetic records. Its WhatsApp, email, meeting and scanning providers are simulated; they do not send customer messages.

Synthetic sign-in details are generated in the private, ignored `.local/test-accounts.md` file. Use separate browser profiles or private windows to compare learner, guardian, tutor, customer-service and admin views. Use each account's workspace navigation to find its available features.

Suggested walkthrough:

1. Browse the curated subjects and tutor profiles. Confirm phone/WhatsApp links use the supplied contact number.
2. As a learner, review bookings, accepted tuition, packages, payments, files, notifications and support. Request an export of your own selected learner records.
3. As customer service, review assigned payment evidence and customer follow-ups, then claim and reply to a support conversation. Private notes stay within the staff workspace.
4. As a tutor, review assigned sessions, availability, files, completion records, earnings and verified payout methods.
5. As admin, review teaching/completion, payment reconciliation, payroll, finance, session/customer directories, exports, notification operations, campaign progression and team workload.

The retained development history includes deliberate failure and stress-test records, so some queues contain synthetic exceptions for review. Amounts in development are synthetic. Tutor compensation appears only in authorized tutor/admin workspaces. A payment receipt alone never marks a transfer settled. Unknown provider outcomes stay visible for reconciliation.

## Restarting the local environment

Use the pinned Node and pnpm versions in `package.json`. Docker Desktop must be running. From the repository:

```powershell
pnpm supabase:start
pnpm dev --hostname 127.0.0.1
```

Run the durable worker in another terminal:

```powershell
pnpm worker:dev
```

Do not run the worker at the same time as the automated integration/browser suites: those checks deliberately control job leases and isolated failure scenarios. Do not reset the database to restart the application. If Docker repeats its stale-runtime-socket failure, follow [the recorded recovery procedure](DOCKER-RECOVERY.md).

The complete executed checks and remaining live-provider dependencies are recorded in [implementation status](IMPLEMENTATION-STATUS.md). Production activation requires its own approved policies, accounts, provider verification and recovery targets.
