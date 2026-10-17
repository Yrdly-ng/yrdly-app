# Yrdly-app audit fixes: Antigravity prompt pack

Source: Codex audit of `yrdly-app` (main @ b38dccf, 9 Oct 2026), 39 findings (F01–F39).

## How to use this

1. Put `AUDIT_REPORT.md` in the `yrdly-app` repo root (untracked is fine). Every prompt below tells Antigravity to read it for full detail, and also carries a short summary of each finding.
2. Paste **SHARED PREAMBLE** first, then one prompt, **in this order: A → B → C → D → E → F**. Each prompt is one whole batch (one session each).
3. **Deployment order matters for A and C.** Any migration that REMOVES access (revoking writes, dropping policies, revoking EXECUTE) must be applied only AFTER the matching code is deployed to Vercel production. Otherwise the live app breaks between the migration and the deploy. Prompts A and C are split into Stage 1 (code) and Stage 2 (migration) for this reason. Antigravity stops between stages and waits for you to say `DEPLOYED`.
4. Migrations that only FIX broken things (B, parts of D) are safe to apply any time after you approve the SQL.
5. All migrations hit the single production Supabase project (`yoiyqxtpmxnrrbqqidcs`). Every SQL file is shown in full and approved by you before it is applied.

---

## SHARED PREAMBLE (paste at the top of every prompt)

```
Invoke AGENTS.md and working.md rules for this task. Repo: yrdly-app (Next.js 15, Supabase project yoiyqxtpmxnrrbqqidcs). Work on branch `fix/audit-oct-2026` (create from main if it does not exist; otherwise continue on it). Read AUDIT_REPORT.md in the repo root for full finding detail; the finding summaries below are authoritative if the file is missing.

GLOBAL RULES
- PHASE 0 is RECON ONLY. READ-ONLY. Hard stop before any write. Report the recon in full, then continue to implementation within THIS prompt only if recon matches the findings. If recon contradicts a finding, STOP and report the contradiction instead of guessing.
- Named-file scope: edit only files listed or discovered through the caller inventory in recon. List every file you touch. Disclose any out-of-scope file before editing it.
- Batch edits per phase (3-4 files at a time without waiting for me). Stop and report ONLY when: a diff does not match scope, a verification claim does not hold up, or a gate below says STOP.
- Never print secrets or env values.
- Migrations: show the COMPLETE SQL file(s) and wait for my approval before applying. Use pg_get_functiondef / pg_policies / information_schema reads to get the LIVE definition before changing anything; do not rely on migration files alone (the audit found live and tracked definitions differ). Verify enum labels and column types from the live DB; never assume.
- After applying any migration, run `NOTIFY pgrst, 'reload schema'` and show the verification queries' literal output.
- Security tests: prove each fix by running the attack as an unprivileged role inside `BEGIN; ... ROLLBACK;` (e.g. `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"<test-uuid>","role":"authenticated"}', true);`). Nothing may commit. Paste the literal output.
- Paste `npx tsc --noEmit` output in full and unfiltered before and after (note whether .next/types exists). Do not run EAS builds. Do not trigger deployments.
- Show full git diffs before ANY commit. One commit per batch with a clear message. Do NOT push without my explicit approval.
- No prose summaries in place of literal output. Label every verification claim with the command that produced it.
- Do not touch: yrdly-mobile, the `paystack-integration` branch, or any file not required by this batch.

FINAL REPORT (end of prompt): files changed, migrations applied (names), tests run with literal output, anything NOT fixed and why, and any new risk discovered.
```

---

## PROMPT A: Database lockdown (F01–F06, F32, F19, F21, F22, F23-policy, F24, F27, F02, F03)

```
BATCH A. DATABASE LOCKDOWN. This is the most security-critical batch. The live database lets any signed-in user forge payment identity, tickets, escrow state, payout state, bookings, likes, notifications and moderation state by writing straight to tables through the REST API. Goal: move every such write server-side and make the database enforce it. This must not break the live app.

