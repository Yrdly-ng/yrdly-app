# Payluk integration flows

Every call carries `Authorization: Bearer <secret key>`. `customer-id` is shown per step.
Source of truth: https://docs.payluk.ng/concepts/how-it-works

## Set up once

| Call | `customer-id` | Notes |
|---|---|---|
| `GET /v1/countries` | omit | Country `id`s and ISO codes. Optional. |
| `GET /v1/escrow/category/get`, `POST /v1/escrow/category/create` | omit | Optional catalog for grouping escrows. |
| `POST /v1/customer/create` (seller, then buyer) | omit | Super-admin key. Body: `firstname`, `lastname`, `email`, `phone` (digits, no `+`), optional `countryId`, optional `bvn`. |
| `PUT /v1/customer/permissions/{customerId}` | omit | `canBuy`, `canSell`, `canWithdraw`. Seller needs `canSell`, buyer needs `canBuy`. |

Keep the customer ids; they are the `customer-id` header for everything after this.

## Standard escrow

```
Create (seller) -> [additional fee (merchant)] -> [buyer verifies token] -> fund (buyer)
  -> confirm (buyer) => COMPLETED
  -> window elapsed, claim (seller) => CLAIMED
  -> dispute (buyer) -> respond (seller) -> resolve (merchant) => COMPLETED | REFUNDED | SPLIT
```

1. `POST /v1/escrow/create`, `customer-id: seller` (omit only if the merchant's business account is
   the seller), multipart. Required `amount` (min 1000, two decimals), `purpose`, `whoPays`
   (`buyer` | `seller` | `both`), `maxDelivery` (1 to 365) and `deliveryTimeline`
   (`minutes` | `hours` | `days`). Optional `description`, `totalQuantity`, `categoryId`, `imageUrl`
   (repeat up to 5 times). Edit re-validates the same required set.
   Response `data`: `id`, `paymentToken`, `amount`, `fee`, `state: AWAITING_PAYMENT`,
   `status: PENDING`, `settlementType: STANDARD`.
2. Optional: `PUT /v1/escrow/edit/{paymentToken}` (seller, multipart, only while unpaid, images
   append) or `DELETE /v1/escrow/delete/{paymentToken}`.
3. Optional merchant delivery fee: `PUT /v1/escrow/additional-fee/{paymentToken}`, JSON
   `{"additionalFee": 2500, "additionalFeeRefundable": true}`, **no** `customer-id`, only while
   unpaid, standard escrows only, `0` clears it. Paid to the merchant wallet on completion as a
   `delivery` transaction.
4. Optional buyer preview: `GET /v1/escrow/verify/{paymentToken}` returns the full escrow.
5. Fund the buyer's wallet if paying with `gateway: wallet` (see Payments below), or skip if
   charging a saved card.
6. `POST /v1/payment/escrow`, `customer-id: buyer`, JSON:
   ```json
   {
     "amount": 153750,
     "reference": "ESC_REF_98765",
     "transactionType": "escrow",
     "gateway": "wallet",
     "escrowDetails": { "escrowId": "665f1b2c9a1e4d0012ab3c10" }
   }
   ```
   `amount` = escrow `amount` + buyer fee share + `additionalFee`. For `whoPays: both` the buyer's
   share is half of `fee`; for `buyer` it is all of `fee`; for `seller` it is `0`. Read the escrow
   rather than computing from a cached quote. `escrowDetails.escrowId` may be an array to fund
   several escrows at once. `gateway` defaults to `card`, so send `wallet` explicitly for a wallet
   payment; `card` needs `cardId` from `GET /v1/cards` and is Nigerian-only. Crypto (cNGN) is not
   offered on this route: the hosted Checkout SDK quotes the buyer a per-payment deposit address.
   The call creates and settles the payment in one step; verifying the same `reference` again is
   idempotent. Escrow becomes `OPENED` / `ONGOING`; the delivery window starts.
7. `POST /v1/escrow/confirm-payment/{escrowId}`, `customer-id: buyer`. Escrow closes
   `CLOSED` / `COMPLETED`. Seller receives amount net of their fee share; the merchant wallet
   receives `commission` and any `delivery` fee.

### Exceptions

- **Seller claim**: `GET /v1/escrow/claim-funds/{paymentToken}`, `customer-id: seller`. Allowed
  only when `OPENED` and `maxDelivery` has elapsed. Closes `CLAIMED`.
- **Dispute**: see Disputes below.

## Multi-quantity escrows

`totalQuantity > 1` on a standard escrow created through the API by an eligible seller turns the
link into a listing with stock:

- On each successful `POST /v1/payment/escrow` Payluk mints a **clone** (fresh `id`,
  `paymentToken`, `fee`) and attaches the payment to the clone. The clone runs its own lifecycle.
