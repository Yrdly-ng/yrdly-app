# Payluk API endpoint catalog

Generated from `openapi.json` (Payluk ThirdParty API v1.0.0). Do not edit by hand;
run `node scripts/build-endpoints.mjs` from the repo root after updating the spec.

Every route is mounted under `/v1` on `https://staging.api.payluk.ng` (sk_test_) or
`https://api.payluk.ng` (sk_live_). Every request carries `Authorization: Bearer <secret key>`.

The **customer-id** column says whether the `customer-id` header is `required`,
`optional`, must be `omit`ted (merchant-wide route), or is `no`t mentioned.
Bold body fields and parameters are required.

Full docs for each route: https://docs.payluk.ng/api-reference

## Escrow

Create and manage standard escrow payment links.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `POST /v1/escrow/create` | Create escrow | optional |  | `multipart/form-data`: **amount** (number), **purpose** (string), description (string), **whoPays** (buyer / seller / both), **maxDelivery** (integer), **deliveryTimeline** (minutes / hours / days), totalQuantity (integer), categoryId (string), imageUrl (string) |
| `PUT /v1/escrow/edit/{paymentToken}` | Edit escrow | optional | **paymentToken** | `multipart/form-data`: **amount** (number), **purpose** (string), **whoPays** (buyer / seller / both), **maxDelivery** (integer), **deliveryTimeline** (minutes / hours / days), imageUrl (string), description (string), totalQuantity (integer), categoryId (string) |
| `PUT /v1/escrow/additional-fee/{paymentToken}` | Update additional fee | omit | **paymentToken** | `application/json`: **additionalFee** (integer), additionalFeeRefundable (boolean) |
| `DELETE /v1/escrow/delete/{paymentToken}` | Delete escrow | optional | **paymentToken** |  |
| `GET /v1/escrow/verify/{paymentToken}` | Verify payment token | no | **paymentToken** |  |
| `GET /v1/escrow/claim-funds/{paymentToken}` | Claim funds | optional | **paymentToken** |  |
| `GET /v1/escrow/transactions` | List escrow transactions | optional | **type** (sales / buy), page, limit, categoryId, status |  |

### POST /v1/escrow/create

Generates a standard escrow payment link. Sent as `multipart/form-data` so up to 5 images can be attached under `imageUrl`. The **seller** is the account the request acts as: send `customer-id` with the selling customer's id. Omit the header only if your merchant account is itself a business account and is the seller; a merchant that is not a business account gets `401 Merchant cannot create escrow for itself via API`. `amount`, `purpose`, `whoPays`, `maxDelivery` and `deliveryTimeline` are all required. Amounts are naira with at most two decimal places (kobo), minimum 1000. `maxDelivery` is 1 to 365 `deliveryTimeline` units.

### PUT /v1/escrow/edit/{paymentToken}

Replaces the escrow's details. Editable only while the escrow is `AWAITING_PAYMENT`, and only by the seller (send the seller's `customer-id`, or omit it if your business account is the seller). The body is validated exactly like creation, so `amount`, `purpose`, `whoPays`, `maxDelivery` and `deliveryTimeline` are all required even if unchanged. New images are appended to the existing ones.

### PUT /v1/escrow/additional-fee/{paymentToken}

Sets your own charge (a delivery fee, handling, or similar) on top of one of your **standard** escrows. Every escrow starts at `additionalFee: 0`. The buyer is charged `amount + their fee share + additionalFee` at checkout, and the whole `additionalFee` is credited to **your merchant wallet** when the escrow completes, recorded as a `delivery` transaction so it stays separate from your commission. Payluk takes no cut of it, and it is not part of the escrow amount, so neither the seller's payout nor the escrow `fee` changes. ### When you can call this Only while the escrow is still `PENDING` / `AWAITING_PAYMENT`. Once the buyer pays, the charge is frozen, because they have already been quoted and debited a total that includes it. It is a plain setter until then: call it as often as you need, and send `0` to remove a charge you set earlier. Standard escrows only. Milestone and vault escrows are rejected. ### Refunds Who keeps the charge if a dispute is later resolved in the buyer's favour is normally decided **when you resolve that dispute**: Resolve dispute takes `additionalFeeRefundable` with your ruling, since only then do you know whether the delivery happened. Sending `additionalFeeRefundable` here just sets the default that applies if a dispute is resolved without an explicit choice: `true` (the default) returns the charge to the buyer, `false` credits it to you. Omit the field to leave the escrow's current setting untouched. **Super-admin key required.** Do **not** send the `customer-id` header.

