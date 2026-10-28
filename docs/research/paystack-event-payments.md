# Paystack event payments research

Reviewed 28 October 2026. Scope: **new paid event ticket orders only**. This is a research/design recommendation, not implementation or evidence of live account activation. Existing Payluk orders, marketplace/service flows and subscriptions remain outside the migration.

## Recommendation and approved constraints

Collect the advertised ticket total into YRDLY's Paystack integration, use approved Manual Payouts to retain settlement in its balance, and maintain organiser liabilities in the application. Make eligible proceeds available **24 hours after the event ends**; an explicit organiser withdrawal request is still required to initiate a bank transfer. A scheduler may mature ledger entries and reconcile existing requests; it must not initiate withdrawals.

Use the main integration and Transfers rather than checkout splits. Do not set `subaccount`, `split_code`, `transaction_charge` or `plan` for ticket initialization. Model collection, eligibility and bank transfer as separate transitions. The time hold is an application policy, not a Paystack escrow product or a guarantee that chargeback liability ends after 24 hours. These are design conclusions based on the approved requirements and Paystack's [Manual Payouts](https://support.paystack.com/en/articles/2131074) and [Transfers lifecycle](https://paystack.com/docs/transfers/how-transfers-work/).

## Current local behavior and migration seams

- [Payments documentation](../payments.md) establishes advertised-price ticket checkout: 3% YRDLY commission is deducted from gross, and the organiser also bears the provider fee. Preserve this accounting allocation; “97% to organiser” would incorrectly omit the provider cost.
- [Ticket checkout](../../src/lib/events/ticket-checkout.ts) reserves an order, claims provider creation once, creates Payluk escrow, stores its identifiers, then applies the commission. Retry/cancellation logic depends on verifying and deleting an unpaid Payluk escrow. Those provider-specific rules cannot simply be reused for Paystack.
- [Ticket issuance](../../src/lib/events/ticket-service.ts) explicitly rejects providers other than Payluk and writes Payluk references. It must dispatch using the **stored order provider**, including callback, verification, webhook, issuance, refund and cancellation paths. Never relabel historical rows.
- [Event settlement](../../src/lib/events/event-escrow-service.ts) has a disabled maturity payout routine, rejects mixed providers, and uses actual released Payluk proceeds. It has a single-event payout lookup; new Paystack liabilities must not be confused with that legacy payout. A mixed event needs provider-separated settlement records and balances.
- [Refund route](../../src/app/api/events/tickets/refund/route.ts) refuses paid refunds and requires support-assisted Payluk resolution. Retain that behavior for old orders; implement Paystack refunds through their own lifecycle.
- [Reservation migration](../../supabase/migrations/20261011065344_reserve_paid_ticket_checkout.sql) computes 3% in the database. Retain server pricing, atomic capacity reservation and one-time issuance. New migrations must be additive, with matching application changes; applied migrations are immutable.

These findings are from reading current files, not running the payment flow. Any glossary/ADR updates belong to the implementation owner; this assignment owns only this report.

## Exact API contracts

All paths below use `https://api.paystack.co`. Server requests authenticate with `Authorization: Bearer SECRET_KEY`; JSON bodies use `Content-Type: application/json`. Use integer kobo internally and keep secret keys server-side. Never use a client-provided amount as the price authority.

### Collection

`POST /transaction/initialize`: required `email` and `amount` (documented as a string in currency subunits). Send `currency: "NGN"`, a server-generated `reference`, configured absolute `callback_url`, and `metadata` (documented as stringified JSON). Transaction references allow alphanumerics plus `-`, `.`, `=`. Response `data` contains `authorization_url`, `access_code`, `reference`. Persist the reference before the network call and the checkout result before returning it.