FINDINGS IN SCOPE
F01 CRITICAL: users.payluk_customer_id is client-editable and trusted immediately (payluk-onboarding.ts:47, payluk-service.ts:513). Name-only customer recovery can bind an unrelated customer's wallet. Withdrawals use this ID.
F02 HIGH: policy "Users can read all users" lets every authenticated user SELECT all columns of public.users (email, phone, provider IDs, location).
F03 HIGH: clients can set phone_verified and phone directly (verify-phone-otp page.tsx:65, auth-service.ts:283), bypassing the Termii OTP edge function.
F04 HIGH: escrow_transactions INSERT/UPDATE allowed for buyer_id OR seller_id = auth.uid() with no column or state restriction (escrow-service.ts:19).
F05 HIGH: seller_accounts and payout_requests have self-ALL policies; sellers can rewrite payout status/amount/account links and mark bank accounts verified. payout-service.ts:71 availableBalance = wallet.mainBalance ignores pending reservations. Manual withdrawal checks only an active account, not verification or cooling-off.
F06 HIGH: tickets_insert_own lets a buyer insert a ticket with status 'PAID' with no payment; live default status is PAID; insert trigger checks capacity only.
F32 HIGH: bookings INSERT policy checks only customer_id = auth.uid(); a client can insert an already confirmed/paid booking.
F19 HIGH: SECURITY DEFINER functions toggle_post_like, create_notification, remove_notification_actor accept caller-supplied actor/recipient and are EXECUTE-able by anon and authenticated.
F21 HIGH: safety_alerts UPDATE policy is `auth.uid() IS NOT NULL` for any alert; INSERT can set an approved state.
F22 HIGH: storage.objects post-images and chat-images UPDATE/DELETE policies have no owner check; brand-assets bucket allows public INSERT.
F23 (policy part only) HIGH: chat-images SELECT is open to all authenticated users, not just conversation members; chat/report buckets are public.
F24 HIGH: conversation participants can rewrite participant_ids (adding outsiders); message UPDATE guard protects only text/media_url, leaving sender/conversation identity writable.
F27 HIGH: moderation fields on events/posts are caller-controlled; posts SELECT policy is `true`, exposing withheld content. (The web's intentional behaviour of withholding a flagged event as DRAFT is CORRECT; do not change it.) The server route events/create must compute moderation status itself and ignore any client-supplied value.

PHASE 0, RECON ONLY. READ-ONLY. HARD STOP after the report.
0.1 ABUSE CHECK, SELECT-only queries on production; report counts and row IDs only, no PII:
  a) tickets with status PAID/USED that have no matching successful paid order/payment reference (and free-tier tickets listed separately);
  b) bookings with payment_status paid/confirmed status but no corresponding payment record;
  c) users sharing the same payluk_customer_id, or whose payluk_customer_id matches no customer the provider-linked records support;
  d) payout_requests / seller_accounts rows with verification or status values that were never set by a server path (compare against server code paths);
  e) escrow_transactions whose amount/status/counterparty history looks edited (updated_at far from created_at with no matching webhook event);
  f) safety_alerts approved without a moderator; conversations with participant_ids that changed (if auditable).
0.2 CALLER INVENTORY (grep, literal output): every client or server code path that WRITES to users (payluk_customer_id, phone, phone_verified), escrow_transactions, seller_accounts, payout_requests, tickets, bookings, safety_alerts, events/posts moderation fields, conversations/messages, and every call of the RPCs toggle_post_like / create_notification / remove_notification_actor / scan_ticket. Also every code path that READS other users' rows from public.users, with the exact columns used. Classify each as (a) already server-side with service role, or (b) client-side and needing a new server route.
0.3 LIVE DEFINITIONS: dump current pg_policies, triggers, grants and function bodies for all tables/functions above, plus the storage.objects policies and the folder/path convention used for post-images and chat-images uploads.
0.4 Produce a table: write path -> current mechanism -> planned server route.
STOP. Report 0.1-0.4. Do not continue until I reply `PROCEED A`.

STAGE 1, CODE (no database changes yet). After `PROCEED A`:
1.1 Add server-side API routes (service-role, authenticated via the existing getAuthenticatedUser helper, with ownership checks) for every client-side write identified in 0.2: escrow reads stay client-side, escrow writes go server; seller bank-account verification and payout state transitions server-only; free-ticket issuance server-only (verifying tier, price 0, buyer, capacity); booking creation server-side with initial status/payment_status forced; safety_alert creation (always pending) and author edits limited to allowed fields; phone_verified set ONLY inside the verify-phone-otp edge function / a server route after Termii verification; notifications created only server-side with actor taken from the authenticated user.
1.2 F01: remove name-only Payluk customer recovery from payluk-onboarding.ts; only bind a provider customer ID after verification that is not name-based (use the stored mapping, or provider lookup by verified unique identifier such as the phone/email that Yrdly verified AND confirm no other Yrdly user already holds that ID). If it cannot be bound safely, return a clear error rather than binding. Do not auto-change any existing mapping; list suspicious existing mappings in the final report.
1.3 F02: build the replacement read path for other users' profiles using only the columns the app displays (from 0.2). Preferred approach: a `public_profiles` view (security_invoker off, explicit safe column list only, no email/phone/provider IDs/precise location) and update client reads of other users to use it; own-row reads keep using the base table. Show me the exact column list before using it.
1.4 F05 balance: payout-service.ts availableBalance must subtract pending/processing payout reservations; enforce account verified + cooling-off server-side in the payout request route.
1.5 F27: events/create/route.ts must ignore client-supplied moderation status and derive it server-side (keep the PENDING_MODERATION -> DRAFT mapping).
1.6 Run tsc, show full diffs, commit on the branch. STOP and tell me to push/deploy. Wait for me to reply `DEPLOYED A`.