### DELETE /v1/escrow/delete/{paymentToken}

Deletes an escrow. Allowed only while `AWAITING_PAYMENT` and only by the seller.

### GET /v1/escrow/verify/{paymentToken}

Resolves an escrow by its payment token. Used by a buyer to inspect a payment link before paying.

### GET /v1/escrow/claim-funds/{paymentToken}

Seller requests release of funds without the buyer's confirmation. Allowed only when the escrow is `OPENED` and the delivery window (`maxDelivery` × `deliveryTimeline`, counted from `paidAt`) has elapsed; before that the call fails with `Escrow cannot be claimed yet`. Send the seller's `customer-id`, or omit it if your business account is the seller. Closes the escrow as `CLAIMED`.

### GET /v1/escrow/transactions

Paginated list of escrows for the account the request acts as, filtered by `type` (`sales` for escrows it sells, `buy` for escrows it funded). Send `customer-id` to list a customer's escrows, or omit it for your merchant account's own. `type` is required; omitting it or sending another value returns `401`.

## Milestone Escrow

Escrows that release funds in parts as milestones are confirmed.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `POST /v1/escrow/milestone/create` | Create milestone escrow | required |  | `application/json`: **amount** (number), **purpose** (string), description (string), **whoPays** (buyer), **maxDelivery** (integer), **deliveryTimeline** (minutes / hours / days), totalQuantity (integer), categoryId (string), **milestones** (array) |
| `PUT /v1/escrow/milestone/edit/{paymentToken}` | Edit milestone escrow | required | **paymentToken** | `application/json`: **amount** (number), **purpose** (string), description (string), **whoPays** (buyer), **maxDelivery** (integer), **deliveryTimeline** (minutes / hours / days), totalQuantity (integer), categoryId (string), **milestones** (array) |
| `PUT /v1/escrow/milestone/convert/{paymentToken}` | Convert standard escrow to milestone | required | **paymentToken** | `application/json`: amount (integer), **milestones** (array) |
| `GET /v1/escrow/milestone/{paymentToken}` | Get milestones | no | **paymentToken** |  |
| `POST /v1/escrow/milestone/confirm/{escrowId}/{milestoneId}` | Confirm milestone | required | **escrowId**, **milestoneId** |  |

### POST /v1/escrow/milestone/create

Creates a milestone escrow (JSON body, no file upload). Rules: at least 2 milestones, every milestone amount is naira with at most two decimal places (minimum 1), and the **sum of milestone amounts must equal `amount`**. Requires the `customer-id` header. `maxDelivery` (1 to 365) and `deliveryTimeline` are required, and each milestone's `dueDate`, when given, must be a future date.

### PUT /v1/escrow/milestone/edit/{paymentToken}

Replaces the details and the full milestone set of a milestone escrow (JSON body, no file upload). Editable only while the escrow is still `AWAITING_PAYMENT`, and only by the seller that created it. The same rules as creation apply: at least 2 milestones, every milestone amount is naira with at most two decimal places (minimum 1), and the **sum of milestone amounts must equal `amount`**. The platform fee is recalculated from the new amount and the milestone ids are regenerated. Requires the `customer-id` header (the seller). `maxDelivery` (1 to 365) and `deliveryTimeline` are required.

### PUT /v1/escrow/milestone/convert/{paymentToken}

Converts an existing **standard** escrow into a milestone escrow by splitting its amount into milestones (JSON body, no file upload). Supply `amount` to set a new escrow amount, or omit it to keep the current one; either way the **sum of milestone amounts must equal the target amount**, and there must be at least 2 milestones. Conversion forces the escrow to be **buyer-paid** (`whoPays` becomes `buyer`) and recalculates the fee. Allowed only while the escrow is still `AWAITING_PAYMENT`, and only by the seller that created it. Requires the `customer-id` header (the seller).