- The original stays `AWAITING_PAYMENT` and its `totalQuantity` decrements. At `0` the link is
  sold out and a further payment funds nothing extra.
- A failed payment deletes the half-made clone so stock is not consumed.
- Use the clone's `id` (from the payment response or `GET /v1/escrow/transactions`) for
  confirm, claim and disputes. Keep sharing the original `paymentToken`.
- Webhooks fire per escrow; match on `data.id`, not the token.
- Not applicable to milestone escrows.

## Milestone escrow

```
Create (seller, JSON) -> fund in full (buyer) -> confirm milestone 1..n-1 (buyer) -> confirm final => COMPLETED
```

1. `POST /v1/escrow/milestone/create`, `customer-id: seller`, JSON:
   ```json
   {
     "amount": 1000000,
     "purpose": "Company website build",
     "whoPays": "buyer",
     "milestones": [
       { "title": "Design", "amount": 300000, "dueDate": "2026-07-15" },
       { "title": "Development", "amount": 500000, "dueDate": "2026-08-15", "customerId": "665f1b2c9a1e4d0012ab3c40" },
       { "title": "Deployment", "amount": 200000 }
     ]
   }
   ```
   Rules: at least 2 milestones, amounts with at most two decimal places (min 1) summing to
   `amount` (min 1000), `whoPays` must be `buyer`, `maxDelivery` (1 to 365) and `deliveryTimeline`
   required, `dueDate` (optional) in the future. A milestone's optional `customerId` is the
   beneficiary who receives that milestone's funds instead of the seller. Response has `settlementType: MILESTONE` and `milestones[]`, each
   with `id` and `status: PENDING`.
2. Convert an unpaid standard escrow instead: `PUT /v1/escrow/milestone/convert/{paymentToken}`.
3. Fund in full: `POST /v1/payment/escrow`, `customer-id: buyer`, same body as standard.
4. Read: `GET /v1/escrow/milestone/{paymentToken}` (returns `[]` for a standard escrow).
5. Confirm each: `POST /v1/escrow/milestone/confirm/{escrowId}/{milestoneId}`,
   `customer-id: buyer`. Releases that milestone's net share (amount minus pro-rata fee);
   milestone `status` becomes `RELEASED`.
6. Confirming the last milestone auto-completes the escrow. No separate confirm-payment call.

Edit before funding with `PUT /v1/escrow/milestone/edit/{paymentToken}`. Additional (delivery)
fees are rejected on milestone escrows. The dispute-resolution docs allow a dispute over
milestones still held; released milestones cannot be contested.

## Vault escrow

Merchant-only pooled stakes. **Never** send `customer-id` on vault routes.

1. `POST /v1/escrow/vault/create`, JSON:
   ```json
   {
     "purpose": "FIFA tournament stake",
     "participants": [
       { "customerId": "665f1b2c9a1e4d0012ab3c40", "amount": 600000 },
       { "customerId": "665f1b2c9a1e4d0012ab3c41", "amount": 400000 }
     ]
   }
   ```
   Rules: 2+ unique, active customers of this merchant; stakes with at most two decimal places
   (min 1); pot (sum) at least 1000; every stake must be available in the participant's main balance. Stakes lock at
   creation, all-or-nothing, so the vault is created `OPENED` / `ONGOING` with participants
   `STAKED`. No payment step.
2. `GET /v1/escrow/vault/{paymentToken}` to inspect.
3. Settle with one of:
   - `POST /v1/escrow/vault/winner/{paymentToken}` `{"winnerId": "<customerId>"}`: pot minus
     platform fee to the winner's main balance; participants `RELEASED`; escrow `COMPLETED`.
   - `POST /v1/escrow/vault/cancel/{paymentToken}`: each stake returned minus its pro-rata fee
     share; participants `REFUNDED`; escrow `REFUNDED`.

The fee is collected in both outcomes. Vaults cannot be disputed; verify the outcome off-platform
before declaring.

## Disputes

Roles: buyer (opens), seller (responds), merchant (resolves and disburses). Payluk does not
arbitrate; the merchant does. A dispute is only possible while the escrow is `OPENED`.

1. Buyer opens: `POST /v1/escrow/submit-dispute/{paymentToken}`, `customer-id: buyer`, multipart
   `message` (+ optional `file`). Escrow `status: DISPUTED`. The seller is notified.
2. Seller responds on the same route with `customer-id: seller`. Escrow `status: INVESTIGATING`.
   Each side may submit once (`Buyer already submitted Dispute` / `Seller already submitted Dispute`).
