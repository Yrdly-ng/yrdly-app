# Small Business Campaign Simplification

## Requested direction

Businesses should join automatically through the YRDLY Businessplace directory. There is no campaign application, approval, or rejection step. The team monitors businesses and their sales.

## Current implementation found

- Product currently asks an owner to enroll a business and filters sales through an approved campaign-participation record.
- Admin campaign tools can approve, reject, suspend, or disqualify participants, hold or clear individual sales, review results, and record prizes.
- The scoring backend already attributes each product order to its directory business and checks buyer receipt, Payluk release, campaign dates, payment environment, refunds, disputes, and duplicate orders.
- Public campaign pages still contain application/approval wording in some surfaces.

## Proposed simpler behavior

1. Automatically include active, approved Businessplace product businesses in the campaign. Existing eligible directory businesses are included too; a new eligible business appears as soon as it is created.
2. Remove join/application and approval/rejection flows and the one-business-per-owner restriction.
3. Count one point for each eligible completed product order, independent of item quantity or order value. Keep the existing payment, delivery, refund, dispute, and duplicate checks so test or reversed orders cannot inflate the standings.
4. Keep admin tools focused on viewing businesses, their counted sales, and the evidence behind a count. Remove manual score adjustment and participant approval controls.
5. Update marketing, product, mobile, and admin wording to describe automatic entry and a simple sales leaderboard.

## Implementation sequence

1. Add an additive database migration that makes eligible businesses automatic campaign participants, updates leaderboard and personal-rank queries, and removes approval from sale eligibility.
2. Update product API/UI and admin monitoring to remove enrollment and approval actions.
3. Update the marketing and mobile campaign copy and participation status.
4. Update the campaign glossary and handoff.
5. Run focused campaign database/API/UI checks and affected app typecheck/lint/build commands. Do not apply the migration to production or deploy without separate authorization.

## Approved implementation progress — 1 November 2026

The owner approved automatic campaign entry and clarified that qualifying orders are products only. Product UI now describes automatic entry, business standings, personal rank, and completed-sale counts. The admin screen is a read-only monitor; legacy participation decision and manual sale hold/clear endpoints now return HTTP 410. Finalization and prize-record routes remain separate closeout controls.

The additive migration `20261101180745_automatic_small_business_campaign_entry.sql` backfills existing eligible active Businessplace product businesses, automatically includes newly eligible businesses, removes the one-business-per-owner restriction, and exposes all owned businesses/ranks through `ownEntries`. The campaign application endpoint returns HTTP 410. Marketing and mobile copy now explain automatic entry and simple product-sale counting without an approval form.

Gaia Bakery's missing score was traced to Payluk's Unix-seconds `completedAt` being passed to Postgres as a timestamp string. The evidence normalizer now converts seconds/milliseconds to ISO timestamps before the authoritative receipt RPC. Reconciled the already provider-verified Gaia order through `finish_campaign_receipt`; the live public campaign API now reports Gaia Bakery at rank 1 with 1 completed sale. No score was manually edited.

Validation on 1 November: product campaign database/API/UI/evidence suites **30/30 passed**; mobile campaign screen **6/6 passed**; product and mobile `pnpm typecheck` passed; campaign-scoped ESLint passed on product, mobile, and marketing after the endpoint adjustment; marketing `pnpm build` passed after the endpoint change; product `pnpm build` passed (with existing warnings in unrelated app areas). `git diff --check` passed in all three repositories. The automatic-entry migration has only been exercised against the local PGlite fixture; it has not been applied to QA Staging or Production. Do not deploy the new response shape until QA has the migration.

The live public-site campaign proxy returned HTTP 503 while the product public campaign API returned HTTP 200 with Gaia Bakery at rank 1 and 1 completed sale. The product endpoint permits CORS from `yrdly.ng` and `www.yrdly.ng`; marketing leaderboard code now requests that same public API directly on those production hosts, keeping the local/preview proxy path. Marketing ESLint passed before this final endpoint adjustment; rerun the marketing build/lint before any deployment. This adjustment is local only and has not been deployed.

## QA automatic-entry rollout — 1 November 2026

Applied `20261101180745_automatic_small_business_campaign_entry.sql` to QA Staging `jxgpvvehajxegeeozlnl` under the owner's standing campaign-staging authorization. Its SQL and ledger entry committed together. A launch-blocking trigger permission issue was fixed first: normal authenticated business inserts cannot write service-only campaign tables, so the automatic-entry trigger is now a private `SECURITY DEFINER` function with empty search path, fully qualified tables, and direct execution revoked from public/anonymous/authenticated roles. A focused test proves an authenticated business insert succeeds and enters automatically while direct campaign-table insert and trigger-function execution remain forbidden.

Fresh QA read RPC verification reports the campaign active, exactly 3 eligible businesses and 3 leaderboard businesses, and the new `ownEntries` property present. Production has not received this migration. The product and marketing release must now be prepared from current remote main without overwriting the original worktrees' unrelated changes.