### GET /v1/escrow/milestone/{paymentToken}

Returns the milestone list for an escrow, by payment token. Returns an empty array for standard (non-milestone) escrows.

### POST /v1/escrow/milestone/confirm/{escrowId}/{milestoneId}

Buyer approves one milestone; its full amount is released to the seller's main balance. If the milestone was created with a `customerId`, the funds are released to that customer's main balance instead. Requires the escrow to be funded (`OPENED`) and the caller to be the buyer. The escrow completes automatically when the final milestone is released.

## Vault Escrow

Merchant-only pooled-stake escrows: customers stake from their wallets and the merchant declares the winner.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `POST /v1/escrow/vault/create` | Create vault escrow | omit |  | `application/json`: **purpose** (string), description (string), categoryId (string), **participants** (array) |
| `POST /v1/escrow/vault/winner/{paymentToken}` | Declare vault winner | omit | **paymentToken** | `application/json`: **winnerId** (string) |
| `POST /v1/escrow/vault/cancel/{paymentToken}` | Cancel vault escrow | omit | **paymentToken** |  |
| `GET /v1/escrow/vault/{paymentToken}` | Get vault escrow | omit | **paymentToken** |  |

### POST /v1/escrow/vault/create

Creates a **funded** vault escrow in one call. Every participant must be a customer of the merchant with the stake available in their **main balance**; each stake is locked into the participant's own **escrow balance** immediately (all-or-nothing: if any stake cannot be locked, everything is rolled back). Merchant-only: do **not** send the `customer-id` header. Rules: at least 2 unique participants, stakes in naira with at most two decimal places (minimum 1), and the derived pot (sum of stakes) must be at least 1000.

### POST /v1/escrow/vault/winner/{paymentToken}

The merchant names the winning participant. Every stake is released from the participants' escrow balances and the **whole pot minus the platform fee** is credited to the winner's main balance. The escrow closes as `COMPLETED`. There is no dispute flow; the merchant is expected to have verified the outcome before calling this. Merchant-only: do **not** send the `customer-id` header.

### POST /v1/escrow/vault/cancel/{paymentToken}

Cancels an open vault. Each participant gets their stake back to their main balance **minus their pro-rata share of the platform fee**; the fee is collected whether the vault completes or is cancelled. The escrow closes as `REFUNDED`. Merchant-only: do **not** send the `customer-id` header.

### GET /v1/escrow/vault/{paymentToken}

Returns the vault escrow with its participants and (once declared) the winner. Merchant-only: do **not** send the `customer-id` header.

## Categories

Organise escrows into merchant-defined categories.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `POST /v1/escrow/category/create` | Create category | no |  | `multipart/form-data`: **name** (string), description (string), imageUrl (string), category_position (integer) |
| `PUT /v1/escrow/category/edit/{categoryId}` | Update category | no | **categoryId** | `multipart/form-data`: name (string), description (string), imageUrl (string), category_position (integer) |
| `GET /v1/escrow/category/get` | List categories | no | page, limit |  |
| `GET /v1/escrow/category/get/{categoryId}` | Get category by ID | no | **categoryId** |  |
| `PUT /v1/escrow/category/position/{categoryId}` | Update category position | no | **categoryId** | `application/json`: **newPosition** (integer) |
| `DELETE /v1/escrow/category/delete/{categoryId}` | Delete category | no | **categoryId** |  |

### POST /v1/escrow/category/create

Creates an escrow category. Sent as `multipart/form-data` so a cover image can be attached.

## Merchant Customers

Manage the buyers and sellers that transact under your merchant account.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `POST /v1/customer/create` | Create merchant customer | no |  | `application/json`: **firstname** (string), **lastname** (string), **email** (string), **phone** (string), countryId (string), bvn (string) |
| `GET /v1/customers` | List merchant customers | no | page, limit, email, phone |  |
| `GET /v1/customer/get/{customerId}` | Get merchant customer | no | **customerId** |  |
| `PUT /v1/customer/update/{customerId}` | Update customer | no | **customerId** | `application/json`: firstname (string), lastname (string), email (string) |
| `PUT /v1/customer/permissions/{customerId}` | Update customer permissions | no | **customerId** | `application/json`: canWithdraw (boolean), canBuy (boolean), canSell (boolean) |
| `PUT /v1/customer/block/{customerId}` | Block customer | no | **customerId** |  |
| `PUT /v1/customer/unblock/{customerId}` | Unblock customer | no | **customerId** |  |
| `GET /v1/wallet` | Get customer wallet | required |  |  |

