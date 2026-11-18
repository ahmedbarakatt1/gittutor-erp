# Try the complete flow locally

This guide uses the [local development app](http://127.0.0.1:3000) and the synthetic rehearsal verified on 13 November 2026. Generate the private `.local/demo/START-HERE.md` using the preparation command below for the role accounts, current practice booking and sample files. Use separate browser profiles for each role. The [hosted testing preview](ONLINE-PREVIEW.md) uses its own accounts and records.

The guide uses one learner throughout and a newly named **Git Tutor guided demo** tutor. The learner and guardian also have older verification records, so use the exact links in START-HERE instead of choosing an unrelated record from a long list. No previous data was removed. The private session price is the approved synthetic example, EGP 500. The published group prices remain EGP 575, 550 and 500 per learner for groups of two, three and four.

## 1. Reserve your untouched session

1. Sign in as **learner** and open **Start this exact booking** from START-HERE.
2. Select the learner in **Booking for**. Check the displayed Cairo date, tutor and EGP 500 price.
3. Check **I have reviewed the offer's price, timing and cancellation terms**, then choose **Reserve a temporary seat**.
4. Choose **Review your reservation**, review the exact quote, check its acceptance box and choose **Accept this quote**.
5. Open **View payment instructions**. The seat is still temporary. Finish the next steps before the hold deadline shown on screen; accepting a quote or uploading a receipt does not confirm the lesson.

## 2. Upload the customer receipt

1. Select the InstaPay collection account printed in the generated `.local/demo/demo-receipt.pdf`. This is a synthetic destination; do not send money.
2. Enter **500** in **Amount you transferred (EGP)** and copy the personal transfer reference from START-HERE.
3. Expand **Upload supporting evidence**, choose `demo-receipt.pdf`, then **Upload and check file**. Wait for **Check passed**. The worker performs a simulated local scan; the interface says so explicitly.
4. The uploaded file becomes the selected **Prepared evidence**. Choose **Submit receipt for review** and then **Follow this receipt**.

Expected: the receipt is ready for review and the booking remains unconfirmed until independently settled funds are applied.

## 3. Independently review the money

1. In the **service** browser profile open [payment review](http://127.0.0.1:3000/service/payments). The newly submitted learner receipt appears near the top of **Unassigned**. Choose **Claim case**; keep this case open in a tab.
2. Open **Independent incoming transfer** from START-HERE. It is a separate synthetic receiving-account entry, initially pending. Its statement and source-owner files were uploaded into private storage and checked independently of the customer receipt.
3. In **Verify settled funds**, keep the matching reference and EGP 500 amount. Enter the Cairo settlement time from START-HERE, add a verification note and select the prepared settlement evidence matching the first eight characters of its ID. Choose **Verify settled funds**.
4. Under **Find verified account**, search for the learner's exact email from START-HERE. Select that account as **Verified source owner**, select the matching **Independent ownership evidence**, give a reason and choose **Verify source owner**.
5. Return to the claimed case, choose the incoming transfer with the personal reference, compare its amount/destination/source to the receipt, and choose **Apply verified funds**. If the claim timed out, renew or claim it again before applying.

Expected: EGP 500 is allocated once to this tuition charge. The prepared tutor agreement and funded private seat allow confirmation. Refresh the learner booking to see **Confirmed** and the cleared balance. Duplicate attempts cannot create another allocation.

## 4. Review the room and share a handout

1. Keep the fake-provider worker running. After confirmation, the calendar job creates a **simulated** meeting. Refresh the booking to see the current meeting state. The fake room is not an actual Google Meet call.
2. Sign in as **tutor** and open the exact tutor session link in START-HERE.
3. Under **Class resources**, upload the generated `.local/demo/demo-material.pdf`. Wait for **Check passed**, then choose **Publish to this session**. Uploading alone does not share it.
4. Reload the learner's booking and download the published file. The linked **guardian** can open the same learner's session and materials. A learner's **Private preparation** upload is restricted to that learner, authorized guardian and assigned tutor.

The second session in START-HERE is the automated verification example. When the handoff reports a browser pass, it already has the receipt, allocated payment, confirmation, simulated meeting and downloadable class material available to inspect. Your personal session is intentionally untouched by that run.

## 5. Inspect actual approved delivery and tutor settlement

Future sessions reject factual attendance. Use the separate **Completed example** links from START-HERE to inspect the already completed past lesson, with the same learner and tutor.

Only its historical schedule/admission was seeded through the existing guarded local fixture. The setup then invoked authenticated **Record session start → Save attendance → Submit delivery for approval → Approve session delivery** commands with genuine past times. Approval created exactly one EGP 250 tutor earning. A verified synthetic destination and independently checked payout evidence then supported an EGP 150 settled payout. The expected remaining payable is **EGP 100**.

- **Tutor delivery / Admin delivery:** approved attendance and delivery record.
- [Tutor pay](http://127.0.0.1:3000/tutor/pay): EGP 250 earned, EGP 150 settled and EGP 100 remaining.
- [Admin tutor pay](http://127.0.0.1:3000/admin/pay): load/select the named demo tutor to inspect the earning, payout and private destination controls.
- **Learner record:** the completed lesson's customer view excludes tutor compensation and internal records.

This demonstrates actual local authorization, posting and settlement rules. It does not claim a real class was taught or that a real bank transferred money. To experience entering attendance yourself, do it on the personal session after its scheduled time; do not change the clock or mark future attendance.

## 6. Explore the remaining workspaces

| Role | Link | Try |
|---|---|---|
| Learner / guardian | [Packages](http://127.0.0.1:3000/learn/packages) | Choose the learner, inspect a contract and its entitlement history. New purchases require their own funding; the EGP 500 demo transfer belongs to the private lesson. |
| Learner | [Support](http://127.0.0.1:3000/learn/support) | Start a synthetic question and request human help. |
| Customer service | [Support queue](http://127.0.0.1:3000/service/support) | Claim the conversation and reply in the local website chat. |
| Learner / guardian | [My exports](http://127.0.0.1:3000/learn/exports) | Request an export of the authorized learner's own records. |
| Tutor | [My exports](http://127.0.0.1:3000/tutor/exports) | Inspect/export the tutor's own statement. |
| Admin | [Session directory](http://127.0.0.1:3000/admin/sessions) | Find the exact session identity and history. |
| Admin | [Exports](http://127.0.0.1:3000/admin/exports) | Review scoped export jobs and generated files. |
| Admin | [Finance](http://127.0.0.1:3000/admin/finance) | Inspect cash, tuition and payable movements. Overall totals include preserved stress-test history; they are not this demo's totals. |

## Preparation and verification commands

The app must be running on port 3000 with the existing local Supabase services. Use Node 24.22.1 and pnpm 11.25.0. Keep the general worker stopped while the preparation/browser command owns the database lane; these commands process only their own scan/calendar jobs. Resume the normal fake-provider worker before hands-on testing.

```powershell
pnpm exec tsx --env-file=.env.local --conditions=react-server tools/prepare-demo.ts
$env:DEMO_VERIFY = '1'
$env:NODE_OPTIONS = '--conditions=react-server'
pnpm exec playwright test tests/e2e/guided-demo.spec.ts --project=desktop --workers=1 --output=.local/demo/browser-results
Remove-Item Env:DEMO_VERIFY
Remove-Item Env:NODE_OPTIONS
pnpm worker:dev
```

If PowerShell cannot find Node or pnpm, install the pinned versions listed in the [local setup runbook](handoff/03-operations-and-release.md), reopen the terminal and check both version commands before preparing the demo.

Preparation refuses nonlocal targets, nonfake providers and a competing preparation. Repeating it reuses the saved manifest and preserves the user's progress; it does not reset records, regenerate passwords, replay the already completed lesson or spend the personal transfer. An incomplete manifest is retained for inspection instead of silently duplicating the setup. Keep `.local/demo` private and do not remove it to retry an interrupted run.

Use the generated links with the same isolated database that provided the demo records. Rewriting the hostname in a local booking link cannot transfer its account or booking to the hosted workbook preview. For the hosted environment use [its own access instructions](ONLINE-PREVIEW.md).

The optional browser check is excluded from normal suites unless `DEMO_VERIFY=1`. It uses the separate verification session and authenticates all five roles. It does not mock application responses. File scanning and calendar provisioning use the existing strict fake adapters. Once it has passed, inspect its saved result rather than spending another booking. Actual logs and screenshots are in `.local/demo-browser*.log` and `.local/demo/screenshots`; the manifest records the successful run only after every assertion passes.

Executed 13 November 2026: setup and repeat-preservation check passed; scoped ESLint and whole TypeScript checking passed; the bounded desktop browser journey passed **1/1 in 35.5 seconds** (`.local/demo-browser-fourth.log`). Earlier harness attempts are retained: two stopped at the closed evidence-upload disclosure and one navigated before the review queue loaded. The final run resumed the saved reservation, performed the remaining real actions, and confirmed the personal session still had zero enrollments. No application response was substituted to obtain the passing result.

Email, calendar, malware scanning and WhatsApp remain simulated local integrations. Real providers, approved live commercial settings and deployment are separate readiness items in [implementation status](IMPLEMENTATION-STATUS.md).
