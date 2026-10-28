# Event ticket sandbox

New paid event checkouts can use Paystack hosted checkout. Existing orders are verified and cancelled with their stored provider; the feature flag never relabels Payluk orders. The organiser receives one in-app sale notification when verified tickets are issued. Buyer email delivery is queued for retry.

## Configuration

The owner approved using the existing main project for sandbox testing, with all signed-in users permitted. Apply both `20261028174041_paystack_ticket_checkout.sql` and `20261028174051_paystack_event_financial_ledger.sql` there, after the existing migrations. Sandbox receipts and organiser earnings are labelled test data and do not credit real seller wallets. Both migrations were applied atomically to the approved main database on 29 October 2026 after a rollback preflight.

Set server environment variables:

```dotenv
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_EVENT_CHECKOUT_ENABLED=true
PAYSTACK_SANDBOX_PROJECT_REF=your-existing-project-ref
PAYSTACK_TEST_ON_MAIN=true
PAYSTACK_TEST_ALLOW_ALL_USERS=true
NEXT_PUBLIC_SUPABASE_URL=https://your-existing-project-ref.supabase.co
NEXT_PUBLIC_APP_URL=https://app.yrdly.ng
CRON_SECRET=your-server-cron-secret
PAYSTACK_LIVE_ENABLED=false
PAYSTACK_MANUAL_PAYOUTS_ENABLED=false
PAYSTACK_EVENT_OPERATIONS_APPROVED=false
```

For a local Supabase instance, use `PAYSTACK_LOCAL_SANDBOX=true` with a localhost/127.0.0.1 Supabase URL. Secrets stay on the server. Use the matching Supabase credentials for the approved project. The explicit main-project test flag is required on production deployments. For a restricted future test, disable PAYSTACK_TEST_ALLOW_ALL_USERS and supply comma-separated auth UUIDs in PAYSTACK_TEST_USER_IDS.

In the Paystack dashboard's **test** configuration, set the webhook URL to `https://app.yrdly.ng/api/webhooks/paystack`. The handler verifies the raw request signature, stores a durable receipt, then verifies provider resources before issuing tickets or updating finances. Configure the cron endpoint `/api/cron/reconcile-paystack-events` with its bearer `CRON_SECRET`. `vercel.json` schedules a ten-minute recovery pass. Preview deployments may require an external scheduler or an authorised manual invocation because Vercel cron execution depends on deployment type and account scheduling support.

## Sandbox walkthrough

1. Publish a future paid test event in the approved project; purchase one ticket, then a quantity of five in another tier/account.
2. Complete a Paystack test payment. Confirm exact advertised price, tickets/QR codes, one organiser in-app notice and confirmation email.
3. Repeat verification and replay the signed callback; ticket count, sold count, notifications and earnings must stay unchanged.
4. Close checkout, reopen the event and verify the saved payment. Reopening the app must not create a second charge automatically.
5. Expire a reservation and complete its old provider session. Confirm the order becomes `refund_required`, creates a reconciliation flag, and issues no extra ticket. This late-payment case requires support review; it does not automatically submit a refund.
6. Request a refund from the organiser's attendee roster. Pending/uncertain refunds block admission and withdrawals. Only provider-confirmed completion changes the ticket to refunded. Provider failures stay held for support; never submit a replacement refund blindly.
7. In test data only, set event end time to more than 24 hours ago. Test earnings are marked settled at payment verification to simulate settlement; live earnings require actual settlement evidence. Confirm available earnings equal gross minus 3% commission and actual collection fees.
8. Verify a test bank account, review its resolved name and amount, then explicitly confirm a sandbox withdrawal. Duplicate taps must not reserve the same funds twice. Refresh reconciles the existing transfer; no scheduler starts a withdrawal.
9. Exercise a dispute or transfer reversal; the event must remain held for operations review. Unknown resource states and timeouts retain funds rather than creating another payment.

## Production activation remains incomplete

Compliance submission is not Manual Payouts approval. Before live activation, obtain Paystack's approval/forms, implement and validate live settlement-to-balance reconciliation, approve organiser transfer-fee/reserve policies and chargeback operations, record versioned refund-policy acknowledgement before purchase, and complete funded sandbox/device testing. The current financial API and withdrawal reservation RPC deliberately permit **test** operations only. Enabling checkout environment flags alone does not enable live withdrawals or refunds.

Live organiser proceeds become eligible no earlier than 24 hours after the event ends and after confirmed settlement/refund/dispute checks. Paystack Manual Payouts retains funds in the main balance; it is not native escrow. Organisers use verified transfer recipients, with no subaccount required.

## Recovery limits

Late payments and refund requests whose create response was lost require support reconciliation by the original reference. Automatic replacement refunds or transfers are prohibited. In-app sale notifications are atomic with ticket issuance. Email uses stable Resend idempotency keys, whose provider retention is limited; delayed retries can still duplicate emails beyond that retention. A pending delivery outbox does not undo paid tickets.
