# YRDLY notification coverage — 17 November 2026

Status: **engineering contract / QA plan, not a live rollout**. Notification templates and hooks need verified status transitions and user-owned destinations before release. Never equate an API request, queued job or Expo receipt with device display.

## Product rules

- The notification inbox records **meaningful events affecting the user**. Push notifications highlight important events, rather than every intermediate button press.
- Personalize from **server-verified sender and object names**. Never trust sender name, price, buyer, status or amount provided solely by a client notification request.
- Mention both sides of a transaction where appropriate. Use the *real persisted* recipient and role; never send a seller event to the buyer or vice versa.
- A payment is "confirmed" only after authoritative payment reconciliation or webhook validation. Escrow funds are not "released" merely because a user tapped "Payment completed" or returned from their banking app.
- Never send self-notifications for one's own likes, comments, follows or messages. Enforce block and mute relationships.
- Group social activity on the same target, e.g. "Caleb and 6 others liked your post". Only show the count computed from actual distinct actors; remove an actor on unlike.
- Push should not contain message text, bank data, receipt references, exact addresses or amounts on a lock screen. For financial updates, push shows an actionable status and links to the authenticated, detailed in-app view.
- Marketing/new-event discoveries, daily prompts and recommendation blasts require separate opt-in and frequency limits. They are not transactional.
- Respect category preferences and OS permissions. Security and financial records should remain visible in-app where required, even when promotional push is off.
- Use unique event IDs and dedupe keys, with retry/receipt monitoring; don't send duplicate notifications for webhook retries.
- Navigation must verify notification owner and object access; no cross-account push on a reused device.

## Notification coverage inventory

This table defines the **target product behavior**, not an assertion that every workflow already works end-to-end.

| Domain | Trigger (authoritative event) | Recipient | Example notification | Priority |
| --- | --- | --- | --- | --- |
| Social | Direct message persisted | Recipient | Caleb sent you a message | High |
| Social | New post like persisted | Post author | Caleb liked your post | Normal, group |
| Social | Multiple distinct likes on same post | Post author | Caleb and 6 others liked your post | Group, avoid spam |
| Social | Comment or reply persisted | Relevant post/comment author, unless actor | Caleb commented on your post | Normal, group by post/thread |
| Social | Follow persisted | Followed person | Caleb started following you | Normal |
| Social | Mention persisted and authorized | Mentioned person | Caleb mentioned you in a comment | Normal |
| Social | Friend request accepted | Requester | Caleb accepted your connection request | Normal |
| Marketplace | Confirmed purchase/order persisted | Seller | New order: Caleb bought your sneakers | High |
| Marketplace | Payment/escrow verified | Buyer and seller, with role-specific copy | Payment confirmed for your order | High |
| Marketplace | Order accepted or rejected | Buyer | Your order was accepted / could not be fulfilled | High |
| Marketplace | Seller officially dispatches or releases item | Buyer | Your sneakers have been dispatched | High |
| Marketplace | Delivery confirmation | Buyer and seller, appropriate copy | Delivery confirmed for your order | High |
| Marketplace | Escrow released or refund settled | Beneficiary | Funds released / Refund processed | High |
| Marketplace | Dispute opened, action needed or resolved | Actual parties | Your transaction dispute has been updated | High |
| Marketplace | Withdrawal/payout settled or failed | Beneficiary | Payout processed / Payout needs attention | High |
| Marketplace | Item inquiry/new buyer message | Seller | Caleb asked about your listing | High |
| Businessplace | New booking placed | Business owner | Caleb requested a booking with your business | High |
| Businessplace | Booking confirmed/declined/cancelled | Customer | Your booking has been confirmed | High |
| Businessplace | Appointment reminder based on scheduled time | Relevant customer/provider | Your booking starts tomorrow | Normal |
| Businessplace | Quote requested or estimated | Customer/provider | Your service estimate is ready | High |
| Businessplace | Business review published | Business owner | Caleb reviewed your business | Normal |
| Businessplace | Catalog inquiry or inventory out of stock | Business owner | Someone asked about an item / Item out of stock | Normal |
| Events | Ticket purchase/RSVP confirmed | Attendee, organizer with distinct copy | Your event ticket is confirmed / New ticket sale | High |
| Events | Event invitation accepted or rejected | Organizer/recipient where relevant | Caleb accepted your invitation | Normal |
| Events | Event changed or cancelled | Ticket holders/registered attendees | Your event has been rescheduled / cancelled | High |
| Events | Event starts soon (scheduled) | Attendee | Your event starts tomorrow | Normal |
| Events | Check-in scanned/validated | Attendee, organizer when useful | You're checked in to the event | Normal |
| Events | Event payout eligible/processed | Organizer | Your event payout is ready / processed | High |
| Trust & safety | Important safety alert in the relevant location | Affected opted-in users | Safety alert for your neighbourhood | High |

## Rollout order and verification

1. **Native delivery reliability:** verify token ownership on account switch and fresh sign-in; test app foreground, background, swipe-away and screen-locked states. Android force-stop is a separate platform condition. Record notification creation, native outbox row, Expo ticket, Expo receipt and actual device-display timestamp for each test.
2. **Social messaging and sender identity:** ensure native/PWA message copy uses trusted profile names; no private message body; like/comment/follow/grouping and deep links.
3. **Marketplace critical events:** audit existing order/payment/escrow/release/refund notifications, add only missing server-side transitions after verifying payment state and idempotency. Test buyer and seller separately.
4. **Businesses and Events:** audit booking/quote/review and ticket/RSVP/cancellation/payout paths; add event-specific organizer and attendee templates and links, with no speculative ticket or payout success.
5. **Preference and load QA:** remove duplicate pushes, respect opt-outs, confirm no PII in push payload, verify locked-device output and physical Android/iOS/PWA behavior.
6. Only then merge, deploy Edge Functions, and test a controlled cohort before general release.

### Known production observations (17 Nov 2026)

- Push scheduler executes every minute. In a recent 24-hour sample, several messages and comments had Expo delivery records; at least one like had a delivery record.
- Recent like notifications without device pushes primarily targeted accounts without registered native tokens. A follow recipient had multiple old registrations but none was the current authoritative owner of that Expo token, so cross-account push was correctly suppressed.
- A successful Expo receipt is not proof a notification was displayed. QA photos show messages/comments/test pushes, but not guaranteed closed-app delivery across all device states.
- In-app likes already use grouping by distinct actor, with push suppression while the group remains unread.
- **Do not** re-enable daily prompt push campaigns during this work: that is a separate on-hold rollout.

### Change set in the associated draft PR

- Pass trusted server-resolved sender names and conversation IDs for message pushes.
- Use sender-specific message bodies and meaningful account-state titles while keeping financial and private message details off lock screens.
- Add source-level regression tests. Server Edge Function **must be deployed and tested separately**; committing the file alone does not change production.