STAGE 2, MIGRATION (only after `DEPLOYED A`). Draft ONE migration file named with the next timestamp, `launch_lockdown_a.sql`, showing the full SQL for approval BEFORE applying, containing:
- users: BEFORE INSERT/UPDATE trigger blocking changes to payluk_customer_id, phone_verified, phone (verified phone changes), and any trust fields, unless current_user/ auth.role() is service_role/postgres; UNIQUE partial index on payluk_customer_id (check duplicates first; if duplicates exist, STOP and report); replace "Users can read all users" with own-row SELECT (+ admin) and grant the public_profiles view to authenticated.
- escrow_transactions: drop client INSERT/UPDATE policies; keep participant SELECT; add guard trigger as defense in depth.
- seller_accounts, payout_requests: drop self-ALL; participant/owner SELECT only; writes service-only.
- tickets: drop tickets_insert_own; change column default away from 'PAID' (use the correct non-paid initial state from the live enum; verify labels); keep SELECT own/organiser.
- bookings: INSERT policy WITH CHECK forcing initial status and payment_status to the unpaid/pending values; add BEFORE INSERT trigger enforcing the same.
- toggle_post_like, create_notification, remove_notification_actor: derive actor from auth.uid() (service-role callers may pass explicit actor only if the function distinguishes by role); fix search_path; REVOKE EXECUTE from anon (and from authenticated where only server code calls them).
- safety_alerts: UPDATE limited to the author for allowed fields via trigger; moderation/approval fields writable only by moderators/service; INSERT forces pending.
- storage: add owner-based checks (using the verified folder convention) to post-images and chat-images UPDATE/DELETE; chat-images SELECT limited to conversation members; brand-assets INSERT service-only; add size/type limits to buckets where missing. DO NOT make buckets private in this batch (that changes stored URLs); instead list in the final report the follow-up needed to convert chat/report media to private buckets + signed URLs.
- conversations: make participant_ids immutable by clients (trigger); messages: make sender_id and conversation_id immutable, extend the content guard to all content fields.
- posts/events: SELECT policy hides non-approved/withheld content from non-owners; moderation fields protected from client UPDATE.
Apply after my approval. Then run the attack tests inside BEGIN/ROLLBACK for EVERY finding above (forge ticket, forge booking, edit escrow amount, set payluk_customer_id, set phone_verified, read another user's email, like as someone else, create notification for someone else, approve a safety alert, overwrite another user's storage object, add an outsider to a conversation, publish moderation-approved content). Each attack must now FAIL; paste literal output. Then smoke-test the legitimate flows against the new code paths where possible and list any that could not be tested.
Report any legitimate flow that broke and fix it before finishing.
```

---

## PROMPT B: Money correctness (F09, F10, F11, F12, F13, F07, F08, F30, F16, F17)

```
BATCH B. MONEY CORRECTNESS. Failed or pending withdrawals are being recorded as successful; refunds and disputes break at the database; events can't pay out correctly.