### POST /v1/customer/create

Creates a customer (buyer/seller) under your merchant account. Requires the API key to belong to a merchant super-admin account. `phone` is digits only with no leading `+`; local and international spellings of the same number resolve to the same customer. `countryId` is optional and defaults to your merchant account's country; pass an ISO 3166-1 alpha-2 code (`NG`) or an `id` from Get countries. `bvn` is an optional 11-digit Bank Verification Number kept on the customer's record; virtual accounts are no longer issued, so it does not change how the customer is funded.

### GET /v1/customers

Lists your customers, newest first. Pass `email` or `phone` to look a single customer up instead of paging through the list. Both are unique among your customers, so either one identifies exactly one record: the response keeps the same shape, with that customer as the only row and a one-page `pagination`. Sending both narrows to the customer matching *both*, not to two results. `page` and `limit` are ignored on a lookup. If no customer matches, the request fails with `400` rather than returning an empty list.

### PUT /v1/customer/update/{customerId}

Corrects a customer's profile details. Only `firstname`, `lastname` and `email` are editable; `phone` and `bvn` carry verification state and change through their own flows. Send **at least one** of the three fields; any field you omit is left untouched. The customer is resolved scoped to your merchant account, so an ID belonging to another merchant is rejected. Email is unique per merchant, so reusing one that another of your customers already holds fails with a validation error. Requires the API key to belong to a merchant super-admin account.

### GET /v1/wallet

Returns the wallet balances for a specific merchant customer. Requires the `customer-id` header.

## Merchant Account

Your own balance and ledger, as distinct from your customers’.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `GET /v1/merchant/balance` | Get merchant balance | no |  |  |
| `GET /v1/merchant/transactions` | Get merchant transaction history | no | page, limit, type (deposit / withdrawal / transfer / wallet_transfer / escrow / commission / delivery), reference, fromDate, toDate |  |

### GET /v1/merchant/balance

Returns the balances on **your own** merchant wallet, as opposed to `GET /v1/wallet`, which answers for one of your customers. This is the account Payluk settles your earnings into: your share of every escrow fee, and any delivery fee you charged a buyer. Your customers' balances are their own and are never included here. Must **not** carry a `customer-id` header. Sending one is rejected rather than silently answered for that customer.

### GET /v1/merchant/transactions

Returns **your own** merchant ledger, as opposed to `GET /v1/payment/history`, which answers for one of your customers. These are the movements on your merchant wallet: `commission` (your share of an escrow fee), `delivery` (a delivery fee you charged a buyer), and any withdrawals you made. Your customers' escrow and wallet activity is not included; read that per customer from `GET /v1/payment/history`. By default the response is **paginated** (`{ pagination, data }`). Supplying any filter (`reference`, `fromDate`, or `toDate`) instead returns a **flat array** of the matching transactions. Must **not** carry a `customer-id` header.

## Disputes

Confirm deliveries, raise disputes and resolve them.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `POST /v1/escrow/confirm-payment/{escrowId}` | Buyer confirm payment (standard) | required | **escrowId** |  |
| `POST /v1/escrow/submit-dispute/{paymentToken}` | Submit dispute | required | **paymentToken** | `multipart/form-data`: **message** (string), file (string) |
| `GET /v1/escrow/dispute/get` | List my disputes | required | page, paymentToken, fromDate, toDate |  |
| `GET /v1/escrow/dispute/get/{escrowId}` | Get dispute by escrow ID | required | **escrowId** |  |
| `GET /v1/escrow/all-dispute` | List all customers' disputes | omit | page, limit, paymentId, fromDate, toDate |  |
| `GET /v1/escrow/feeds` | Get escrow feeds | omit | page, limit, status, customerId, categoryId, fromDate, toDate, paymentToken |  |
| `POST /v1/escrow/dispute/resolve/{escrowId}` | Resolve dispute | omit | **escrowId** | `multipart/form-data`: **resolution** (string), **status** (COMPLETED / REFUNDED / SPLIT), sellerAmount (number), buyerAmount (number), additionalFeeRefundable (boolean), file (string) |

