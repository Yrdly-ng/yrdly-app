---
name: payluk-api
description: >-
  Integrate the Payluk escrow payments REST API (api.payluk.ng). Use when building, debugging or
  reviewing any Payluk merchant integration: creating standard, milestone or vault escrows,
  onboarding merchant customers, funding escrows and wallets, confirming delivery, claiming funds,
  handling disputes and refunds, listing transactions, verifying webhook signatures, or wiring the
  Inline Checkout SDK. Covers authentication (sk_test_/sk_live_ keys, customer-id header), the
  response envelope, the escrow state machine, fees, pagination and every error message.
license: MIT
metadata:
  author: Payluk
  version: "1.0.1"
  docs: https://docs.payluk.ng
  repository: https://github.com/jerozeek/payluk-api-skill
---

# Payluk API

Payluk is an escrow payments platform for Nigeria. A **merchant** (you, the API key holder)
manages **merchant customers** who act as buyers and sellers. Money is held in escrow until the
buyer confirms delivery, then released to the seller net of fees. Everything below is what an
agent needs to write correct calls on the first try. Deeper material lives in `references/`.

## Ground rules (read before writing any request)

| Rule | Detail |
|---|---|
| Base URL | Staging `https://staging.api.payluk.ng` with `sk_test_` keys. Production `https://api.payluk.ng` with `sk_live_` keys. Every route is under `/v1`. |
| Auth | `Authorization: Bearer <secret key>` on **every** request. Keys stay server-side. The key prefix picks the environment; a key on the wrong host gets `403 Unauthorized Access`. |
| Key scope | Any approved business key can call the escrow, milestone-escrow and category routes. **Every other route needs a merchant super-admin key** (customers, wallet, merchant account, confirm, disputes, additional fee, vault, payments, cards, countries, whitelist) and answers `401 Access denied` otherwise. |
| Rate limit | **10 requests per minute per secret key**, all routes combined. Beyond that: `429 Too many request`. Read the `RateLimit` / `RateLimit-Policy` response headers and back off; never busy-retry. |
| IP allowlist | Production only: if the merchant listed IP addresses in the dashboard, other addresses get `403 Unauthorized IP address`. Staging never checks. |
| `customer-id` header | Says which merchant customer the call acts for. Required on wallet, payments, confirm-payment, milestone confirm, per-customer disputes, cards and crypto whitelist. **Optional on escrow and category routes**: omit it to act as the merchant's own business account (the seller). **Must be omitted** on merchant-wide routes (`customer-id is not allowed in request header`): resolve dispute, all-customers disputes, escrow feeds, additional fee, vault routes, merchant account, customer management. The customer must belong to the merchant (`403`) and be active (`401`). `references/endpoints.md` lists the rule per route. |
| Envelope | Every response is `{ "status": <http code>, "message": "...", "data": ... }`. Errors put the reason in `message` and `{}` in `data`. Branch on `status >= 400` and surface `message`. |
| Amounts | Major currency units (NGN), never kobo. `150000` means ₦150,000. At most two decimal places (`100.2`), everywhere: escrow amounts, milestone amounts, vault stakes, fees. Escrow minimum 1000. |
| Content types | Create escrow, edit escrow, submit dispute and resolve dispute are `multipart/form-data` (file uploads). Everything else is `application/json`. |
| Pagination | `page` (1-based) and `limit` (default 10, max 100 on history routes). Records sit under `data.data`, with `data.pagination` (`count`, `pages`, `isLastPage`, `nextPage`, `previousPage`). Passing `reference`, `fromDate` or `toDate` to a history route returns a flat array instead. |
| Escrow identity | Creation returns both `id` and `paymentToken`. Token-addressed routes (`edit`, `delete`, `verify`, `claim-funds`, `submit-dispute`, milestone read, vault routes) take `paymentToken`. Id-addressed routes (`confirm-payment`, `dispute/resolve`, `dispute/get/{escrowId}`, milestone confirm, `payment/escrow` body) take `id`. |
| Ids | Customer and escrow ids are 24-hex Mongo ObjectIds. Payment tokens look like `PY_8AB12C9D3045`. |
| Webhooks | Signed `POST` to the dashboard callback URL, header `x-payluk-signature` = hex HMAC-SHA512 of the raw body keyed with the environment's secret key. See `references/webhooks.md`. |
| Deprecated | `POST /v1/payment/virtual-account` returns `410`. Never suggest virtual accounts; collect with the Checkout SDK or an escrow payment. |