FINDINGS IN SCOPE
F09 HIGH payluk-service.ts:~1189 withdrawToBank treats envelope status 200 as success even when data.status is pending or failed (`... || verifyResponse.status === 200`). Mock: pending, failed and successful all return success=true.
F10 HIGH event-escrow-service.ts:~189 ignores withdrawToBank's return and sets transferSuccess = true unconditionally; a rejected withdrawal marks the payout COMPLETED and sets payout_released_at, suppressing retries.
F11 HIGH event-escrow-service.ts:~115 payout revenue sums only tickets with status PAID; scanned (USED) tickets vanish; an all-scanned event returns with no payout.
F12 HIGH (inferred) events/tickets/purchase route defaults to Paystack and may attach a split subaccount; payout defaults to Payluk with different env vars and ignores prior split settlement: wrong-wallet or double payment risk.
F13 HIGH (inferred) payluk-service.ts:~1097, payout-service.ts:~372, seller/payouts/[payoutId]/retry/route.ts: every attempt creates a new timestamped provider reference; a network error after provider acceptance becomes 'failed' and retry makes a second transfer: duplicate bank debit risk.
F07 HIGH webhooks/payluk/route.ts:~501 refund handler writes status 'refunded' and refunded_at; the live schema has neither (enum rejects 'refunded' with 22P02; no refunded_at column). Errors are logged then tickets/stock are changed and 200 is returned; replays restore catalog stock repeatedly. completed/claimed handlers use only `status != completed`, letting delayed events overwrite cancelled/disputed states.
F08 HIGH legacy /api/events/cancel route cancels event and all non-USED tickets with no refunds and no payout-state check, bypassing the safer /api/events/[id]/cancel.
F30 HIGH (inferred) live finish_dispute_resolution assigns a text variable v_new_status to enum escrow_transactions.status without a cast; finalization likely fails after provider settlement.
F16 HIGH BEFORE DELETE trigger from 20261008105151_protect_paid_marketplace_listings.sql compares text tx.item_id with uuid OLD.id (42883) and uses enum labels funds_held/refunded that don't exist (22P02); it errors before it can decide.
F17 HIGH user-suspension.ts and admin/users/suspend route reference users columns that don't exist (42703); the helper returns {suspended:false} on query error (fails open); sign-in ignores the profile query error.

PHASE 0, RECON ONLY. READ-ONLY. HARD STOP.
0.1 Read the full current text of every file named above and report the exact lines for each finding. Confirm each against the code.
0.2 Live DB: enum labels for escrow status and ticket status; escrow_transactions columns; the live definitions of finish_dispute_resolution and the delete-protection trigger function; users columns (list any suspension-related columns that exist); payout tables and status enums.
0.3 Find the documented/observed Payluk transfer status values: grep existing Payluk webhook handlers and mocks for the exact strings Payluk returns for terminal success, pending and failure; do NOT guess. Report them.
0.4 Caller map for /api/events/cancel (confirm no callers), and for withdrawToBank/retry paths.
0.5 Plan: for each finding, the exact change. Flag anything requiring a new column or table (expect: payout/escrow provider reference + operation id; event order payment provider/settlement mode; suspension columns).
STOP. Reply `PROCEED B` to continue.

IMPLEMENTATION (after PROCEED B)
B1 F09: withdrawToBank returns a discriminated result {outcome:'success'|'pending'|'failed', ...}. Only the confirmed terminal-success status counts as success. Pending is persisted as 'processing' and reconciled via status check/webhook. Never mark completed on pending/unknown.
B2 F10: check the result explicitly; on failure/pending keep the payout PENDING/PROCESSING, store the provider reference and error, do NOT set payout_released_at, and keep it eligible for retry/reconcile.
B3 F11: revenue = all financially paid, non-refunded, non-cancelled tickets regardless of attendance state (PAID + USED); exclude refunded/cancelled using the actual live states.
B4 F12: record payment_provider and settlement mode (split-settled vs held) on the order/event payout record at purchase time; payout processing only pays funds genuinely held by Yrdly and not already settled via split; skip and log split-settled orders. Needs migration (show SQL).
B5 F13: persist a stable operation id/reference (deterministic from payout id + attempt group, NOT a timestamp) BEFORE calling the provider; if the provider call outcome is uncertain (timeout/network error), set status 'unknown/processing', keep funds reserved, and make the retry route first query provider status by the stored reference; only create a new attempt if the provider confirms the earlier one failed/never existed. Use the same reference on retry so the provider can de-duplicate if it supports it.
B6 F07: refund webhook uses the real model: status cancelled (or the correct live label) + disputes.refund_amount; remove refunded_at/'refunded' writes. Introduce an explicit allowed-transition map (pending -> paid -> shipped -> delivered -> completed; disputed/cancelled terminal rules) and apply it in ALL Payluk/Paystack webhook handlers via conditional updates (`UPDATE ... WHERE status IN (allowed_from)` and check rowCount). Refund/inventory side effects run only when the conditional transition succeeded (once), never on replay. If the DB update fails, return a non-2xx so the provider retries; log a durable reconciliation record, not just console.
B7 F08: delete /api/events/cancel (after confirming no callers); if any caller exists, make it delegate to /api/events/[id]/cancel.
B8 F30 + F16 + F17 migration: one file `money_fixes_b.sql` (show full SQL, then apply after approval): (a) finish_dispute_resolution with v_new_status declared as the enum type or cast explicitly; (b) the delete-protection trigger rewritten with compatible types (cast tx.item_id to match OLD.id) and real enum labels from 0.2, blocking deletion of listings that have any non-cancelled escrow; (c) suspension columns (only if absent) matching what the code uses, with a default of not suspended.
B9 F17 code: make getUserSuspension fail CLOSED for server operations (treat query error as an error the caller handles, not "not suspended"); sign-in must handle the profile query error explicitly; the admin suspend route must persist and be enforced in getAuthenticatedUser so suspended users get 403 on server routes.
B10 Tests: reuse the audit's in-memory mock approach: show pending/failed/successful withdraw mocks now yield pending/failed/success correctly; event payout with success=false stays PENDING and does not set payout_released_at; payout revenue includes USED tickets; replayed refund webhook fixture changes state once and does not restore stock twice; delayed 'completed' event cannot overwrite 'cancelled/disputed'; DB-level: run finish_dispute_resolution transaction test in BEGIN/ROLLBACK on a synthetic fixture and show it no longer errors; delete-trigger test inside BEGIN/ROLLBACK for unpaid vs paid listing.
Paste all literal outputs. Commit on branch after diffs are shown.
```

---

## PROMPT C: Tickets and QR scanning (F18, F25, F31)

```
BATCH C. TICKETS AND SCANNING. The web scanner calls a broken, unauthenticated-looking RPC; ticket credentials leak to unauthenticated callers; event creation can succeed without ticket tiers.

