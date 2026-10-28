Subject: Confirming milestone escrow and marketplace commission setup for YRDLY

Hello Payluk team,

We use Payluk for YRDLY, a marketplace connecting customers with independent businesses. We want to introduce staged payments for service bookings and would appreciate confirmation of the supported integration before enabling it.

Our intended flow is:

1. The business accepts the appointment and final price.
2. The customer funds the entire service price once.
3. The customer explicitly approves release of 50% to the business upfront.
4. The other 50% remains held until the customer confirms the completed service.
5. The business withdraws released earnings manually.

For a NGN 3,000 service, the business should receive two NGN 1,500 releases. YRDLY also needs to collect its 3% platform commission (NGN 90), with all fees disclosed before payment.

Your documentation says milestone escrows require whoPays=buyer, while the additional-fee endpoint is for standard escrows. Our existing standard escrow integration uses an additional fee for YRDLY's 3%, with the optional dashboard merchant commission set to zero to avoid double charging.

Could you please confirm:

- How can we collect YRDLY's 3% on milestone escrows while preserving the two equal service releases? Is there a per-escrow commission setting, or a supported alternative?
- If dashboard commission is required, can it apply only to milestone/service payments? Would enabling it change existing standard marketplace or event payments, and how should we prevent duplicate commission?
- For the NGN 3,000 example, what exact escrow principal, buyer debit, Payluk fee, merchant commission and seller credits should we expect? When is the merchant commission credited?
- Can both milestones have the same seller beneficiary, with the first buyer-confirmed immediately after funding and the second only after service completion? Does Inline Checkout support funding these escrows on both web and mobile WebView?
- Which signed webhook events identify individual milestone releases, including milestone ID and amount? How should we verify and reconcile duplicate callbacks or an uncertain confirmation response?
- Can a seller claim a pending milestone after the delivery deadline without customer confirmation? Can this be disabled so our completion rule is enforced?
- If the business cancels before work starts, how is the full payment refunded? If the first half has already been released, how are cancellation, no-show, disputes and partial refunds handled, including fee refunds?
- What sandbox fixtures and account permissions should we use to validate the complete flow? Please also confirm the production rate limits and any way to increase capacity beyond the documented key-wide limit.

We are keeping the new staged checkout disabled until the commission and settlement behavior are confirmed. Existing paid bookings will retain their original terms.

Please share the recommended endpoints, request examples, webhook payloads and any required dashboard configuration.

Thank you,
YRDLY team
