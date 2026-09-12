# Payluk webhooks

Payluk POSTs signed JSON to the **callback URL** set in the dashboard business settings, per
environment (test and live). No callback URL means nothing is sent. Two streams share one URL,
one envelope and one signature scheme; switch on `event`.

| Stream | Prefix | Fires when |
|---|---|---|
| Escrow lifecycle | `escrow.*` | An escrow created through the API under this merchant, whose seller is a merchant customer, is created or changes status. |
| Transactions | `payment.*` | A transaction belonging to one of the merchant's customers **settles** (never while pending), plus the `commission` and `delivery` payouts into the merchant wallet. Transactions on the merchant's own account do not fire. |

Records created with a `sk_live_` key post to the live URL signed with the live secret;
`sk_test_` records post to the test URL signed with the test secret. `data.environment`
(`live` | `test`) tells you which secret verifies a payload.

## Envelope

```json
{ "event": "escrow.completed", "data": { "...": "..." }, "timestamp": "2026-06-22T12:00:00.000Z" }
```

## Escrow events

`escrow.<status lower-cased>`, plus `escrow.created`:

| Event | Lifecycle |
|---|---|
| `escrow.created` | `AWAITING_PAYMENT` |
| `escrow.pending` | `AWAITING_PAYMENT` |
| `escrow.ongoing` | `OPENED` (buyer funded) |
| `escrow.disputed` | `OPENED` |
| `escrow.investigating` | `OPENED` |
| `escrow.completed` | `CLOSED` |
| `escrow.claimed` | `CLOSED` |
| `escrow.refunded` | `CLOSED` |
| `escrow.split` | `CLOSED`, payload carries `split: { sellerAmount, buyerAmount, pool, resolvedAt }` |

`data` mirrors the escrow object from the API: `id`, `amount`, `purpose`, `whoPays`, `fee`,
`additionalFee`, `additionalFeeRefundable`, `paymentToken`, `sellerId`, `buyerId`, `status`,
`state`, `settlementType`, `milestones`, `totalQuantity`, `dispute`, `paymentId`, `maxDelivery`,
`deliveryTimeline`, `createdAt`, `updatedAt`, `environment`, `merchantId`, and more.
Multi-quantity links emit per escrow (original and each clone): match on `data.id`.

## Transaction events

`payment.<transactionType>.<outcome>` where outcome is `success`, `failed` or `reversed`:

| Event | Fires when |
|---|---|
| `payment.deposit.success` | Customer funded their wallet (hosted checkout, card, crypto). |
| `payment.transfer.success` | Money paid into a customer's reserved bank account was credited. |
| `payment.withdrawal.success` | Payout to bank or crypto address completed. |
| `payment.wallet_transfer.success` | Wallet-to-wallet send completed (one event per side). |
| `payment.escrow.success` | Ledger entry for an escrow funding (alongside `escrow.ongoing`). |
| `payment.commission.success` | Merchant's share of the escrow fee paid into the merchant wallet. |
| `payment.delivery.success` | An `additionalFee` paid into the merchant wallet. |

`data` fields: `id`, `reference` (unique, de-duplicate on it), `amount`, `fee`, `currency`,
`status`, `transactionType`, `creditType` (`credit` wallet went up, `debit` went down),
`customerId`, `withdrawalDetails`, `walletDetails`, `escrowDetails`, `blockchainDetails` (only the
matching one populated), `createdAt`, `updatedAt`, `environment`, `merchantId`. The payload never
names the settlement rail; do not branch on a bank or processor.

Funding an escrow yields both `payment.escrow.success` and `escrow.ongoing`. Act on one stream.

## Verify the signature

Header `x-payluk-signature`: hex **HMAC-SHA512** of the **raw request body** keyed with the
environment's secret key (`sk_live_...` or `sk_test_...`). Compare in constant time. Hash the exact
bytes received; re-serialising parsed JSON changes the signature.

Headers sent: `Content-Type: application/json`, `User-Agent: Payluk-Webhook/1.0`, `x-payluk-signature`.

```js
// Node.js (Express)
import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.post("/webhooks/payluk", (req, res) => {
  const secret = process.env.PAYLUK_SECRET_KEY;
  const expected = crypto.createHmac("sha512", secret).update(req.rawBody).digest("hex");
  const received = req.headers["x-payluk-signature"] ?? "";
  const valid = received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  if (!valid) return res.status(401).send("Invalid signature");

  const { event, data } = req.body;
  if (event.startsWith("payment.")) {
    // ledger: de-duplicate on data.reference
  } else if (event.startsWith("escrow.")) {
    // deal tracking: de-duplicate on data.id + event, trust data.status/state
  }
  res.sendStatus(200); // acknowledge fast, do heavy work asynchronously
});
```

```python
# Python (Flask)
import hmac, hashlib, os
from flask import Flask, request, abort

app = Flask(__name__)

@app.post("/webhooks/payluk")
def payluk_webhook():
    secret = os.environ["PAYLUK_SECRET_KEY"].encode()
    expected = hmac.new(secret, request.get_data(), hashlib.sha512).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("x-payluk-signature", "")):
        abort(401)
    payload = request.get_json()
    # handle payload["event"]
    return "", 200
```

`scripts/verify-webhook-signature.mjs` in this skill does the same from the command line.

## Delivery and retries

| Behaviour | Detail |
|---|---|
| Timeout | 10 seconds for your response. |
| Retries | Up to 3, exponential backoff. |
| Delivery | Best-effort. A failure is logged and never rolls back the operation. |

## Handler rules

- Reject missing or mismatched signatures with `401`.
- Be idempotent: the same event may arrive more than once.
- Return `2xx` for unknown events; new names are added over time.
- Do not assume order. Trust `data.status` / `data.state`, and re-fetch when unsure
  (`GET /v1/escrow/verify/{paymentToken}`, `GET /v1/wallet`).
- A transaction event is not a balance. Read balances from `GET /v1/wallet`.
- Separate test and live endpoints, each verified with its own secret.
