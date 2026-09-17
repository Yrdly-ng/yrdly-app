# Errors and enumerated values

## Status codes

Every response uses the envelope `{ "status", "message", "data" }`. The HTTP code and the
`status` field always agree. On an error `data` is `{}` and `message` is the reason.

| Code | Meaning |
|---|---|
| `200` | Success. |
| `201` | Resource created. |
| `400` | Validation failed, action not allowed in the current state, or **not found**. |
| `401` | Missing or invalid token, access denied (including a non-super-admin key on a super-admin route), a blocked account, or a disallowed action. |
| `403` | Unknown or wrong-host key (`Unauthorized Access`), IP not on the allowlist, feature not enabled, staging-only route on production, or a `customer-id` from another merchant. |
| `404` | The `customer-id` names no customer. |
| `410` | Deprecated route (`POST /v1/payment/virtual-account`). |
| `429` | Rate limit: more than 10 requests in a minute from one key. Body `{"status":429,"message":"Too many request"}`. |
| `500` | Server error, for example an action attempted by an ineligible account type. |
| `503` | Maintenance mode. Retry later. |

Some things other APIs report as `403`/`404` come back as `400`/`401` here. Always read `message`.

## Common messages

| Message | Cause |
|---|---|
| `No token provided` | Missing `Authorization` header. |
| `Unauthorized Access` | Unknown key, business not approved, or `sk_test_` on production / `sk_live_` on staging. |
| `Unauthorized IP address` | Production request from an address outside the merchant's allowlist. |
| `Too many request` | Rate limit (`429`). |
| `Access denied` | Key valid but not permitted for this action (a non-super-admin key on a super-admin route, or acting on a resource the customer does not own). |
| `customer-id header is required` | Customer-scoped route called without the header. |
| `customer-id is not allowed in request header` | Merchant-wide route sent the header. |
| `Customer not found` / `Customer does not belong to the merchant` | Bad `customer-id` (`404` / `403`). |
| `Your account is disabled. Please contact support` | The customer (or key owner) is blocked. |
| `Merchant cannot create escrow for itself via API` | Escrow created without `customer-id` by a merchant that is not a business account. |
| `Escrow is not in a valid state for checkout` | Pay-escrow on an escrow that is no longer `AWAITING_PAYMENT`. |
| `Insufficient balance` | Wallet payment, withdrawal or transfer exceeds `mainBalance`. |
| `Escrow cannot be claimed yet` | Claim funds before the delivery window has elapsed. |
| `Card payments are only available for Nigerian users` | `gateway: card` for a non-Nigerian customer. |
| `All milestones have been released; there are no held funds to dispute` | Dispute on a fully released milestone escrow. |
| `You can only top up your account once a day` | Second staging top-up within 24 hours (`401`). |
| `Action not allowed` | Escrow not in a state that permits this action (editing a funded escrow, claiming before the window, confirming twice). |
| `Escrow not found` | No escrow matches the token or id, or it belongs to another merchant. |
| `Amount mismatch` | Pay-escrow `amount` differs from escrow amount + buyer fee share + additionalFee. |
| `The sum of milestone amounts must equal the escrow amount` | Milestone amounts do not add up to `amount`. |
| `Buyer already submitted Dispute` / `Seller already submitted Dispute` | Each side may submit once per dispute. |
| `Vault escrows cannot be disputed` | Dispute attempted on a vault escrow. |
| `This feature is not enabled on your merchant account` | Route needs a feature flag on the merchant account. |
| `This route is only available on staging environment` | Staging-only helper (`/v1/payment/topup`) called on production. |

## Escrow `state`

| Value | Meaning |
|---|---|
| `AWAITING_PAYMENT` | Created, not yet funded. Editable and deletable. Additional fee mutable. |
| `OPENED` | Funded and held. Delivery in progress. Disputes possible. |
| `CLOSED` | Terminal: settled, claimed, refunded or split. |

## Escrow `status`

| Value | State | Meaning |
|---|---|---|
| `PENDING` | `AWAITING_PAYMENT` | Awaiting funding. |
| `ONGOING` | `OPENED` | Funded; delivery in progress. |
| `DISPUTED` | `OPENED` | Buyer opened a dispute. |
| `INVESTIGATING` | `OPENED` | Seller responded; merchant review. |
| `COMPLETED` | `CLOSED` | Released to the seller (confirmation, final milestone, vault winner, or merchant ruling). |
| `CLAIMED` | `CLOSED` | Seller claimed after the delivery window elapsed. |
| `REFUNDED` | `CLOSED` | Returned to the buyer (or vault cancelled). |
| `SPLIT` | `CLOSED` | Held funds divided between seller and buyer by the merchant. |

## `settlementType`

| Value | Meaning |
|---|---|
| `STANDARD` | Single release on delivery confirmation. |
| `MILESTONE` | Released per confirmed milestone. |
| `VAULT` | Pooled stakes released to the winner the merchant declares. |

## Milestone `status`

`PENDING` (not yet confirmed), `RELEASED` (net share paid), `REFUNDED` (still held when a dispute
was resolved for the buyer), `SPLIT` (still held when a dispute was resolved by splitting).

## Vault participant `status`

`STAKED` (locked in the participant's escrow balance), `RELEASED` (paid to the winner),
`REFUNDED` (returned minus fee share after cancellation).

## `whoPays`

| Value | Effect |
|---|---|
| `buyer` | Buyer pays the full Payluk fee on top of the amount. Required on milestone escrows. |
| `seller` | Fee deducted from the seller's payout. |
| `both` | Fee split between buyer and seller. |

## `deliveryTimeline`

`minutes`, `hours` or `days`: the unit for `maxDelivery`.

## Payment `transactionType` (lowercase)

`deposit`, `withdrawal`, `transfer`, `wallet_transfer`, `escrow`, `commission`, `delivery`.
Payment `status` is `success`, `failed` or `reversed`. `creditType` is `credit` or `debit`.

## Pay-escrow `gateway`

`wallet` (debit the buyer's Payluk wallet) or `card` (charge a saved `cardId`).

## Customer permissions

`canBuy`, `canSell`, `canWithdraw` booleans on `PUT /v1/customer/permissions/{customerId}`.
A buyer without `canBuy` is rejected at payment time. Blocked customers cannot transact or
participate in a vault.