### POST /v1/escrow/confirm-payment/{escrowId}

Buyer confirms delivery on a standard escrow; releases the full amount to the seller and completes the escrow. Requires the `customer-id` header (the buyer).

### POST /v1/escrow/submit-dispute/{paymentToken}

Open or reply to a dispute. The escrow must be `OPENED`. **Only the buyer can open a dispute**; the seller can only respond once the buyer has raised one, after which the merchant resolves it. Each side may submit once. Standard escrows are always disputable while open. A **milestone escrow** is disputable over the milestones the buyer has not yet confirmed; once every milestone is released the call fails with `All milestones have been released; there are no held funds to dispute`. **Vault escrows cannot be disputed.** Requires the `customer-id` header. Sent as `multipart/form-data` so evidence can be attached.

### GET /v1/escrow/dispute/get

Returns disputes for a specific customer. Requires the `customer-id` header.

### GET /v1/escrow/all-dispute

Merchant-wide dispute feed. Must **not** send a `customer-id` header.

### GET /v1/escrow/feeds

Merchant-wide feed of all customers' escrows. Must **not** send a `customer-id` header.

### POST /v1/escrow/dispute/resolve/{escrowId}

Merchant resolves a dispute: `COMPLETED` releases to the seller; `REFUNDED` returns funds to the buyer; `SPLIT` divides the held funds between them in amounts you name. Must **not** send a `customer-id` header; the escrow must belong to one of the merchant's customers. Sent as `multipart/form-data`. ### Splitting the held funds When neither side is wholly right, send `status: SPLIT` with `sellerAmount` and `buyerAmount`. The two must add up to exactly what the escrow still holds, which is **not** always `amount`: - **Standard escrow**: `amount` minus the seller's share of the escrow fee. On a buyer-paid escrow the seller pays no share, so the pool is the full `amount`. - **Milestone escrow**: the total of the milestones the buyer never confirmed. Already-released milestones stay with the seller and are untouched. Read the pool off the escrow before you rule, and send amounts with at most two decimal places. Amounts that do not add up are rejected and no money moves. Vault escrows cannot be split. The escrow closes as `SPLIT`, its still-held milestones are marked `SPLIT`, a `split` object records the division, and an `escrow.split` webhook fires. ### The additional (delivery) fee If the escrow carries an additional fee, **this is where you decide who keeps it**. By the time you rule on a dispute you know whether the delivery actually happened, which you could not know when you priced it. Send `additionalFeeRefundable` with the resolution: - **`true`**: the fee goes back to the buyer along with the refunded principal. Nothing was delivered. - **`false`**: the fee is credited to your merchant wallet as if the escrow had completed. The delivery cost was already incurred. Your choice is applied to this settlement **and saved on the escrow**, overriding whatever was set before payment. Omit the field to settle on the escrow's existing `additionalFeeRefundable` (which defaults to `true`). `REFUNDED` and `SPLIT` resolutions are affected; a `COMPLETED` one always pays the fee to you. The escrow fee itself is never refunded to either party, on a split any more than on a refund; see Fees & settlement.

## Payments

Fund wallets and escrows, verify references and manage payout details.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `POST /v1/payment/create-intent` | Create payment intent | required |  | `application/json`: **amount** (number), **reference** (string), **transactionType** (withdrawal / deposit / wallet_transfer), currency (string), withdrawalDetails (object), blockchainDetails (object), walletDetails (object), depositDetails (object) |
| `POST /v1/payment/verify` | Verify payment | required |  | `application/json`: **reference** (string), otp (string) |
| `POST /v1/payment/escrow` | Pay escrow (buy) | required |  | `application/json`: **amount** (number), **reference** (string), **transactionType** (escrow), gateway (wallet / card), cardId (string), currency (string), **escrowDetails** (object) |
| `GET /v1/payment/verify-phone/{phone}` | Verify phone number | no | **phone** |  |
| `GET /v1/payment/bank-list` | Get bank list | no |  |  |
| `GET /v1/payment/deposit/wallet` | Get master wallet address | no |  |  |
| `POST /v1/payment/verify-account` | Verify account number | required |  | `application/json`: **accountNumber** (string), **bankCode** (string), bankName (string) |
| `GET /v1/payment/history` | Get payment history | required | page, limit, type (deposit / withdrawal / transfer / wallet_transfer / escrow / delivery), reference, fromDate, toDate |  |
| `POST /v1/payment/virtual-account` | Generate virtual account (deprecated) **DEPRECATED** | required |  |  |
| `POST /v1/payment/topup` | Top up virtual account (staging only) | required |  | `application/json`: **amount** (number) |

