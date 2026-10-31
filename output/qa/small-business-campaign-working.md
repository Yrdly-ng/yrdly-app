# YRDLY × Small Businesses — planning handoff

Updated: 31 October 2026. Status: **implemented locally; migration applied to QA Staging; authenticated campaign enrollment and admin approval verified; production remains untouched**.

## Approved rules — authoritative

The owner approved all eight proposed defaults and explicitly confirmed products only. These rules supersede the historical proposal notes below.

1. Campaign is 1–30 November 2026 in Africa/Lagos: UTC start `2026-10-31T23:00:00Z` inclusive; UTC end `2026-11-30T23:00:00Z` exclusive. Include the entire final second of November; do not truncate fractional seconds.
2. ₦500,000 for first place. Equal completed-sale counts share rank (1, 1, 3); verified tied first-place businesses split ₦500,000 equally. Naira volume never determines rank.
3. **Businessplace directory product orders only.** Personal marketplace listings, services/bookings, event tickets, free/giveaway and off-platform transactions do not qualify.
4. Existing and new businesses explicitly enroll and require admin approval; one participating business per owner. Google Form remains an interest form; trusted authenticated enrollment is separate.
5. One canonical completed order counts once regardless of quantity/value. Require explicit buyer-confirmed receipt and verified provider release; timed/automatic claims do not qualify.
6. The order must be created after business approval and within the campaign window, and completed within that window. Older orders do not qualify. Payment success alone is insufficient.
7. Pending refund/dispute/uncertain reconciliation holds the order out. Any confirmed full or partial refund/reversal removes its count. Verified resolution may restore eligibility only if all approved rules are satisfied.
8. Exclude self-purchases; review suspicious and related-account transactions using evidence/audit. Genuine repeat buyers are not automatically excluded.
9. Seven-day review after campaign closure; identity/ownership and sale evidence reviewed before finalization/announcement. Unresolved cases delay finalization. Closure itself does not declare a winner or transfer prizes.

Implementation authorization covers local code and validation. The campaign migration is applied to QA Staging only. Production deployment, production database changes, and winner/prize actions need separate explicit authorization.

## Owner clarification after initial assessment (resolved by approved rules above)

- The owner confirmed November 2026, Africa/Lagos, first prize ₦500,000, product-only Businessplace scope, and equal-rank/equal-prize treatment for tied first-place businesses. The exact UTC boundaries and eligibility terms are specified in the approved rules above.
- The public Google Form remains an interest form and still needs its date/rules wording aligned before launch.

## Authorization and preserved work

- Scope: public website `yrdly`, web/backend `yrdly-app`, Expo `yrdly-mobile`.
- Root and all application AGENTS.md instructions read. Developer and UI/UX specialists performed read-only assessments.
- Initial investigation performed no application code/database/provider changes. Implementation is now authorized; record its progress below. Form submissions/respondent access, production changes and prize actions remain outside authorization.
- Initial Git state: website/mobile clean; product has a pre-existing modified `output/qa/payluk-service-milestones-email.md`. Preserve that draft exactly.
- Baseline main commits: website `84f50dd`, product `33636e19`, mobile `076375d`.
- Production deployment, production migration application, winner announcement and prize actions require separate explicit authorization. Existing service 50/50 checkout must stay disabled pending Payluk commission confirmation.

## Confirmed requirements

- Campaign ranking uses **number of completed sales**, regardless of naira value. Payment success, listing creation and manually marking a listing sold are insufficient.
- Campaign copy: “YRDLY × Small Businesses”, “Sell More. Win Big.”, “₦500,000 Up For Grabs!”, “Join. Sell. Climb. Win.”
- **₦500,000 is confirmed for first place** following owner clarification. Do not describe pictured products as prizes. Tie allocation remains pending.
- Flyer supplied at `/Users/macbook/Downloads/WhatsApp Image 2026-10-30 at 7.01.27 PM (1).jpeg`: vivid yellow, green/black typography, business owner and product imagery. Build accessible text/UI rather than relying on flyer text embedded in an image.
- One backend calculation across all surfaces; no client-submitted scores. Duplicate-safe counting, explicit business attribution, consistent dates, sandbox exclusion, private transaction evidence, audited corrections and reviewable closure required.