## Which flow does the user need?

| Scenario | Flow | Where |
|---|---|---|
| One item, one buyer, one release | Standard escrow | below, and `references/flows.md` |
| Sell N units of the same item off one link | Standard escrow with `totalQuantity > 1` | `references/flows.md`, multi-quantity section |
| Project paid upfront, released in stages | Milestone escrow | `references/flows.md`, milestone section |
| Two or more customers stake into a pot, merchant names the winner | Vault escrow | `references/flows.md`, vault section |
| Buyer says the item never arrived | Dispute, resolved by the merchant | `references/flows.md`, disputes section |
| Collect payment in a web front end | Inline Checkout SDK `payluk-escrow-inline-checkout` with a publishable key | https://docs.payluk.ng/sdk/introduction |
| React to state changes without polling | Webhooks | `references/webhooks.md` |

## The standard escrow flow (the common case)

Two actors: the **seller** (escrow created on their behalf) and the **buyer** (funds it). Set
`customer-id` to whichever one the step concerns.

1. **Create both customers once** (super-admin key, no `customer-id`).
   ```bash
   curl -X POST https://staging.api.payluk.ng/v1/customer/create \
     -H "Authorization: Bearer $PAYLUK_SECRET_KEY" -H "Content-Type: application/json" \
     -d '{"firstname":"Ada","lastname":"Eze","email":"ada@example.com","phone":"08012345678","countryId":"NG"}'
   ```
   `phone` is digits only, no `+`. `countryId` is optional (ISO code or an id from `GET /v1/countries`).
   Give the seller `canSell` and the buyer `canBuy` with `PUT /v1/customer/permissions/{customerId}`.

2. **Create the escrow as the seller** (`customer-id: <sellerId>`, multipart).
   ```bash
   curl -X POST https://staging.api.payluk.ng/v1/escrow/create \
     -H "Authorization: Bearer $PAYLUK_SECRET_KEY" -H "customer-id: $SELLER_ID" \
     -F "amount=150000" -F "purpose=MacBook Pro 14" -F "whoPays=both" \
     -F "maxDelivery=3" -F "deliveryTimeline=days" -F "totalQuantity=1"
   ```
   `amount` (min 1000), `purpose`, `whoPays`, `maxDelivery` (1 to 365) and `deliveryTimeline` are
   **all required**, on edit too. Returns `id`, `paymentToken`, `fee`, `state: AWAITING_PAYMENT`,
   `status: PENDING`. Editable and deletable only in this state. Omit `customer-id` only when the
   merchant's own business account is the seller; other account types get
   `Merchant cannot create escrow for itself via API`.

3. **Optional merchant delivery fee**: `PUT /v1/escrow/additional-fee/{paymentToken}` with
   `{"additionalFee": 2500}`, **no** `customer-id`, standard escrows only, only while unpaid.

4. **Make sure the buyer can pay.** Wallet funding on production: `POST /v1/payment/create-intent`
   (`transactionType: deposit`; with `depositDetails.cardId` the saved card is charged, without it the
   response carries a hosted collection: `checkoutConfig`, or `testAccount` on staging) then
   `POST /v1/payment/verify` with the returned `reference`. Staging shortcut: `POST /v1/payment/topup`
   `{"amount": 50000}` with `customer-id: <buyerId>` (1,000 to 100,000, once per customer per day).
   For a browser checkout use the Inline Checkout SDK instead.

