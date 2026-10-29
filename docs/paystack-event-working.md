# Paystack event payments implementation

Approved scope: new event ticket purchases use Paystack after activation. Existing Payluk purchases keep their original checkout, verification, refund and settlement handling. Marketplace and service bookings remain unchanged.

## Delivery sequence

1. Verify official Paystack API contracts and current ticket-ledger invariants.
2. Add a server-only Paystack adapter with precise kobo amounts, verified transaction matching, signed webhooks and safe request-error handling.
3. Add provider-aware ticket reservation, checkout, issuance and refund handling. Keep ticket price unchanged; record YRDLY's 3% and actual provider fees separately.
4. Add an organiser ticket earnings ledger and manual withdrawal flow. Funds become eligible no earlier than 24 hours after event end and only after settlement checks, with refunds/disputes/transfer attempts reserved atomically. No automatic bank transfers.
5. Update web and mobile hosted checkout, payment return/recovery and organiser earnings/refund presentation. Document refund terms before purchase.
6. Test authentication, provider isolation, duplicate/out-of-order callbacks, exact amounts/currency, late payments, overselling, refunds, disputed funds and pending transfers.

## Activation boundary

The owner confirmed Manual Payouts is not enabled and later explicitly approved sandbox testing on the existing main project for all signed-in users. Build and validate for sandbox first. Production continues using Payluk until explicit Paystack activation after verified configuration, onboarding, and sandbox validation. Missing configuration fails before a provider payment is started; never silently reroute an existing order.

No live payment, refund or bank transfer is included in this implementation stage. Native builds require a separate request. The owner approved main-project sandbox configuration; migration/deployment status must be reported explicitly. Test credentials, if unavailable, block funded sandbox verification but not mocked/database tests or reviewable implementation.

## Open operating decisions

Keep the existing manual withdrawal policy and advertised ticket-price economics. Transfer fees and post-payout chargebacks require a reserve policy and clear organiser terms before activation. Surface unresolved refund/chargeback exposure for administrator review rather than automatically reclaiming a bank payment.

## Validation and rollout status

- Web and mobile typechecks passed; targeted lint has no errors (existing hook/style warnings remain).
- 14 Paystack adapter/database tests, 12 legacy ticket flow tests, and 6 mobile checkout tests passed.
- Test credentials accepted by a read-only Paystack bank-list request; no provider resource, charge, refund, or transfer was created.
- Owner approved sandbox on main for all signed-in users. Explicit test-on-main/project settings are prepared; the two reviewed migrations are now applied; checkout activation is included in the approved web deployment.
- Test keys are stored in ignored local environment configuration and configured as sensitive Vercel server variables for the approved sandbox deployment.
- Main database prerequisites exist. Older migration-history differences mean only the two new migrations should be applied through a targeted reviewed transaction, never a blanket db push.
- Hosted checkout testing on main uses synthetic accounts and an unlisted sandbox event. Authentication, provider selection, checkout retry reuse, organiser-only earnings access and the pre-event withdrawal hold passed against the deployed API.
- Paystack's dashboard initially passed processing fees to the customer, increasing a ₦3,000 checkout to ₦3,147.21. The exact-price verification correctly withheld tickets. The owner disabled that preference, and Paystack confirmed the full sandbox refund as processed.
- The next hosted payment was confirmed as exactly ₦3,000, with ₦145 provider fees. Issuance rolled back because the deployed notification constraint omitted `ticket_purchase`. Its reservation expired during diagnosis; a full sandbox refund was requested rather than forcing issuance.
- Migration `20261029081527` preserves the notification allowlist and admits ticket-sale notices. It is applied on main. Seven checkout database tests pass with the deployed legacy constraint included. An actual-main rollback probe confirmed one ticket, one organiser notice, replay without duplicates, and ₦2,765 held proceeds (₦3,000 − ₦90 commission − ₦145 fees).
- The fresh hosted payment passed against the deployed application: Paystack's `charge.success` webhook was processed, one sandbox ticket and organiser in-app notification were committed, and verification replay created no duplicates. The organiser ledger records ₦3,000 gross, ₦90 commission, ₦145 provider fees, ₦2,765 held proceeds and zero available for withdrawal.
- The buyer was denied the organiser refund endpoint. The organiser requested a full ₦3,000 sandbox refund, and replay returned the same provider-backed refund intent. Paystack now reports it as processing; final refund confirmation and the resulting ticket/ledger transition remain outstanding.
- Deployed withdrawal tests used a separate, explicitly synthetic test-domain settled earning (not another collected ticket payment). The 23-hour hold and buyer withdrawal denial passed. At 25 hours, the first transfer required merchant OTP and remains reserved. After the owner disabled OTP, a separate synthetic fixture completed one ₦2,765 test transfer; both Paystack and Yrdly report success, withdrawn totals match, and a repeated withdrawal request is rejected without another intent.
- Additional QA found Paystack's documented refund callbacks may omit `data.id`. The handler now resolves a unique matching stored refund by original transaction reference and verifies its authoritative provider state; mismatched/ambiguous identities fail closed. Fourteen webhook regression cases, four finance database cases and twelve legacy fulfillment cases pass. Web typecheck and targeted finance lint pass.
- Event-team and reservation suites passed locally for account-bound invitations, role revocation, wrong-event/unpaid/expired/refund-pending admission denial, duplicate scans, expiry and overselling. These checks do not substitute for physical camera and staff-device testing. Event cancellation requires paid tickets to be refunded first; cancellation notification delivery remains a follow-up gap.
- Native device checkout and notification delivery testing remain outstanding. No new native builds were triggered for this sandbox rollout.