## Public registration form inspection

Source: https://forms.gle/UnREfHXZK4CGLn3KA

Firecrawl connector returned an unknown-tool error and browser retrieval failed. A direct read-only HTTP fetch retrieved public form HTML. No fields were completed or submitted and no respondent data was accessed.

Public title: “YRDLY SMALL BUSINESSES CAMPAIGN”. Required questions:

1. Business name.
2. Business owner's full name.
3. Phone / WhatsApp number.
4. Email address.
5. What does your business sell?
6. Interested in selling products on the platform? Yes / learn more first.
7. Physical shop/store? Physical store / online store.

Optional question: what are you looking forward to most by selling on Yrdly?

The description calls this a one-month competition with a **₦500,000 grand prize** and promises review/contact after interest submission. The owner subsequently confirmed ₦500,000 for first place, resolving the initial prize conflict. Dates and “highest recorded sales” still need approved precise wording. Treat the form as interest collection, not proof of authenticated business ownership or campaign approval. Do not replace it or infer technical integration permission. Decide whether to retain external interest collection plus in-app verified enrollment, or replace it after agreeing the flow. No business UUID/account linkage is collected by the current visible questions.

### Ready-to-paste interest-form description

The external Google Form has not been edited. To align it with the approved rules while keeping it an interest form, use this description:

> YRDLY × Small Businesses runs from 1 November 2026 at 12:00 a.m. to 1 December 2026 at 12:00 a.m. Africa/Lagos time (the final eligible day is 30 November). First prize is ₦500,000. The winner is the approved participating Businessplace product business with the highest number of eligible completed product orders; each order counts once, regardless of quantity or value. Services, bookings, events, personal marketplace listings, giveaways, sandbox and off-platform sales do not count. Owners must create or own a product business, enroll in the campaign in the YRDLY app and receive admin approval before an order can qualify. This form collects interest only and does not enroll or approve a business. Refunds, reversals and unresolved disputes affect eligibility. Equal first-place counts share the prize equally. Results remain under review for seven days after the campaign closes before winners are finalized.

Keep the form questions as contact-interest questions unless the owner separately asks to change them. Update the marketing page link label/copy only after the external form is actually aligned; never claim a form submission enrolls or approves a business.

## Code-informed findings

> The planning tables and unresolved questions below are historical. Their date, scope, ranking and tie questions were resolved by the approved rules at the top of this handoff; use those approved rules instead.

### Business attribution

- `src/app/api/payment/initialize/route.ts:157` reads `catalog_items.business_id`; it checks that `businesses.owner_id` matches seller, and verifies authenticated buyer and listing price/ownership.
- Strongest existing chain: escrow catalog item → catalog business → owner validated at checkout. Preserve business/owner IDs at order creation instead of depending on today's mutable listing/owner.
- Ordinary marketplace posts identify seller user, not a campaign business. Do not credit all seller activity to whichever business that user currently owns. Require explicit business selection backed by server ownership checks for future eligible orders; historical ambiguous orders stay excluded pending evidence review.
- Bookings have explicit business attribution, but provider-marked appointment completion is not proof of paid/customer-confirmed fulfillment.
- Organiser ownership is not automatically business ownership. Tickets need an explicit event-to-business relationship and an agreed completion definition if included.
- Multiple businesses per owner need explicit selection; mobile profile's current first-business lookup must not silently choose a campaign entrant.

### Completion and reversal evidence