FINDINGS IN SCOPE
F18 HIGH: web scanner calls /api/tickets/scan -> RPC scan_ticket(text,uuid,uuid), which references nonexistent events.user_id (42703), is SECURITY DEFINER, executable by anon/authenticated, trusts p_scanner_id instead of auth.uid(), and lacks an atomic unused->used transition. The separate /api/events/checkin route is CORRECT (checks organiser, event, expiry/refund state, conditional PAID->USED update). The web scanner uses the broken path.
F25 HIGH: unauthenticated POST /api/events/tickets/verify returns ticket credentials (ticket_code/qr_data) for any valid Payluk reference (route.ts:4, ticket-service.ts:33); fresh fulfillment can return credentials too.
F31 HIGH: events/create/route.ts:~139 logs a ticket-tier INSERT failure and still returns success:true, leaving a published paid event with no tiers.

PHASE 0, RECON ONLY. READ-ONLY. HARD STOP.
0.1 Read events/[id]/scan/page.tsx, /api/tickets/scan, /api/events/checkin, ticket-service.ts, tickets/verify route, events/create route. Report exact request/response shapes of checkin vs scan so the scanner page can be switched without losing UX (success, already used, wrong event, refunded, expired, invalid).
0.2 Live DB: both scan_ticket overloads (definitions + grants). Callers of every scan RPC and of /api/tickets/scan.
0.3 Callers of /api/events/tickets/verify and what the UI does with the returned credentials (post-purchase screen? email?).
0.4 Plan. STOP. Reply `PROCEED C`.

STAGE 1, CODE
C1 F18: switch the scan page to /api/events/checkin (adapt UI state mapping, keep camera + manual entry behaviour; fix the useEffect missing-deps lint warning at scan/page.tsx:158 while there). Delete /api/tickets/scan (or make it a thin wrapper over checkin if a caller exists).
C2 F25: tickets/verify must still fulfil paid orders server-side but MUST NOT return ticket_code/qr_data. Require an authenticated session and confirm the caller is the order's buyer before returning any ticket detail; the post-purchase UI should fetch the buyer's own tickets through an authenticated endpoint/RLS-safe read. Update the UI callers accordingly and verify the purchase flow still shows the QR to the buyer.
C3 F31: make event + ticket tiers creation atomic: preferred, a single SQL function `create_event_with_tiers(...)` (service-role-only EXECUTE) called from the route, or, if that proves too invasive, a compensating delete of the event with service role and return a 500 with an actionable error if tier insert fails. Validate tier inputs (non-negative price, capacity >= 1, at least one tier for paid events) before any insert. Never return success:true on partial failure.
C4 tsc, diffs, commit. STOP and tell me to deploy. Wait for `DEPLOYED C`.

