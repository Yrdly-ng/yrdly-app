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
- A fresh hosted checkout is awaiting tester payment to verify committed issuance and the application refund flow. These checks remain incomplete until that payment finishes.
- Native device checkout and notification delivery testing remain outstanding. No new native builds were triggered for this sandbox rollout.