- Concrete completion writers: buyer-only `src/app/api/payluk/confirm-delivery/route.ts:49` and `src/app/api/transactions/[id]/complete/route.ts:52`; timed seller claim `src/app/api/transactions/[id]/claim/route.ts:43`; maintenance `src/app/api/cron/auto-release/route.ts:75`; provider callbacks `src/app/api/webhooks/payluk/route.ts:279` and `:313`.
- Escrow completion includes buyer-confirmed delivery and timed seller/provider claims. A status string alone cannot establish the agreed fulfillment rule.
- Provider completion paths do not uniformly preserve `completed_at` or completion provenance; `updated_at` cannot substitute for an immutable campaign completion time.
- `supabase/migrations/20261009120200_money_fixes_b.sql` flags some refunds after completion / partial refunds for reconciliation without simply making completed status disappear.
- `supabase/migrations/20261011153000_reconcile_payluk_dispute_allocations.sql` can leave a split dispute completed when the seller retains proceeds. Therefore `COUNT(status = 'completed')` would count some refunded/disputed orders incorrectly.
- Existing financial reconciliation must be reused; campaign logic must never release money or modify historical financial contracts.
- Server-only escrow write protection is in `supabase/migrations/20261009120100_launch_lockdown_a.sql:40`; order reservation RPC grants are restricted in `20261011173901_enforce_paid_price_minimum.sql:217`. The inspected subset does not establish complete current business/catalog RLS: inspect the development schema/policies before trusting attribution. Current catalog reservation consumes one stock unit, but canonical order identity remains the counting unit, including any future quantity support.
- Paystack ticket flows have test/domain markers; common Payluk order creation lacks a consistent immutable live/test marker. Fail closed on unknown mode; do not infer real payments from merely existing in production or from amount/email patterns.
- Paid catalog orders are the most practical initial qualifying type after the provenance/environment gaps are closed. Ordinary posts, unpaid/off-platform activity, bookings and tickets need additional rules/instrumentation; recommend excluding these initially.
- Payment docs contain historical Payluk-only statements that conflict with newer Paystack ADR/implementation. Use actual provider-aware code and the newer ADR, not those stale statements, when implementing.

### Existing foundations to reuse

- Public-profile privacy approach: `docs/adr/0004-public-profile-projection.md`; provider isolation/test earnings approach: `docs/adr/0006-provider-separated-event-ticket-earnings.md`.
- Product authenticated business verification/onboarding: `src/components/businesses/BusinessesScreen.tsx`; existing business directory/profile/create flows.
- Existing admin dispute routes verify admin and reconcile provider outcomes; `src/app/api/admin/users/suspend/route.ts` shows server-controlled role checks and immutable moderation auditing. Reuse admin shell/auth patterns, not client role claims or maintenance-secret routes as user-facing authorization.
- Website `components/header.tsx`, `lib/app-links.ts`, `lib/public-discovery.ts`, `app/businesses/page.tsx` provide navigation, product links and public discovery patterns.
- Mobile `src/app/(tabs)/catalog.tsx`, `src/app/(tabs)/profile.tsx`, `src/app/businesses/create` and `src/app/businesses/[id]` supply business discovery/onboarding/profile journeys; reuse native image, theme, loading and refresh components.

## Initial decision proposals — historical; approved rules above take precedence