### POST /v1/payment/create-intent

Creates a payment intent for a merchant customer. Set `transactionType` to one of: - **`withdrawal`**: a payout. For a **fiat bank withdrawal** supply `withdrawalDetails` (bank account); for a **crypto transfer** supply `blockchainDetails` (recipient address + network) instead. - **`deposit`**: a **card top-up** of the customer's wallet. with `depositDetails.cardId` the saved card is charged through Paystack (Nigerian customers only). Without a card the deposit becomes a **hosted collection**: on production the response carries a `checkoutConfig` for the active gateway's checkout, and on staging a `testAccount` (Payluk Test Bank details) to pay into; settle it with Verify payment once paid. - **`wallet_transfer`**: send funds to another Payluk wallet via `walletDetails`. ### Card deposits A `deposit` charges a **saved (tokenized) card**; it does not collect new card details. The `cardId` is the `id` of a card returned by List customer cards. A customer only has saved cards when the merchant has the **save-customer-cards** feature enabled on their account. With it enabled, when a merchant customer pays with a card through Payluk's **inline checkout**, Payluk **tokenizes** the card (stores its reusable payment authorization) against that customer. The tokenized card then appears in the cards list and can be charged here (via `depositDetails.cardId`) to top up the wallet without the customer re-entering card details. ### Withdrawal fees Payluk sets the `fee` on the returned intent; you do not send it. The customer is debited `amount + fee`, so reconcile against the `fee` you read back rather than assuming a figure. The fee depends on the amount and on which provider Payluk currently settles payouts through, and it may include VAT. It is fixed on the intent when the intent is created, so the figure you read back is the figure that will be charged. ### Two-step flow Creating the intent **only stages** the transaction; no money moves yet. To execute it, submit the returned `reference` to Verify payment. This separation exists for security. All field values are lowercase. Requires the `customer-id` header. Amounts are naira with at most two decimal places; the minimum is 100 for a deposit or transfer. Bank payouts are routed to whichever provider Payluk currently settles through, and a crypto payout to `blockchainDetails.toAddress` on BSC; the `gateway` field is resolved server-side and can be omitted.

### POST /v1/payment/verify

**Submits a previously created payment intent for processing.** Payment uses a deliberate two-step flow for security: Create payment intent only stages the transaction (no money moves), and this endpoint is what actually executes it: debiting the wallet and carrying out the withdrawal, crypto transfer, card charge, or wallet transfer. Pass the single `reference` returned when the intent was created. If the transaction requires confirmation (e.g. an SMS OTP / transaction PIN), include it as `otp`. Requires the `customer-id` header.

### POST /v1/payment/escrow

Fund an escrow from the buyer's Payluk wallet or a saved card. Works for standard and milestone escrows (a milestone escrow is funded in full here). `escrowDetails.escrowId` may be an array to fund several escrows in one call. Requires the `customer-id` header (the buyer). **`amount` must equal what the buyer owes**: the escrow `amount`, plus the buyer's share of `fee` (all of it when `whoPays` is `buyer`, half when `both`, none when `seller`), plus the escrow's `additionalFee`. Anything else is rejected with `Amount mismatch`, so read the escrow first rather than caching a quote. The escrow must be `AWAITING_PAYMENT` (`Escrow is not in a valid state for checkout` otherwise), and on live keys the buyer may not be the seller. **Gateways.** `wallet` debits the buyer's main balance (`Insufficient balance` if it does not cover the total). `card` charges a saved card and needs `cardId` from List customer cards; card payments are only available to Nigerian customers. Crypto (cNGN) collection is not available on this route: use the hosted Checkout SDK, which quotes the buyer a deposit address. The call both creates and settles the payment, so a successful response means the escrow is now `OPENED`. Verifying the same `reference` again with Verify payment is idempotent.

