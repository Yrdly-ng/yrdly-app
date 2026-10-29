# Event cancellation notifications

Status: owner approved release; the targeted migration was applied and recorded on the linked YRDLY backend after a rollback-only preflight. Server release is being prepared. No new mobile build is needed for this server change.

## Behavior

The organiser cancellation endpoint calls `cancel_event_with_notifications`. Cancellation, free-ticket invalidation, attendee in-app notices and channel delivery jobs commit in one database transaction. Each buyer receives one `event_cancelled` notice. Email jobs use the distinct normalized ticket-attendee addresses, with account-email fallback when no attendee email exists. Addresses shared by multiple buyers receive one cancellation email per event.

Paid tickets must be refunded before cancellation; checked-in tickets require support review. This flow never initiates refunds or claims that a customer has received money. An insert guard prevents an active ticket from being issued after cancellation wins a concurrent purchase race.

Repeated cancellation calls do not duplicate notices or delivery jobs. Explicitly repeating cancellation on an older cancelled event can fill in missing notices; the migration does not automatically contact historical attendees.

## Delivery and recovery

The request schedules delivery after the cancellation commits. Push and email each have their own durable job and checkpoint, so one channel failing does not resend the other. Workers use leases and token-bound checkpoints. Native push uses the existing provider delivery key; no registered device or a notification opt-out is a terminal skip, not proof of phone receipt.

Email uses a stable Resend idempotency key per job and immutable recipient/event snapshots. If a send may have succeeded without its checkpoint, retries use that same key. Resend retains keys for 24 hours; uncertain email attempts older than 23 hours move to `review` rather than risking another send. Delivery repeatedly failing also moves to review after eight attempts. Operators must reconcile these jobs before requeuing them.

The existing authenticated `/api/cron/event-reminders` job also recovers pending cancellation delivery, including days with no upcoming events. The current Hobby schedule runs daily. Each invocation handles at most 100 channel jobs with five concurrent sends, so large queues or retry failures can require additional authenticated invocations. Immediate cancellation delivery does not depend on cron. Review jobs are not automatically resent.

## Rollout

Local validation: 37 focused regression tests passed across cancellation routes, database behavior, delivery, email and cron recovery. Database tests use PGlite with the relevant existing ticket triggers. TypeScript and focused ESLint checks passed. Hosted migration application and real-device/inbox verification remain pending approval.

1. Obtain owner approval before applying or deploying.
2. Apply only `20261029105549_event_cancellation_notifications.sql` through the reviewed targeted migration procedure; do not run a blanket database push against the divergent historical migration ledger.
3. Deploy the server changes after the migration. `RESEND_API_KEY`, push-function configuration and `CRON_SECRET` use existing configuration.
4. Cancel an isolated test event and verify one notice per buyer, one email per distinct address, repeated-request behavior and pending-job recovery. Real inbox and phone receipt need tester confirmation.

The private delivery table has RLS enabled and no browser grants. Cancellation RPC execution is restricted to the server service role. No secrets or attendee addresses belong in logs.