| Rule | Proposed default / decision needed |
| --- | --- |
| Dates/timezone | Confirmed 1–30 November; 2026 inferred from context. Propose Africa/Lagos, inclusive 1 November 00:00 through exclusive 1 December 00:00. Timezone still needs confirmation. |
| Entry/existing businesses | Explicit authenticated enrollment and admin approval; existing and new businesses qualify. Propose one participating business per owner; confirm multi-business/staff policy. Form submission alone is interest. |
| Sale types | Businessplace directory only confirmed; personal marketplace/events excluded. Still confirm directory products only versus directory products plus services. Propose initially live, positive-value directory catalog product orders with buyer-confirmed fulfillment and authoritative provider release; exclude timed claims pending review unless explicitly approved. |
| Counting unit | One qualifying canonical order = one sale, irrespective of quantity, callbacks, payment installments or value. |
| Timing | Propose order creation AND completion within campaign, order placed after business approval; payment success alone does not qualify. Confirm whether earlier orders completing inside the window should count instead. |
| Refunds/reversals | Confirmed full or partial refund/reversal removes the whole order count. Pending refund, dispute or uncertain reconciliation holds it out until resolved; restore only if final evidence satisfies the approved rule. |
| Ties | Equal counts have equal ranks (1, 1, 3); propose splitting the relevant approved prize equally among verified tied businesses. Never use revenue as tie-breaker. Owner must approve payout treatment. |
| Prizes/verification | Confirmed ₦500,000 for first place. Tie handling remains pending; no other prizes specified. Propose ownership/identity and sale-evidence review, a seven-day post-close review period, and explicit admin finalization before announcement. Unresolved cases can delay finalization. |
| Abuse | Exclude owner self-purchases; related/controlled-account and suspicious patterns enter documented review. Genuine repeat buyers are not automatically fraud. Confirm related-account definition and review/appeal policy. |
| Registration/public data | Decide form relationship; approve public business name/logo/profile/rank/count fields and enrollment disclosure. Never publish owner contact, buyer identities or financial evidence. |

## Proposed experience

- Marketing: `/campaigns/small-businesses`; header/home/business-directory promotion; approved hero copy, how-to steps, exact rules/dates/prize allocation, share links, signup/create-business actions and the same backend leaderboard. Product profile links use existing `appLink` configuration.
- Product: campaign screen linked from Home, Businesses and owner management; reuse phone verification and create-business flow. No extra bottom navigation tab.
- Mobile: native campaign stack screen, Home banner, Businesses strip and owner card. Native profile links and share sheet.
- Participation: sign in → verify/onboard if needed → choose owned business → enrollment/approval → business-specific participation status. Show “Your business” with absolute rank/count even outside leading results; explicit selector if multiple entrants allowed.
- States: upcoming, active, ended/under review and finalized, independent of loading/empty/error/stale states. Distinguish no participants from zero qualifying sales. Preserve last good data on refresh failure and label stale; never show a network error as zero sales.
- Leaderboard: approved public business ID/name/logo/profile link/count/rank; no competitive revenue metric. Top and own-business positions come from one snapshot version.
- Freshness proposal: backend publishes a versioned snapshot at most every minute during active use; clients refresh on focus/manual/pull-to-refresh, with bounded visible-screen polling. Show server calculation time, not fetch time; pause polling offscreen. Final results remain versioned and frozen. Validate achievable cadence before promising it publicly.
- Accessibility: real selectable text, contrast-tested yellow/green, visible focus, semantic web leaderboard, >=44-point targets, non-color “Your business” marker, announced status/rank/count, large text support and reduced motion. Retain each application's existing fonts/layout foundations.

## Implementation sequence

