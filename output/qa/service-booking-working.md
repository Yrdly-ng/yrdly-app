# Approved service booking work

The customer approved acceptance before payment and a fixed 50% / 50% release on 28 October 2026.

1. Repair availability privacy, staff day-off writes, booking history, checkout recovery, cancellation support, rescheduling consent, and verified reviews on web and mobile.
2. Snapshot the business-accepted final price. Require an accepted quote for indicative prices. Allow business acceptance before funding, and reject new checkout before acceptance at both API and database boundaries.
3. Use a single fully funded Payluk milestone escrow for new staged bookings. Explicit customer approval releases the first half; customer confirmation after completion releases the remainder. Preserve all historical financial contracts and checkout recovery.
4. Reconcile each provider release into an immutable earnings ledger before exposing it for manual withdrawal. Block ordinary full-release routes for staged orders.
5. Confirm the commission arrangement before enabling staged checkout. Payluk milestone escrows require buyer-paid provider fees and do not support the standard escrow additional fee. Keep existing 3% marketplace/event charging unchanged. Decision: retain YRDLY's 3% commission; keep staged checkout disabled pending Payluk confirmation. Provider email draft prepared.
6. Validate concurrency, authorization, monetary rounding, duplicate callbacks, partial settlement, cancellation, and web/mobile journey regressions. No live fund release or bank transfer is part of this work.

Deployment authorized on 28 October 2026 after verification. Production rollout is recorded below.

## Verification and rollout status

- Web TypeScript check passed, including a check without incremental cache.
- Web booking regression suite: 12 checks passed across journey UI, API/reservation acceptance, RLS-safe availability, staff exceptions, consent rescheduling, accepted prices and verified reviews.
- Web focused catalog/category/engagement checks passed.
- Mobile focused catalog suite: 20 checks passed.
- Mobile focused booking suite: 24 checks passed; two additional payment-recovery/staged-visibility checks passed. Scoped mobile lint completed with zero errors and 16 React warnings.
- Mobile TypeScript check passed after correcting the signed-in-user guard in the completed-review lookup; its review regression and booking-screen formatting check also passed.
- The new staged checkout remains intentionally unavailable; the 50/50 financial implementation and funded sandbox validation are deferred until Payluk confirms commission support.
- The four production migrations were applied atomically on 28 October 2026, using their exact local migration versions. Existing historical migration-name differences were left unchanged. Web and mobile release follows this authorization.
- Browser/device visual verification remains a rollout check; component tests do not establish on-device layout or actual provider settlement.