STAGE 2, MIGRATION (after `DEPLOYED C`)
Show full SQL then apply: (1) REVOKE EXECUTE on both scan_ticket overloads from anon and authenticated (or drop the broken overload entirely); (2) create_event_with_tiers if chosen in C3.
Tests: inside BEGIN/ROLLBACK as `authenticated` and `anon`, show scan_ticket is no longer callable; show checkin rejects non-organiser, wrong event, refunded, expired, and a second scan of the same ticket (atomic PAID->USED: simulate two concurrent updates and show exactly one wins); show tickets/verify no longer returns credentials without buyer auth (call the handler with a mocked unauthenticated request and a mocked other-user request); show event creation with a failing tier insert returns an error and leaves no orphan event.
Paste literal output. Commit.
```

---

## PROMPT D: Checkout reliability (F14, F15, F29)

```
BATCH D. CHECKOUT RELIABILITY. Two buyers can reserve the same listing, stock can oversell, retries can orphan paid provider escrows, and customer-recovery can time out.

FINDINGS IN SCOPE
F14 HIGH (inferred): payment/initialize/route.ts:~306 and webhooks/paystack/route.ts:~138 rely on idx_escrow_transactions_single_active_post, which is ABSENT in the live database. Parallel buyers can pass the availability read and create separate escrows for one listing. Catalog stock is updated by read/modify/write instead of an atomic decrement.
F15 HIGH (inferred): payment/initialize/route.ts:~229 and payment/webhook/route.ts:~64: a same-buyer retry cancels the local pending transaction without cancelling/reconciling the provider escrow; late success events for cancelled transactions are skipped silently (the buyer may have paid and nothing happens); stale-creation cleanup keys off original created_at; final provider-detail writes have no state condition.
F29 HIGH (inferred): payluk-onboarding.ts:~108 and payluk-service.ts:~419: missing-ID recovery makes sequential phone/email lookups and can scan every customer page twice; no ceiling or deadline, so a serverless checkout can time out. (Note: name-only recovery was already removed in Batch A; this batch bounds what remains.)

PHASE 0, RECON ONLY. READ-ONLY. HARD STOP.
0.1 Live DB: all indexes on escrow_transactions and the catalog stock tables; find the original definition of idx_escrow_transactions_single_active_post in migrations; check production data for existing rows that would violate it (duplicate active escrows per post).
0.2 Read the full checkout initialize routes, both webhooks, payluk-onboarding.ts and the lookup functions. Report exact states considered "active" and how stock is decremented today (every write site).
0.3 Check whether Payluk's API in the code base exposes a way to fetch or cancel an escrow/transaction by reference (find existing helper functions); report what exists.
0.4 Plan. STOP. Reply `PROCEED D`.

IMPLEMENTATION (after PROCEED D)
D1 Migration `checkout_reliability_d.sql` (show SQL, apply after approval): (a) partial UNIQUE index guaranteeing one active (non-cancelled/non-completed per the live enum) reservation per post/item; if 0.1 found violating rows, STOP and list them instead of creating the index; (b) an atomic stock RPC `reserve_catalog_stock(item_id, qty)` that does `UPDATE ... SET stock = stock - qty WHERE id = ... AND stock >= qty RETURNING ...` and a matching release function, service-role-only EXECUTE; (c) a `payment_reconciliation_flags` table (id, provider, reference, transaction_id nullable, reason, payload jsonb, status, created_at, resolved_at) with RLS enabled and NO client policies, for payments that arrive for cancelled/unknown transactions.
D2 Code: initialize route handles the unique-violation (23505) by returning a clear "item no longer available" response; stock changes in both webhooks and checkout use the atomic RPCs only; no read-modify-write.
D3 F15: before replacing/cancelling a pending transaction on retry, reconcile with the provider by reference: if the old one is paid/processing, do not cancel; return/attach it or flag; if unpaid and the provider supports cancellation, cancel it; if uncertain, keep the old attempt locked rather than creating a second. In both webhook handlers, a success event for a locally cancelled/unknown transaction inserts a payment_reconciliation_flags row (and notifies via the existing admin notification path if one exists) instead of being silently skipped, and returns 200 only after the flag is stored. All finalization writes use conditional updates on the expected prior state. Stale cleanup uses the lock/attempt timestamp, not created_at.
D4 F29: bounded recovery: at most 2 lookup attempts (stored mapping, then one verified-unique-identifier lookup), no full-customer-page scanning, an explicit overall deadline via AbortSignal.timeout (choose a value safely under the Vercel function limit; state the limit you found in config), and on failure return a clear retryable error. Move any heavy reconciliation to a background/cron path rather than the checkout request.
D5 Tests: (DB) inside BEGIN/ROLLBACK show two inserts of active escrow for the same post -> second fails 23505; show 10 concurrent reserve_catalog_stock calls for stock=3 succeed exactly 3 times (simulate sequentially in SQL plus explain concurrency guarantee); (code) mocked retry with paid prior transaction does not cancel it; mocked late success event creates a reconciliation flag; mocked slow lookups hit the deadline and return the retryable error without scanning pages.
Paste literal output; commit after diffs.
```

---

## PROMPT E: Remaining fixes (F20, F23-follow-up, F26, F28, F33–F39, F36 scoped)

```
BATCH E. REMAINING FIXES. Smaller, mostly independent fixes. Two items (F36, F23 bucket privacy) are recon-and-propose only unless the diff is small.