## Campaign production release package — 1 November 2026

- Release branches are prepared from fresh remote main in `/tmp/yrdly-campaign-auto-app` (product), `/tmp/yrdly-campaign-auto-site` (marketing), and `/tmp/yrdly-campaign-auto-mobile` (mobile), all named `ship/campaign-automatic-entry-20261101`. They contain the campaign changes and preserve unrelated original worktree changes, including the Payluk email draft. No preview deployment was created.
- Fresh remote marketing main already contains the direct public-product-API fetch fix (`6451e25`). The release preserves that fetch and changes only automatic-entry/rule copy and leaderboard labels. Earlier notes treating the proxy failure as the current deployed client's request path were too broad: the proxy still returns 503, but current main's leaderboard already bypasses it.
- Product release includes the verified Payluk timestamp normalization, automatic entry, read-only monitoring, and old mobile response compatibility (`ownEntry` and the actual owned participation record alongside `ownEntries`). Legacy mobile builds therefore keep their personal rank while new builds show every owned business.
- Added a minimal paid-ticket guard to the isolated product release: disabling Paystack can no longer fall through into legacy Payluk checkout. Payluk checkout requires explicit Staging-only flags/key/host. Existing free-ticket flow executes before paid checkout and is preserved. No payout or event-finance migrations are included in the campaign production package.
- Validation on the exact product release branch: 31 campaign tests passed before the compatibility addition; the updated 6-test campaign API suite passed with the new compatibility case (32 campaign cases in total); the paid-ticket fallback guard regression passed; final product typecheck and scoped lint passed. Mobile campaign tests 6/6, mobile typecheck and scoped lint passed. Marketing production build passed with webpack because Turbopack rejects external node_modules symlinks in temporary worktrees; source project Turbopack build passed earlier. This is a local tooling constraint, not a project configuration change.
- Authenticated QA browser check using the owner-authorized completed QA actor passed: `/campaigns/small-businesses` renders the campaign, authenticated `/api/campaigns/small-businesses/me` returns 200 with 3 leaderboard businesses and 0 owned businesses for this actor, and 390px/1440px screenshots show no horizontal overflow. Own-rank highlighting and rank outside the top results are covered by campaign UI tests. Screenshots are saved in the original product worktree as `output/qa/campaign-auto-entry-390.png` and `campaign-auto-entry-1440.png`.
- Original first QA actor is still in `profile_setup`; the browser correctly redirected that actor to onboarding. No profile was changed to bypass this. The completed QA actor was used instead. Native device checks were previously waived by the owner; GitHub Actions remains the native build route.
- Production preflight: original campaign migration is already applied; automatic-entry migration `20261101180745` is not. Production cutover must apply that one migration, then promote/push the prepared product and marketing release to main; merge mobile and dispatch `build-android.yml` and `build-ios.yml` on main through GitHub Actions. Paid event flags remain disabled. Production migration still needs the owner's separate explicit approval.

Prepared local release commits: product `399195cc`, marketing `7bfbae9`, mobile `72630e7`. They are not pushed to main and no production migration/deployment or GitHub Actions build was started in this pass.


## Approved production cutover — 1 November 2026

The owner explicitly approved the production campaign migration, publishing all three prepared releases to main, and starting APK/IPA builds. Completed:

- Applied only `20261101180745_automatic_small_business_campaign_entry.sql` to Production `yoiyqxtpmxnrrbqqidcs`, with its ledger entry in the same transaction. Verified migration present, campaign active, 9 businesses included, and Gaia Bakery still rank 1 with 1 completed sale. Event finance tables remain absent in Production; no event-finance/native-commission/payout migration or financial action was included.
- Pushed product `399195cc`, marketing `7bfbae9`, and mobile `72630e7` directly to their respective remote main branches. Original worktrees and Payluk draft remain preserved. No preview branch deployment was used.
- Vercel accepted product production deployment `yrdly-b6sce5b59-calebs-projects-98954387.vercel.app` for exact commit `399195cc` (observed BUILDING) and marketing production deployment `yrdly-4ulau19pn-calebs-projects-98954387.vercel.app` for exact commit `7bfbae9` (observed QUEUED). These are started deployments, not proof that the new UI is live. The owner requested no build monitoring, so do not keep polling automatically.
- Dispatched GitHub Actions on mobile main, exact commit `72630e740cf009d1cc3a9e80c11f692a607c3d74`: Android APK https://github.com/Yrdly-ng/yrdly-mobile/actions/runs/41340027571 and iOS IPA https://github.com/Yrdly-ng/yrdly-mobile/actions/runs/41340033411. Both observed `in_progress`. No completed/signed/store-ready native artifact is claimed.
- Campaign rollout is now underway in Production. Paid event checkout/withdrawals remain gated; successful event release/bank payout, buyer early-release restriction and frequent worker scheduling remain separate unresolved event-launch requirements.