1. Approved rules, timezone instants, prizes and form decision recorded above. Version the implementation against these rules; add glossary/ADR entries for settled terminology/decisions.
2. Backend integrity: immutable order business/owner and test/live attribution; trusted completion time/provenance and reversal/reconciliation signals. Audit source write permissions/RLS so clients cannot forge underlying qualifying facts. Do not retroactively assign uncertain history.
3. One campaign module: campaigns/rule versions, participation/approval history, unique canonical sale contributions, append-only decisions/corrections and versioned result snapshots. Deduplicate on campaign + order identity, not webhook ID. Atomically reconcile eligibility changes, including delayed/out-of-order callbacks. Repair/rebuild deterministically from source evidence.
4. Restricted read interface: public config/top leaderboard; authenticated own-business rank and participation; admin private sale evidence. Public projection allowlists approved fields. No raw transaction exposure, no score writes from clients. Return snapshot ID, calculated time, campaign state and rank semantics consistently. Bound public requests/caching and rate-limit writes.
5. Admin controls in existing tools: configure draft rules/window, approve/reject entrants, hold/disqualify with reason, inspect count evidence and fraud signals, audit/reconcile, preview closure, finalize reviewed snapshot. Corrections reference canonical orders and preserve actor/time/reason/before/after; never an unexplained editable score. Rule edits versioned and restricted after launch. Finalization/announcement/prize actions separate.
6. Build all three surfaces against the same read contract and existing auth/navigation/design. Keep external interest form separate from trusted enrollment unless agreed integration is implemented.
7. Validate with deterministic database/integration fixtures: ownership and reassignment, forged source facts and unauthorized requests, same order retries and concurrent/out-of-order events, full/partial/pending refunds and disputes, test/unknown mode exclusion, start/end timezone boundaries, quantity/installments, equal ranks, own rank outside top, replay/rebuild equivalence, all clients using one snapshot, audit reason/history and finalization permissions. Existing 50/50 restriction unchanged.
8. App checks: product lint/typecheck/build and relevant payment/fulfillment regressions; website lint/build; mobile lint/format/typecheck and focused campaign journeys. Responsive desktop/mobile web, keyboard/screen-reader checks, native large text, loading/error/empty/upcoming/active/ended states, auth return links, business links and sharing.
9. Update this handoff with changed files/commits, actual commands/results, environment variables, migration filenames, deployment/native build state, remaining work and approvals. Prepare deployment/migration review artifacts; do not apply or release without separate authorization.

## Initial planning checks (historical)

- Completed: root/application instructions, Git state, relevant domain docs/ADRs, code-informed developer and UX inspection, public-form read, flyer review, planning handoff.
- At the planning stage, no tests/builds had been run and no application code had changed. No live database audit was performed; existing-record findings describe repository code, not verified production data completeness. See the completed implementation checks below.
- Owner decisions subsequently approved; local implementation and validation are recorded below. Production rollout and schema application require their own later authorization.

## Implementation ownership / progress

- Developer specialist: product backend, migration files, trusted sale provenance, campaign qualification/read/admin interface and backend integration tests.
- UI/UX specialist: website and Expo campaign presentation, entry points, read/enrollment clients and relevant checks.
- Main session: product campaign/admin UI, approved rule documentation, integration review and final validation/handoff.
- Preserve the pre-existing modified Payluk email draft. Do not commit or publish without instruction.

## Technical requirements received during implementation

The owner's November Business Competition document reinforces the approved eligibility rules and adds explicit disqualification, event history, suspicious-order investigation, integer-kobo allocation and winner/prize recordkeeping. Implemented locally. The earlier specialist sessions hit usage limits; the main session completed integration and checks directly rather than substituting specialist models.

## Delivered implementation

