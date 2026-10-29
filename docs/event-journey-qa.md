# Event journey fixes — local QA

Status: owner approved the coordinated release and new GitHub Actions IPA/APK builds. The targeted cancellation-delivery migration was applied and recorded on the linked YRDLY backend after a rollback-only preflight.

## Consumer journey

- Ticket state now accounts for refunds, cancellation, admission and actual expiry/event end. Sandbox is an additional badge, not a replacement for the ticket state.
- Invalid tickets do not expose an entry QR. The web generates valid QR images locally with the existing library instead of sending ticket tokens to an external image service.
- Refresh updates an open ticket. Ticket details link to the event for organiser contact and refund help.
- Web event details now expose the organiser profile and an event-scoped conversation. Contact only opens a conversation; it never sends a message automatically. Errors remain visible.
- Ticket confirmation emails embed their QR PNG as a Content-ID attachment, rather than a base64 image URL that email clients may hide. A readable ticket code and My Tickets link provide fallbacks. Previously sent emails are not changed. Local payload tests pass; real inbox rendering awaits approved deployment and a fresh test purchase.
- Event chats have their own web Messages filter, and their context links open the event instead of a marketplace listing.
- Ticket purchase actions respect event publication, cancellation, event end, archived state, tier visibility, sales deadlines and capacity. Submit checks eligibility again, and quantity controls respect the remaining capacity.
- Existing ticket ownership no longer disables every web ticket tier. View my tickets and Get more are separate actions; the server continues enforcing the per-tier purchase limit.

## Organiser journey

- Web and mobile workspaces distinguish upcoming, draft, past, cancelled and archived events. Archived mobile events are fetched and remain accessible to their organiser.
- Hosting and assigned-event links are available in both mobile directory entry points.
- Mobile management includes the existing authenticated cancellation action. Web cancellation uses the authenticated helper, preserves server rejection messages and explains confirmed-refund/checked-in-ticket prerequisites.
- Cancellation no longer asks for a reason that the backend does not store. Archive no longer changes an event to cancelled.
- Network failures show retry guidance rather than an ownership-denial screen. Terminal events do not advertise scanning, and refund-pending guests are not presented as ready for admission.

## Validation and limits

Focused behavioral tests cover the real screen callbacks and rendered ticket states with isolated I/O. The broader run passed 35 web and 43 mobile tests. Follow-up tests passed the new QR-generation and account-switch regressions, alongside another run of the affected checkout and workspace flows. TypeScript and targeted lint checks run in each application; existing hook warnings are tracked separately from errors.

These checks do not confirm real device camera behavior, real inbox/device delivery or live settlement. Testers must still verify these on the approved release.

The cancellation-delivery migration is applied. Server and native changes are prepared for the approved release. Paystack remains sandbox-only; live Manual Payouts approval, settlement reconciliation and operating-policy requirements still apply. Refund requests currently begin by contacting the organiser; this change does not add a new financial refund-request backend or bypass refund checks.

Ownership is read from the shared backend for the signed-in buyer and grouped by ticket tier. Web ticket wallets and event details refresh on browser focus/visibility and every 30 seconds while visible. Mobile ticket wallets and event ownership refresh on screen focus, return to the foreground and every 30 seconds while the screen is active. Request epochs prevent late responses from a prior account overwriting the current account. These are refresh-based updates, not an instantaneous cross-device delivery guarantee.