FINDINGS IN SCOPE
F26 HIGH: EventCreatorOnboarding.tsx:~186 and MarketplaceCreatorOnboarding.tsx:~182 say "Yrdly takes 5%" / "You keep 95%". Canonical COMMISSION_RATE is 0.03 (constants.ts:~81/89). Rendered by HomeScreen, EventsScreen, MarketplaceScreen.
F20 HIGH: supabase/functions/send-push-notification/index.ts accepts arbitrary userId/payload, fetches subscriptions with the service role and sends without authenticating/authorising the caller inside the function (deployed v15).
F28 HIGH (inferred): api/og/media/[postId]/route.ts:~40 performs fetch(src) on user-controlled image/avatar URLs with the service role and no destination allowlist, no redirect validation, no byte cap, no timeout.
F33 MEDIUM: middleware.ts:~20 redirects /login and /signup to the marketing site on EVERY host (localhost, preview, production); supabase.ts:~14 and supabase-server.ts:~28 force the production parent cookie domain on non-local hosts including previews.
F34 MEDIUM: auth/callback/route.ts:~8 safeNext accepts `/\attacker.example`, which resolves to an external host.
F35 MEDIUM: LocationContext.tsx:~55 initializes before the async home profile arrives; with no saved filter the home LGA never becomes active (label stays "All Nigeria", filter null); the persisted timestamp is never checked.
F36 MEDIUM: marketplace/business chat: new marketplace conversations are created only in `conversations`, but sending first inserts into chat_messages whose live FK requires item_chats; legacy message SELECT is sender-only; business messages are dual-written and the dedup merge keeps both copies.
F37 MEDIUM: api/directions/eta/route.ts:~42 rate limit does SELECT then UPDATE/INSERT, ignores DB errors, loses increments under concurrency; also doesn't require auth.
F38 MEDIUM: next.config.mjs:~53 removeConsole strips ALL console methods in production while payment/refund failures are only logged with console.error/warn.
F39 LOW: settings/withdraw/page.tsx:~217 icon-only Back button has no accessible name.

PHASE 0, RECON ONLY. READ-ONLY. HARD STOP.
0.1 Read all files above; confirm each finding with exact lines.
0.2 F26: list every component/string anywhere in src that states a commission/fee percentage (grep for "5%", "95%", "keep", "takes", "commission").
0.3 F33: list every redirect/cookie-domain decision, and the production hostname(s) (app.yrdly.ng; marketing yrdly.ng); report how preview hosts (e.g. *.vercel.app) and localhost:9002 should behave. Note: on production, redirecting /login and /signup to the marketing site is intentional; only non-production hosts must be exempt.
0.4 F36: map the full marketplace and business chat write/read path (tables, FKs, policies, which component writes where) and propose the smallest safe path to ONE canonical store. Do NOT implement F36 until I reply with approval; if the minimal fix is a single-site change (e.g. writing to the table the FK expects), say so.
0.5 F23: list every place chat media and report attachment URLs are stored/consumed, estimating the work to move to private buckets + signed URLs (stored paths instead of public URLs). Propose only.
STOP. Reply `PROCEED E`.