3. Merchant reviews:

   | View | Route | `customer-id` |
   |---|---|---|
   | One customer's disputes | `GET /v1/escrow/dispute/get` | required |
   | One dispute thread | `GET /v1/escrow/dispute/get/{escrowId}` | required |
   | Every customer's disputes | `GET /v1/escrow/all-dispute` | omit |
   | All escrow activity | `GET /v1/escrow/feeds` | omit |

4. Merchant resolves: `POST /v1/escrow/dispute/resolve/{escrowId}`, **no** `customer-id`, multipart:

   | Field | Required | Notes |
   |---|---|---|
   | `resolution` | yes | Decision note, stored under `dispute.admin`. |
   | `status` | yes | `COMPLETED` (release to seller), `REFUNDED` (return to buyer), `SPLIT`. |
   | `sellerAmount`, `buyerAmount` | on `SPLIT` | Must sum to exactly what the escrow still holds: `amount` minus the seller's fee share on a standard escrow, the unreleased milestones on a milestone escrow. Rejected on other statuses. |
   | `additionalFeeRefundable` | no | On `REFUNDED` or `SPLIT`: `true` returns the delivery fee to the buyer, `false` credits it to the merchant. Omit to keep the escrow's default. |
   | `file` | no | Supporting document. |

The `dispute` object on the escrow records `buyer`, `seller` and `admin` entries, each with
`userId`, `message`, optional `proofUrl`, `createdAt`. A `SPLIT` closes with a `split` object
(`sellerAmount`, `buyerAmount`, `pool`, `resolvedAt`).

## Payments and wallets

Each customer has `mainBalance` (spendable) and `escrowBalance` (locked in open escrows):
`GET /v1/wallet` with `customer-id`.

Two-step intent model for anything that is not an escrow payment:

1. `POST /v1/payment/create-intent`, `customer-id`, JSON with `amount`, unique `reference`,
   `transactionType` and the matching detail object:
   - `deposit` (min 100): with `depositDetails.cardId` (saved card from `GET /v1/cards`) the card is
     charged through Paystack, Nigerian customers only. Without a card the deposit becomes a hosted
     collection and the response carries `checkoutConfig` (production) or `testAccount` (staging
     Payluk Test Bank details) for the customer to pay; verify afterwards.
   - `withdrawal` to a bank: `withdrawalDetails` (`accountName`, `accountNumber`, `bankName`,
     `bankCode` from `GET /v1/payment/bank-list`, optional `narration`). Resolve the name first
     with `POST /v1/payment/verify-account` `{accountNumber, bankCode}`.
   - `withdrawal` to crypto: `blockchainDetails` (`toAddress` 0x + 40 hex, `network: BSC`,
     optional `tokenAddress`). The address should be on the whitelist (`/v1/whitelist-address`).
   - `wallet_transfer`: `walletDetails` (`phone` 11 digits, `name`, optional `narration`).

   Nothing moves yet; the response carries a `reference`.
2. `POST /v1/payment/verify`, `customer-id`, `{"reference": "...", "otp": "..."}` executes it.
   `otp` only when the transaction needs confirmation.

Staging helper: `POST /v1/payment/topup` `{"amount": 50000}` credits a customer's wallet, 1,000 to
100,000, once per customer per day (staging only; `403` on production). The Payluk Test Bank guide at https://docs.payluk.ng/guides/payluk-test-bank
covers simulating bank transfers on staging.

History: `GET /v1/payment/history` (`customer-id`, a customer's ledger) and
`GET /v1/merchant/transactions` (no `customer-id`, the merchant's own `commission`, `delivery`
and withdrawal movements). Both paginate by default; any of `reference`, `fromDate`, `toDate`
switches the response to a flat array. `GET /v1/merchant/balance` returns the merchant wallet.

Cards: `GET /v1/cards`, `DELETE /v1/card/{cardId}` (`customer-id`). Crypto whitelist:
`GET` / `POST /v1/whitelist-address`, `DELETE /v1/whitelist-address/{addressId}` (`customer-id`).

Virtual accounts (`POST /v1/payment/virtual-account`) are deprecated and return `410`. Collect
inflows as escrow payments, through the Inline Checkout SDK or `POST /v1/payment/escrow`.

## Inline Checkout SDK (front end)

`npm i payluk-escrow-inline-checkout`. The backend creates the escrow with the secret key and hands
the `paymentToken` to the browser; the SDK's `pay()` opens a hosted widget using the **publishable
key** (safe client-side) and funds the escrow. Settle (confirm, disputes) server-side afterwards.
React users get `useEscrowCheckout()` and `<EscrowCheckoutButton>`. Errors are `EscrowCheckoutError`
with codes. Docs: https://docs.payluk.ng/sdk/javascript and https://docs.payluk.ng/sdk/react.