### GET /v1/payment/verify-phone/{phone}

Verify a phone number belongs to one of your merchant customers.

### GET /v1/payment/bank-list

Returns the banks you can pay out to, with the bank codes that Verify account number and `withdrawalDetails.bankCode` on Create payment intent expect. The list comes from whichever provider Payluk currently settles payouts through, and a bank code only means something to the provider that issued it. Fetch the list rather than hardcoding codes, and do not reuse a code stored from an earlier session: if the provider changes, a stored code stops resolving and the withdrawal fails. Code length varies by provider, so treat `code` as an opaque string.

### GET /v1/payment/deposit/wallet

Returns the Payluk deposit (master) wallet address a customer should send **cNGN** to in order to fund their wallet with crypto. Tokens must be sent as **BEP-20** on the **Binance Smart Chain (BSC)** network; sending any other token, or using any other chain, will result in lost funds. The response also includes a `qrCode` (data-URL image of the address) and an `explorerUrl` for the address on the BSC explorer. **⚠️ The customer's sending address must be whitelisted before depositing**; deposits from non-whitelisted addresses are rejected. Add it first via Add whitelisted address.

### POST /v1/payment/verify-account

Resolves the account name on a bank account, so you can show the customer who they are about to pay before you create the withdrawal. Take `bankCode` from Get bank list. A code from anywhere else, or one cached from an earlier session, may not resolve: the codes belong to whichever provider Payluk currently settles payouts through.

### GET /v1/payment/history

Returns the authenticated merchant customer's transaction history: money in and out across deposits, withdrawals, transfers, wallet transfers, and escrow payments. Each entry carries the amount, fee, status, type, and the type-specific detail object (`withdrawalDetails`, `walletDetails`, `escrowDetails`, etc.) for the matching transaction type. By default the response is **paginated** (`{ pagination, data }`). Supplying any filter (`reference`, `fromDate`, or `toDate`) instead returns a **flat array** of the matching transactions. Requires the `customer-id` header.

### POST /v1/payment/virtual-account

<Warning> **Deprecated — this endpoint no longer issues virtual accounts.** CBN rules require every inflow to arrive as a direct escrow payment. Money paid into a virtual account lands in a wallet with no escrow behind it and nothing recording what it was for, so the account can no longer be offered. Collect payments with the Payluk Checkout SDK instead: it opens an escrow first and settles the payment against it. </Warning> Every call now returns `410 Gone`, whatever the customer's country, gateway or BVN status. The path is kept so an existing integration is told what happened rather than receiving a `404`, which would read as a bad path. ## What to use instead 1. Create an escrow with Create escrow. 2. Collect payment for it with the Checkout SDK, or server-side with Create payment intent. 3. Confirm it with Verify payment.

### POST /v1/payment/topup

Test helper available only on the staging environment (`403` on production). Credits a customer's main balance directly, once per customer per day (`401 You can only top up your account once a day` on a second call). `amount` is between 1,000 and 100,000. Requires the `customer-id` header.

## Debit Cards

List and remove customers' saved debit cards.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `GET /v1/cards` | List customer debit cards | required |  |  |
| `DELETE /v1/card/{cardId}` | Remove customer debit card | required | **cardId** |  |

### GET /v1/cards

Requires the merchant to have the save-debit-cards feature enabled. Requires the `customer-id` header.

## Crypto Whitelist

Manage whitelisted crypto withdrawal addresses.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `GET /v1/whitelist-address` | List whitelisted addresses | required |  |  |
| `POST /v1/whitelist-address` | Add whitelisted address | required |  | `application/json`: **walletAddress** (string), **network** (BSC), label (string), otp (string) |
| `DELETE /v1/whitelist-address/{addressId}` | Remove whitelisted address | required | **addressId** |  |

## Misc

Supporting reference data.

| Method & path | Summary | customer-id | Params | Body |
|---|---|---|---|---|
| `GET /v1/countries` | Get countries | no |  |  |