5. **Fund the escrow as the buyer** (`customer-id: <buyerId>`).
   ```bash
   curl -X POST https://staging.api.payluk.ng/v1/payment/escrow \
     -H "Authorization: Bearer $PAYLUK_SECRET_KEY" -H "customer-id: $BUYER_ID" \
     -H "Content-Type: application/json" \
     -d "{\"amount\":153750,\"reference\":\"ESC_REF_98765\",\"transactionType\":\"escrow\",\"gateway\":\"wallet\",\"escrowDetails\":{\"escrowId\":\"$ESCROW_ID\"}}"
   ```
   `amount` must equal escrow `amount` + the buyer's fee share (all of `fee` for `whoPays: buyer`,
   half for `both`, none for `seller`) + `additionalFee`, or the call fails with `Amount mismatch`.
   Read the escrow first rather than caching a price. The escrow must still be `AWAITING_PAYMENT`.
   `gateway` is `wallet` (needs balance) or `card` (needs a saved `cardId`, Nigerian customers only);
   the default is `card`, so always send `wallet` explicitly. Crypto is **not** available on this
   route; the hosted Checkout SDK quotes a cNGN deposit address instead. On success the escrow is
   `OPENED` / `ONGOING` and the delivery window starts.

6. **Release**: the buyer confirms delivery with
   `POST /v1/escrow/confirm-payment/{escrowId}` (`customer-id: <buyerId>`). Escrow closes
   `CLOSED` / `COMPLETED`; the seller is paid net of fee, and commission plus any delivery fee land
   in the merchant wallet.

If the buyer never confirms and the delivery window has elapsed, the seller calls
`GET /v1/escrow/claim-funds/{paymentToken}` (`customer-id: <sellerId>`) and the escrow closes
`CLAIMED`. If something is wrong, the buyer opens a dispute (see below).

## Milestone, vault and multi-quantity in one paragraph each

**Milestone** (`POST /v1/escrow/milestone/create`, JSON, `customer-id: seller`): at least 2
milestones whose amounts (two decimal places, min 1) sum to `amount` (min 1000); `whoPays` must be
`buyer`; `maxDelivery` and `deliveryTimeline` are required; a `dueDate` must be in the future.
Disputable by the buyer over milestones still `PENDING`. The buyer funds the
whole amount once with `POST /v1/payment/escrow`, then confirms each milestone with
`POST /v1/escrow/milestone/confirm/{escrowId}/{milestoneId}` (`customer-id: buyer`), releasing that
milestone's net share to the seller (or to the milestone's optional `customerId` beneficiary). The
final confirm auto-completes the escrow. Read milestones with `GET /v1/escrow/milestone/{paymentToken}`.
Convert an unpaid standard escrow with `PUT /v1/escrow/milestone/convert/{paymentToken}`.

**Vault** (`POST /v1/escrow/vault/create`, JSON, **no** `customer-id`): 2+ unique active customers
each stake a positive integer from their main balance; the pot must be at least 1000 and is locked
at creation (all-or-nothing), so the vault is born `OPENED`. The merchant settles with
`POST /v1/escrow/vault/winner/{paymentToken}` `{"winnerId": "<customerId>"}` (pot minus fee to the
winner) or `POST /v1/escrow/vault/cancel/{paymentToken}` (stakes refunded minus pro-rata fee).
Vaults cannot be disputed.

**Multi-quantity**: `totalQuantity > 1` on a standard escrow makes the link a listing with stock.
Each buyer's payment mints a **clone** with its own `id` and `paymentToken`; the original stays
`AWAITING_PAYMENT` and counts down. Track the clone id returned by the payment for confirm, claim
and disputes. Keep sharing the original token. Not applicable to milestone escrows.

## Disputes

Only the **buyer** can open one, while the escrow is `OPENED`:
`POST /v1/escrow/submit-dispute/{paymentToken}` (multipart `message`, optional `file`,
`customer-id: buyer`). Status becomes `DISPUTED`. The seller replies once on the same route
(`customer-id: seller`), moving it to `INVESTIGATING`. Each side may submit once.