IMPLEMENTATION (after PROCEED E)
E1 F26: replace the hardcoded copy with values derived from the canonical constants (percent shown = COMMISSION_RATE*100; "you keep" = 100 minus that), and state that provider/processing fees are separate only if the code actually passes them on (check; if unsure, don't claim). Update every string from 0.2.
E2 F34: resolve `new URL(next, origin)` and require resulting origin === app origin; reject backslashes, protocol-relative and malformed paths; fall back to '/'. Add the audit's reproduction as an inline assertion output (`/\attacker.example` must now be rejected).
E3 F33: only redirect /login and /signup to marketing when the request host equals the production app hostname (read from an env var such as NEXT_PUBLIC_APP_HOSTNAME with app.yrdly.ng as default); everywhere else fall through to the app's own pages. Make cookie `domain` apply only on production hosts; use host-only cookies on preview/localhost. Show the in-memory middleware test: localhost, a preview host, and app.yrdly.ng.
E4 F35: initialize location after auth/profile readiness; preserve explicit user selections; scope persisted location by user id; honour expiry. Show the mocked-hooks reproduction now yields the Lagos/Ikeja home filter.
E5 F37: authenticate the ETA route; replace SELECT-then-write with the existing atomic consume_rate_limit RPC pattern used by payment/initialize; fail closed on error.
E6 F38: next.config.mjs removeConsole -> `{ exclude: ['error', 'warn'] }`; confirm payment/refund failure handlers use console.error/warn (list any that use console.log for failures and switch them).
E7 F39: add aria-label to the withdraw Back button; grep other icon-only buttons (`size="icon"` / buttons containing only an icon component) and add accessible names; report the list.
E8 F28: in the OG media route, allow only https URLs whose host is in an allowlist (the Supabase storage hosts for project yoiyqxtpmxnrrbqqidcs and api.yrdly.ng, plus the Google avatar host(s) actually used by the app: find them in the code), `redirect: 'manual'` (reject redirects), AbortSignal.timeout (5s), content-type must be image/*, and a response byte cap (e.g. 5MB) enforced while streaming; reject private/loopback IP literals. Show tests with mocked fetch for: allowed host, disallowed host, redirect, oversize body, timeout.
E9 F20: in the edge function, require a verified caller: either (a) service-role/system calls identified by a shared secret header or the service role key, or (b) an authenticated user JWT via getUser where the recipient is authorised by an actual relationship (e.g. same conversation/ friend/ notification they legitimately trigger); reject arbitrary userId/payload otherwise; cap payload size. Show the diff and the new function source in full; deploy ONLY after my approval, then show the deployed version number.
E10 F36 and F23-bucket: report-only per 0.4/0.5 unless I approve.
Run tsc, lint (note remaining warnings), show diffs, commit.
```

---

## PROMPT F: Fresh-build verification (run after A–E are merged)

Run this with Codex (GPT-6.1 Sol, xhigh) on a **writable checkout**, not read-only. It covers what the first audit could not do.

```
You are re-auditing yrdly-app after fixes on branch fix/audit-oct-2026 (or main once merged). The first audit (AUDIT_REPORT.md) had these limits: it could not run `next build`, the e2e suite, any browser/device check, or provider sandboxes. This pass may write to build/cache/test artefacts but must NOT modify tracked source files except to report, and must not commit or push.

1. Baseline with literal output: git status/log -1; `pnpm install --frozen-lockfile` (if needed), `npx tsc --noEmit`, `next lint`, a FULL `pnpm build` (report the real route count), and `pnpm test:e2e:smoke`.
2. Re-verify EVERY finding F01-F39 from AUDIT_REPORT.md: for each, state FIXED / NOT FIXED / PARTIAL / REGRESSED with evidence (file:line, live pg_policies/function definitions, grants, or a rolled-back attack test as `authenticated` and `anon`). For DB fixes, re-run the attack on a BEGIN/ROLLBACK transaction and paste the literal result.
3. Regression sweep of the legitimate flows, since writes moved server-side: signup/login/OTP, post creation and likes, friend requests, messaging (marketplace + business), marketplace purchase initiation, event creation, free-ticket claim, paid ticket purchase screen showing the buyer's QR, organiser scan via /api/events/checkin, booking creation, withdrawal request. Run what can be run safely; list clearly what needs a payment sandbox or a device.
4. Render checks if a browser is available: 375, 768 and 1440 px widths for home, marketplace, events, scan page, withdraw page.
5. Any NEW issues introduced by the fixes (especially permissive/ restrictive RLS that blocks legitimate users).
6. Output a new report with the same table format, a "Still open" list and a go/no-go statement for scaling users.
```

---

## What these prompts deliberately do NOT do

- Apply anything to production without you seeing the SQL first.
- Make chat/report storage buckets private (needs a stored-path migration; E proposes the plan).
- Rewrite the chat system (F36 is recon-first).
- Prove provider-side behaviour (Payluk/Paystack sandboxes): run those tests yourself for the money flows once A–D are deployed: withdrawal accepted-then-timeout, refund replay, late/duplicate webhooks, split-settled organiser payout.
