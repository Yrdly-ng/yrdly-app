# Event journey fixes — local QA

Status: local changes only. The owner requires approval before any push, deployment, hosted migration or native build.

## Consumer journey

- Ticket state now accounts for refunds, cancellation, admission and actual expiry/event end. Sandbox is an additional badge, not a replacement for the ticket state.
- Invalid tickets do not expose an entry QR. The web generates valid QR images locally with the existing library instead of sending ticket tokens to an external image service.
- Refresh updates an open ticket. Ticket details link to the event for organiser contact and refund help.
- Web event details now expose the organiser profile and an event-scoped conversation. Contact only opens a conversation; it never sends a message automatically. Errors remain visible.
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

The earlier cancellation-delivery migration remains unapplied. Server and native changes are not deployed. Paystack remains sandbox-only; live Manual Payouts approval, settlement reconciliation and operating-policy requirements still apply. Refund requests currently begin by contacting the organiser; this change does not add a new financial refund-request backend or bypass refund checks.