- All three applications expose `/campaigns/small-businesses`, with campaign entry points in existing navigation/home/business areas. Flyer-inspired yellow/green presentation uses real text; no product image is presented as a prize.
- Public website has a same-origin proxy that validates and strips the product response down to its approved public projection. It never forwards a session, client score, buyer identity or private transaction details.
- Product/mobile authenticated view reads public standings and the owner's complete rank from **one backend snapshot**, including ranks outside the top 50. Explicit enrollment selects an eligible owned product business; the interest form remains separate.
- `src/lib/campaigns/types.ts` defines the contract; `src/lib/campaigns/server.ts` binds reads/writes to the authenticated identity and stored admin role. Public endpoint has no caller-selectable actor.
- Migration **`supabase/migrations/20261031180409_small_business_campaign.sql`** creates fixed/versioned campaign rules, participation, immutable order evidence, event observations, eligibility checkpoints, append-only audit and prize records, and reviewed final snapshots. It was applied to QA Staging on 31 October 2026 after separate owner authorization; it is not applied to production.
- New evidence captures business/seller/buyer/order amount/date and explicit live/test configuration before provider setup. Only live Businessplace catalog products can qualify. Unknown history is not backfilled or attributed from today's seller profile.
- Buyer receipt routes record explicit authenticated receipt before release, then verify provider escrow identity, amount, CLOSED/COMPLETED state and environment. Timed claims cannot create receipt provenance. Recovery can finish an already recorded action without inventing a new one.
- Signed catalog refund callbacks permanently revoke qualification, including refunds after an escrow remains completed. Confirmed dispute refunds also remain excluded even if the source dispute is later edited. Pending disputes/reconciliation and manual holds suspend counts; clearing a hold cannot bypass financial/date rules.
- One order is one point. Unique order evidence prevents retry duplication; a second unique index prevents reusing a single provider escrow release across different local orders. Underlying source identity/provider changes invalidate qualification.
- Source mutations record observed order/payment/dispatch/receipt/release/dispute/refund/reconciliation events and audit qualification/reason changes. Source tables retain their financial role; campaign writes do not initiate payments or alter historical financial contracts.
- Suspicion indicators include repeated buyer, closely timed orders and a buyer who owns another entrant. They are evidence for investigation, not automatic findings of abuse; genuine repeat purchasers remain allowed.
- Admin `/admin/campaigns/small-businesses` supports approval/rejection/suspension/disqualification, private order evidence and events, reason-required sale holds/clearance, audit history, final-preview locking and winner/payment evidence records. Every mutation requires server-side admin checks and recorded reasons.
- Rank uses eligible-order count only, with shared ranks (1,1,3). Positive first-place counts generate allocations totalling **50,000,000 kobo**. Divide integer kobo equally; any remainder is assigned one kobo at a time in canonical business-ID order, without changing ranks. Three tied winners receive 16,666,667 / 16,666,667 / 16,666,666 kobo. Zero qualifying sales produce no automatic prize allocation.
- Finalization waits until **8 December 2026 00:00 Africa/Lagos**, after seven full review days, and requires unresolved review cases to be cleared and the exact reviewed evidence snapshot to match. It freezes full results, including ranks outside the public top 50. Busy financial writers cause finalization to fail/retry instead of waiting with partial table locks. Later evidence changes raise an integrity-review flag and block prize records; final counts are never silently rewritten.
- Winner verification/prize-payment recording is append-only and separate from transfers. A recorded payment must match its exact kobo allocation and have prior verification; duplicate payment records are prevented. No winner/prize records or provider actions were performed during this work.
- Active surfaces refresh on focus/manual/pull-to-refresh and at 60-second visible/foreground intervals. Backend reads calculate against current evidence; displayed “calculated” time comes from the server. Errors retain and label old results; unavailable data never becomes zero sales. This is bounded polling, not a claim of instant streaming.

## Validation completed, 31 October

All financial test data is isolated/mocked; no provider charge, release, refund or transfer was initiated.