The **merchant** resolves with `POST /v1/escrow/dispute/resolve/{escrowId}` (multipart, **no**
`customer-id`): `resolution` text plus `status` of `COMPLETED` (release to seller), `REFUNDED`
(return to buyer) or `SPLIT` (send `sellerAmount` + `buyerAmount`, which must equal exactly what the
escrow still holds, not necessarily `amount`). `additionalFeeRefundable` decides who keeps the
delivery fee on a refund or split. Payluk never arbitrates merchant-customer disputes; the merchant does.

Views: `GET /v1/escrow/dispute/get` and `GET /v1/escrow/dispute/get/{escrowId}` need `customer-id`;
`GET /v1/escrow/all-dispute` and `GET /v1/escrow/feeds` must omit it.

## Gotchas checklist

Run through this before handing code back:

- Every request has `Authorization: Bearer`, with the key prefix matching the host.
- The client respects the 10 requests/minute limit: reads `RateLimit` headers, queues or backs off on `429`, never busy-retries.
- The merchant knows which routes need a super-admin key, and that production keys may be IP-restricted.
- `customer-id` present on customer-scoped routes and **absent** on merchant-wide ones.
- Standard create, edit, submit dispute, resolve dispute are multipart. Milestone and vault create are JSON.
- Escrow create and edit send `amount`, `purpose`, `whoPays`, `maxDelivery` (1 to 365) and `deliveryTimeline`; all five are required.
- Pay-escrow `amount` is computed from the escrow (`amount`, `fee`, `whoPays`, `additionalFee`), not hard-coded, and `gateway` is sent explicitly (`wallet` or `card` + `cardId`).
- `transactionType` values are lowercase in payment bodies (`escrow`, `deposit`, `withdrawal`, `wallet_transfer`). Escrow `status` and `state` values are uppercase.
- Milestone amounts have at most two decimal places and sum to `amount`, `whoPays: buyer`, at least 2 milestones.
- Nothing references virtual accounts.
- Webhook handlers verify `x-payluk-signature` against the **raw** body with the matching environment secret, de-duplicate on `data.reference` (payment events) or `data.id` + `event` (escrow events), return `2xx` fast, and never treat an event as a balance.
- Errors are read from `message`; `400` covers validation, wrong state and not found.
- `type` (`sales` | `buy`) is required on `GET /v1/escrow/transactions`.

## Helper scripts

- `scripts/payluk-request.mjs`: dependency-free Node 18+ CLI. Picks the base URL from the key prefix, adds headers, sends JSON or multipart, pretty-prints the envelope and exits non-zero on `status >= 400`.
  ```bash
  PAYLUK_SECRET_KEY=sk_test_... node scripts/payluk-request.mjs POST /v1/customer/create \
    --json '{"firstname":"Ada","lastname":"Eze","email":"ada@example.com","phone":"08012345678"}'
  PAYLUK_SECRET_KEY=sk_test_... node scripts/payluk-request.mjs POST /v1/escrow/create \
    --customer 665f1b2c9a1e4d0012ab3c01 --form amount=150000 --form "purpose=MacBook" --form whoPays=both
  ```
- `scripts/verify-webhook-signature.mjs`: verifies a webhook body against a signature. Importable or runnable.

## References

- `references/endpoints.md`: every route with method, path, `customer-id` rule, params and body fields. Generated from the spec.
- `references/flows.md`: step-by-step standard, multi-quantity, milestone, vault and dispute flows, plus payments and wallets.
- `references/webhooks.md`: event names, payload shapes, signature verification in Node and Python, retry behaviour.
- `references/errors-and-statuses.md`: every status code, error message, and enum value (`state`, `status`, `settlementType`, milestone and participant statuses, `whoPays`, `deliveryTimeline`).
- `references/openapi.json`: the full OpenAPI 3.0 spec, for exact schemas and examples.
- Live docs: https://docs.payluk.ng (API reference at `/api-reference`).