`GET /transaction/verify/:reference`: inspect `data.status`, `reference`, `amount`, `currency`, `domain`, `id`, `fees`, and `paid_at`. Transaction IDs require unsigned-64-bit-safe handling. Record actual fees instead of relying on an estimate. [Transactions API](https://paystack.com/docs/api/transaction/)

Payment success requires `data.status === "success"` and an exact amount match. Top-level `status: true` only reports API-request success. A redirect is not proof of payment. Recommend also checking currency, environment, stored provider and buyer/order binding, then performing atomic idempotent issuance. Webhook and browser verification must converge on that same operation. [Accept payments](https://paystack.com/docs/payments/accept-payments/), [Verify payments](https://paystack.com/docs/payments/verify-payments/)

### Webhooks

Verify `x-paystack-signature` as hex HMAC-SHA512 over the **raw request body**, keyed by the secret key, before processing. Use a constant-time comparison. Durably accept work before returning HTTP 200; defer expensive side effects. Paystack retries live failures every three minutes for the first four attempts, then hourly for up to 72 hours. Test retries differ. [Webhook contract](https://paystack.com/docs/payments/webhooks/)

Recommended subscribed/handled event families:

| Event | Application responsibility |
| --- | --- |
| `charge.success` | Verify and issue tickets once; flag mismatched/unknown orders. |
| `transfer.success`, `transfer.failed`, `transfer.reversed` | Reconcile the stored withdrawal, including reversals after an earlier success. |
| `refund.pending`, `refund.processing`, `refund.processed`, `refund.failed`, `refund.needs-attention` | Reconcile one refund allocation and surface bank-detail intervention. |
| `charge.dispute.create`, `charge.dispute.remind`, `charge.dispute.resolve` | Hold affected liabilities and notify operations; reconcile resolution. |

The event names above come from the [webhook catalogue](https://paystack.com/docs/payments/webhooks/), [refund guide](https://paystack.com/docs/payments/refunds/) and [dispute guide](https://paystack.com/docs/payments/manage-disputes/). Deduplicate per resource and transition, allowing later meaningful states. Do not assume every webhook includes a globally unique delivery ID. Unknown event types should be acknowledged without financial mutation after valid authentication.

### Recipients and organiser-requested transfers

`POST /transferrecipient`: send `type: "nuban"`, verified account `name`, `account_number`, Paystack `bank_code`, `currency: "NGN"`; optional `description` and object `metadata`. Store returned `data.recipient_code`. Duplicate account numbers can retrieve an existing recipient. Do not treat Payluk bank identifiers or customer IDs as Paystack recipient identifiers. [Recipients API](https://paystack.com/docs/api/transfer-recipient/)

`POST /transfer`: send `source: "balance"`, integer `amount`, `recipient`, `currency: "NGN"`, `reference`, optional `reason`. References must be 16–50 characters containing lowercase letters, digits, `-` or `_`. Persist the withdrawal reservation and reference before submission. Response includes `data.status` and `transfer_code`; it can be `pending` or `otp`, not necessarily success.

`GET /transfer/verify/:reference` retrieves the outcome. Match amount, currency, reference, recipient and environment before posting ledger changes. `POST /transfer/finalize_transfer` accepts `transfer_code` and `otp` when required. [Transfers API](https://paystack.com/docs/api/transfer/)

On an uncertain request/timeout, retain the hold and reconcile. If transport retry is necessary, reuse **the same reference**; a fresh reference can pay twice. A terminal failed/reversed request requires an explicitly controlled retry decision; do not blindly create another withdrawal. Test transfers return success without bank processing, so they cannot validate real delivery. [Single transfers](https://paystack.com/docs/transfers/single-transfers/)

Transfers require registered-business eligibility, no payout hold, valid recipient and sufficient provider balance for amount plus fees. Nonfinal states include `pending`, `otp`, `received`; other outcomes include `abandoned`, `blocked`, `rejected`, `failed`, `reversed`, `success`. Verification can report not-found before creation; that is not proof that an uncertain request is safe to replace. [Transfer lifecycle](https://paystack.com/docs/transfers/how-transfers-work/)

For programmatic withdrawals without a merchant OTP each time, operators must complete `POST /transfer/disable_otp` followed by `POST /transfer/disable_otp_finalize` with `{ "otp": "..." }`, or use approved dashboard settings. `POST /transfer/enable_otp` reverses that setting. `GET /balance` and `GET /balance/ledger` support liquidity/reconciliation. Disabling provider OTP does **not** authorize automatic organiser payouts; application withdrawal authorization remains mandatory. [Transfer controls](https://paystack.com/docs/api/transfer-control/)

### Refunds

`POST /refund`: `transaction` is the original reference or ID; optional integer `amount` specifies a partial refund, otherwise the full original amount is requested. Optional `currency`, `customer_note`, `merchant_note`. Save returned refund `id`; HTTP success means queued. `GET /refund/:id` fetches status; `GET /refund` lists refunds.

For `needs-attention`, use `POST /refund/retry_with_customer_details/{id}` with `refund_account_details: { currency, account_number, bank_id }`. `bank_id` is the bank's ID, not recipient `bank_code`. This is not a general duplicate-request retry endpoint. [Refund API](https://paystack.com/docs/api/refund/)

Lifecycle: `pending` → `processing` → `processed`, with `failed` and `needs-attention` alternatives. The retry endpoint requires the needs-attention condition. A processed refund can still take up to ten business days to arrive. [Refund lifecycle](https://paystack.com/docs/payments/refunds/)

Recommendation: reserve a refund allocation and its organiser-liability hold before calling Paystack. Keep cumulative partial refunds bounded by the paid gross. On unknown outcomes reconcile by stored transaction/refund identity; the documented create API does not expose an application idempotency key. Do not create a replacement automatically. Prevent concurrent refund, withdrawal and admission races. Finalise financial reversal only on verified provider completion; represent pending review separately from a completed refund.

### Disputes

`GET /dispute` lists disputes; `GET /dispute/:id` fetches one; `GET /dispute/transaction/:id` uses the transaction ID. `GET /dispute/:id/upload_url?upload_filename=...` returns an upload URL and file name. `POST /dispute/:id/evidence` adds evidence. `PUT /dispute/:id/resolve` accepts `resolution: "merchant-accepted" | "declined"`, `message`, integer-kobo `refund_amount`, `uploaded_filename`, optional evidence ID. Use **`refund_amount`**, despite narrative text in the guide referring generically to an amount. [Disputes API](https://paystack.com/docs/api/dispute/)

Declining requires supporting upload evidence; fraud claims need structured evidence as well. Capture receipt, advertised event terms, communications, ticket delivery and admission records. Process create/reminder/resolution notifications; reminders occur every four hours. [Manage disputes](https://paystack.com/docs/payments/manage-disputes/)

Nigeria businesses must respond within **16 hours** or chargebacks are automatically accepted. The 24-hour event hold does not remove this obligation. Establish monitored operational ownership before launch. [Chargeback deadline](https://support.paystack.com/en/articles/2125698)

## Fees and exact-price accounting

Current published Nigeria pricing: local collections are **1.5% + ₦100**, with the flat fee waived below ₦2,500 and total local fees capped at ₦2,000. International Mastercard/Visa/Verve NGN payments are **3.9% + ₦100**; American Express has a different 4.5% rate. Disable dashboard fee-passing for this exact-price checkout. Do not assume every card has the local rate. [Transaction pricing](https://support.paystack.com/en/articles/2130306)

Recommended per-order accounting, preserving existing allocation:

```text
gross = advertised unit price × quantity (integer kobo)
commission = round(gross × 3%) once per order
provider_fee = actual verified Paystack collection fee
organiser_proceeds = gross − commission − provider_fee
```

Illustration, not a provider test: a local ₦2,500 order has ₦75 YRDLY commission and an estimated ₦137.50 Paystack fee, leaving ₦2,287.50 before withdrawal costs. Price remains ₦2,500. Fee-tier boundaries apply to the full order, not individual tickets. Allocate rounding remainders deterministically for partial refunds.

Nigeria transfer fees are ₦10 up to ₦5,000; ₦25 from ₦5,001 through ₦50,000; ₦50 above ₦50,000. [Transfer pricing](https://support.paystack.com/en/articles/2130370) An additional **₦50 stamp duty applies at ₦10,000 or more**, separately from the transfer fee, effective 18 February 2026. The published payroll exception is irrelevant to ordinary event organiser transfers. The duty is non-refundable once applied. [Stamp duty](https://support.paystack.com/en/articles/7573314)

Original collection fees are non-refundable. Refunds are funded from pending payouts first, then registered-business balance when applicable. New refund requests and disputes have a one-year transaction-age window from 15 October 2026. [Refund funding and eligibility](https://support.paystack.com/en/articles/2127106) Insufficient provider balance can prevent refund execution. [Refund errors](https://paystack.com/docs/api/errors/refund/)

Recommendation: distinguish collection fee, platform commission, transfer fee/duty and platform reserve. Never deduct commission again at withdrawal. Do not silently charge a new reserve percentage or transfer-fee policy to organisers; preserve the existing agreed policy and show a confirmed quote. Maintain a platform-funded reserve/top-up process for gross refunds, chargebacks and fees after proceeds have been withdrawn. Reserve sizing and contractual recovery from organisers remain business/operations decisions.

## Production gates and unresolved risks

1. **Manual Payouts activation evidence:** registered business; approved compliance; pending payouts cleared; Nigeria bank-partner consent signed and Manual Payout Account created; support confirms the schedule switch. These are account operations, not an API flag. Public docs and the supplied support email establish prerequisites, not activation of this account. [Manual payouts](https://support.paystack.com/en/articles/2131074)
2. **Provider liquidity:** prove collected payments actually become usable balance, establish any account-specific settlement delay, and fund reserve/withdrawal costs. Ticket success alone must not be treated as proof of provider cash availability. No account credentials or live balance were accessed for this research.
3. **Bank/transfer readiness:** verify recipient bank details with Paystack, establish the live transfer authorization mode, and preserve bank-change protections. Prove a controlled live transfer and reversal/reconciliation process before declaring bank delivery supported.
4. **Late payment after seat expiry:** the reviewed Transactions API has no Payluk-style escrow-deletion contract. Do not carry over “15 minutes means safely cancelled.” Design an expired reservation/late payment state: verify before release where possible; a later confirmed payment must atomically acquire available seats or enter a funded refund/review path, never oversell. Confirm Paystack session-expiry behavior before relying on it as cancellation.
5. **Shared database compatibility:** migration must preserve old provider routes and simultaneous old mobile clients. Gate new checkout by supported client/server behavior. Mixed-provider events require independent liabilities; Payluk money cannot fund Paystack withdrawals implicitly.
6. **Eligibility:** enforce event end plus 24 hours in the database/service boundary at withdrawal time, alongside cancellation, dispute, refund, already-withdrawn and reserved-amount checks. Moving an event end time must not accidentally unlock funds early. Missing/invalid timestamps fail closed.
7. **Accounting and operations:** decide documented refund commission/fee allocation, withdrawal cost handling, reserve funding and post-withdrawal chargeback recovery. Have a named 16-hour dispute response owner and monitoring. Support assistance is preferable to presenting an unimplemented refund as successful.
8. **Failure validation:** concurrent callbacks/webhooks, forged signatures, wrong currency/amount, duplicate success, setup timeouts, late payments/sold-out refunds, partial refunds, refund-vs-withdrawal races, unknown transfer outcomes, later reversals, and old Payluk orders all need targeted tests. Validate the database migration in development. Test-mode success is insufficient proof of live funds movement.

## Research validation

Official Paystack API, developer guides and support articles were retrieved on the review date. Local payment documentation, ticket purchase/verification/refund paths, ticket service, reservation migration and legacy event settlement were inspected. Firecrawl's advertised developer-search tool returned unavailable; official pages were retrieved using the web tool instead. No application code, secrets, production settings or database state were changed; no provider transaction, deployment or external message was sent. Only this Markdown report was created; application build/lint are not relevant to the documentation-only change.