- `node --test tests/campaign-database.test.cjs`: **11 passed** against the actual new migration in ephemeral PGlite, with a fixture clock replacing only clock calls during tests. Covers qualification, identity/permissions, test/self/personal exclusions, retries, duplicate provider release, refund/dispute restoration and permanent revocation, ownership/hold/disqualification, approval/date/fractional-end boundaries, three-way kobo allocation, prize record guards, reviewed final snapshots and late evidence flags. This is not a full production-schema replay or a multi-connection concurrency/load test.
- `node --test tests/campaign-api.test.cjs tests/campaign-evidence.test.cjs tests/campaign-ui.test.cjs`: **17 passed** (5 API + 3 evidence + 9 UI). Covers authentication/admin access, score injection/consent, safe unavailable state, environment/provider checks, same-response own rank, shared ranks, loading/error/stale/empty/lifecycle states and account-session mismatch.
- Scoped legacy payment checks in `tests/audit-security.test.cjs`: **17 passed**, covering marketplace/catalog retries, receipt timeout recovery and signed legacy ticket/refund callbacks. Updated the legacy receipt fixture to model absence of campaign evidence. Catalog-only refund instrumentation avoids adding campaign writes to ticket refunds.
- `node --test tests/booking-checkout-acceptance.test.cjs tests/checkout-reservation-expiry.test.cjs`: **8 passed**, including the existing staged-booking checkout restriction.
- Mobile `node --test tests/campaign-screen.test.cjs`: **6 passed**, including same-response own rank, stale/error behavior, consent payload, closed enrollment and phone-verification routing.
- Product full TypeScript check and `pnpm exec next build` passed, including full lint/type validation and all new routes. Existing repository hook/style warnings remain. Direct Next build avoided mutating the service-worker version through the wrapper script.
- Website `pnpm build`, full lint and TypeScript check passed. Full lint at the initial run: zero errors and 27 warnings. New campaign hook/image warnings were subsequently corrected; scoped campaign lint is checked separately. The sandbox's initial font-download failure was resolved by rerunning with approved network access.
- Mobile full TypeScript check and full lint passed (zero errors, 739 warnings at that run); campaign-specific lint and touched-file formatting checked separately. The new campaign ref warning was corrected after the full run; campaign-specific lint is clean.
- Desktop **1440px** and phone **390px** browser checks passed without horizontal overflow. Website route used network-intercepted sample leaderboard data; stale refresh failure preserved scores. Product check rendered actual campaign components against isolated sample participation/ranking data and generated application CSS, including own rank 51. These are presentation checks, not full authenticated provider/database journeys.
- Screenshots: `yrdly/output/qa/small-business-campaign-{390,1440}.png` and `yrdly-app/output/qa/small-business-campaign-{390,1440}.png`. Sample businesses/scores in screenshots are QA fixtures, not live standings.
- An exploratory broad `audit-security.test.cjs` run encountered older auth/ticket/check-in fixture failures outside the scoped campaign checks and did not establish a clean whole-repository security-suite result. The focused affected payment paths pass; do not describe the entire historical suite as green.

## Rollout requirements / remaining verification

1. The campaign migration has been applied to QA Staging. Separate explicit authorization is still required for production deployment, native builds/distribution, production database changes and any winner/prize action. Nothing has been pushed, committed or deployed.
2. Before applying the migration, compare its source-table columns, enum values, current policies and financial triggers against an authorized development project/current schema. Connected Supabase tools were unavailable during final validation. PGlite fixtures do not verify complete existing business/catalog RLS or production drift. Do not run a blanket database push across the known historical migration differences.
3. Perform a development-project full-schema replay and concurrent transaction tests, including financial-source writers against finalization, before approving rollout. The authoritative read recomputes counts from evidence and unique constraints enforce idempotency; PGlite's single-connection tests do not prove all live lock schedules.
4. Apply reviewed migration before publishing the backend that calls its new RPCs; then deploy product/API and website, and separately request mobile build/distribution. No new required environment variable was added. Existing server `PAYLUK_SECRET_KEY` and optional `PAYLUK_BASE_URL` must match the actual environment; existing website product URL/mobile web-app URL configurations are reused.
5. Exercise authenticated owner enrollment/admin approval and a provider sandbox product journey in the development environment. Sandbox evidence must stay excluded from the public count; test live classification only with isolated fixtures, without charging customers. Verify hosted/mobile receipt recovery and final provider payload shapes with the actual environment.
6. Physical Android/iOS layout, screen reader/large-text behavior, native sharing and full account-switch/network-race journeys remain device QA. No campaign native builds were triggered; previous APK/IPA artifacts do not contain these changes.
7. Bring the public Google Form's exact dates, product-only eligibility and completed-order terms into alignment before launch. The form was read only and was not edited or submitted.
8. No approved participant/winner has been invented or seeded from form interest. No zero-score winner is automatically allocated a prize. Finalization, announcements and prize actions remain human-reviewed and separately authorized.
9. Service booking **50/50 payments remain disabled** pending Payluk commission confirmation. The pre-existing modified Payluk email draft is preserved.

