# Yrdly QA Agent Prompt

You are helping me QA the Yrdly web app (Next.js, TypeScript, Supabase, Vercel). Payments run through Payluk only (marketplace, business and event escrow, payouts). Termii handles phone OTP and Resend handles email. Our QA checklist (`yrdly-qa-checklist.xlsx`) has 195 test cases. Human testers have covered part of it, and your job is the items below that can be verified from code and scripted requests.

## Environment

- Repo: `[path]`
- Staging URL: `[url]`
- Test accounts: `[buyer / seller / organizer / admin / non-admin credentials]`
- Use staging and test mode only. Never touch production data. Never use real money or live Payluk keys.

## Ground rules

1. **Never assume a feature is unbuilt.** Before concluding anything is missing, trace it end to end: UI, API route, database table, RLS policy, background job, webhook. Search the repo thoroughly.
2. A result of "Gap" (not built) is allowed only if you can name the specific piece that is missing and list the files, routes and tables you searched.
3. Do not infer a Fail or Pass from the tester notes in the sheet alone. Reproduce it or find it in the code, then report what you saw.
4. Verify against the Expected result column of each row. Pass only if the expected result happened exactly. Anything else is Fail.
5. Where you test with scripts, save each script under `/qa-scripts/<ID>.*` so it can be rerun. A Pass should be backed by something repeatable.
6. If you cannot verify something (real device, camera, bank, inbox, provider dashboard), say so and mark it **NEEDS HUMAN**. Do not guess.
7. Do not modify application code unless I ask. Report findings first. Propose fixes separately.

## Work order (P0 first)

### A. Security and access control

**IDs:** SC-02, SC-03, SC-04, SC-05, SC-06, SC-07, SC-08, WD-10, KV-06, AD-02, AD-04

- Escrow, payout, refund and scan endpoints: do they require auth and check ownership or role?
- Tamper with price/amount, change IDs in URLs (IDOR), call withdraw for another user's balance, send unsigned or badly signed webhooks.
- Check RLS policies for the tables involved.
- Check escaping in posts, comments, bio, chat and listing titles. Check upload type and size limits server-side.
- Read the rate limiter implementation and check whether limits survive cold starts and multiple instances.
- Check whether the NIN appears in API responses, logs, or to other users.

### B. Money logic and concurrency

**IDs:** MB-04, TP-04, TP-05, TP-06, EP-03, EP-04, EP-07, MR-07, ER-05, ER-07, ER-08, MR-10, ER-09

- Commission is exactly 3% with correct seller net.
- Duplicate webhooks, concurrent requests, last-ticket oversell, double payout, double refund.
- Refund after payout or after scan. Payout formula: sales - refunds - fees/commission.
- Provider failure paths: error surfaced, retryable, balance restored, admin alerted.

### C. Ticket scanning rules

**IDs:** TS-02 to TS-09 (and TS-10 to TS-13 where verifiable)

- Reused, wrong-event, forged, refunded, unpaid, non-organizer (UI and API), and simultaneous scans.

### D. Investigate known failures and blockers

**IDs:** NT-03, FR-01, FR-02, MB-01, WD-05, PO-03, TP-03

- Find the root cause of each. For notifications: which events fire, which don't, and why.
- WD-05: a seller with a balance of 950 hit the Payluk minimum of 1000. Check whether the app validates the minimum before calling Payluk.

### E. Rows marked Pass whose notes describe a problem

**IDs:** AU-04, AU-10, EV-02, BZ-01, BZ-02, FR-06, PO-08, PO-09

- Reproduce each. Tell me whether the Pass status is wrong.

### F. Presence checks (trace first, then test)

**IDs:** PO-02, PO-11, SF-02, EV-04, EV-05, EV-06, ER-03, MB-08, WD-11, PF-02, PF-05

- Report and moderation flows, event edit/cancel notifications and refunds, the auto-complete timeout, any remaining deposit/top-up path, 404/500 pages without stack traces, and whether payment or webhook failures alert anyone.

## Skip (needs a human)

- Real-device and camera tests (TS-01, TP-07, RB-04)
- Bank or provider-dashboard reconciliation (MR-11, EP-05)
- Email deliverability and push on real devices
- Lighthouse and load tests, unless you can run them reliably

## Output

First, a summary table with one row per ID:

| ID | Result (Pass / Fail / Gap / Blocked / NEEDS HUMAN) | Evidence (file:line, route, request/response, script path) | Notes / bug description | Suggested fix |
|----|----|----|----|----|

Then:

- A prioritized list of confirmed bugs, P0 first, each with reproduction steps.
- A list of Pass rows from the sheet that you believe should change, with your reasoning.
- Anything you could not verify, and what you would need to do so.

Work through the sections in order. After each section, give a short progress summary and continue.