## QA migration application — 31 October 2026

- After separate owner authorization, applied this migration to QA Staging (`jxgpvvehajxegeeozlnl`) as Supabase version `20261031180409_small_business_campaign`. Production was not changed.
- Verified the seeded row: `small-businesses`, rules `2026-11-v1`, Nov 1 00:00 through Dec 1 00:00 Africa/Lagos (inclusive Nov 30), review through Dec 8 00:00 Africa/Lagos, ₦500,000 pool.
- Verified `anon` and `authenticated` cannot execute campaign RPCs; `service_role` can. The new RLS-enabled tables have no client policies by design and are service-role-only. Supabase security advisor's no-policy notices for these tables are expected; its unrelated pre-existing findings remain unresolved.
- Renamed the local file to match the Supabase migration version and updated the PGlite test fixture. Combined focused product campaign/Payluk suite passed **34/34** after the change.
- QA application's branch metadata still reports `MIGRATIONS_FAILED` (last updated Oct 10) while preview project status is `ACTIVE_HEALTHY`; investigate/confirm this before relying on full authenticated staging flows. No app deployment, registration seed, or live prize action occurred.

## Authenticated QA API smoke — 31 October 2026

- Used the existing seller and admin QA accounts against `.env.qa`, with a hard guard for project `jxgpvvehajxegeeozlnl` and `QA_ENVIRONMENT=staging`; no credentials or tokens were printed.
- Seller and admin both received **200** from `/api/campaigns/small-businesses/me`. The response reported `upcoming`, `Africa/Lagos`, ₦500,000, and zero owned participating businesses.
- Seller received the expected **403** (`Administrator access required.`) from `/api/admin/campaigns/small-businesses`; admin received **200** and an empty participant, sales-evidence, and audit dataset.
- No database writes were performed. No test participation was created because enrollment is one-per-owner and append-only.
- Browser navigation did not complete its response wait, so this verifies authenticated API behavior and role boundaries, not a full authenticated browser UI journey. The public campaign route and responsive component checks are covered separately above.

## Seller enrollment and admin approval smoke — 31 October 2026

- After explicit owner instruction, created a QA-only product business through the existing Staging seller account: `QA Campaign Smoke 20261031182445` (`mode=product`, active, business moderation approved).
- Enrolled through `/api/campaigns/small-businesses/participation`; it began `pending`. The QA admin approved it through `/api/admin/campaigns/small-businesses/participants/[id]` with a recorded QA test reason.
- Verified the seller `/me` response and admin campaign view both show the same business participation as `approved`; admin sale evidence remains **0**. No order, payment, or provider call was made.
- The QA participation is append-only and permanently consumes the QA seller's one entry. It is a labeled test fixture and must not be interpreted as a real entrant. Staging now contains this one approved test participant; production remains unchanged.
- This completed authenticated API workflow. A full browser session was not verified; the previous browser-cookie navigation timed out.

## Recheck after Payluk cutover — 31 October 2026

- QA Staging still has exactly one approved campaign participation: the labeled `QA Campaign Smoke 20261031182445` fixture. There are zero campaign sale-evidence records and no Payluk event withdrawal/allocation records. Do not interpret the fixture as a live entrant.
- Authenticated seller/admin campaign APIs were rechecked after the additive Payluk migration: both `/me` reads returned 200 and the same upcoming campaign configuration (`Africa/Lagos`, ₦500,000); seller access to admin returned 403; admin campaign inspection returned 200 and saw the one fixture with zero sales.
- The QA Staging branch still reports the stale `MIGRATIONS_FAILED` state even though the three campaign/event/payment migrations are recorded and the preview project is healthy. Authenticated API reads work; branch-history health remains a release check.
- No production migration, deployment, campaign winner, or prize action has occurred. The reviewed rules and implementation remain as above; finalization and prize verification are future-dated controls, not launch actions.
