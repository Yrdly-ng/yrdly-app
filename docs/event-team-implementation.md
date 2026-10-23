# Event team implementation

Authorized scope: implement the proposed event team flow across web and mobile. No production migration, deployment, push, or app build is authorized by this task.

- Account-bound invitations expire after seven days. Acceptance grants manager or check-in access for one event.
- Organisers control managers; managers can invite/revoke check-in staff only.
- Assigned events exposes invitations and accepted duties separately from owned events.
- Online check-in revalidates access and ticket state atomically. Duplicate scans admit once; revoked access cannot admit.
- Operational totals/history are separated from financial and event settings permissions.
- UI: invitations, role changes, revocation, multiple scanners, attendance, history, and existing manual entry.
- Validation: adversarial authorization/expiration/concurrency tests, UI callbacks, both app type/lint checks. Migration stays local and reviewable.

## Release order

1. Run `pnpm test:event-team` and the existing parity checks in a development environment.
2. Review and apply `20261023180233_event_team_checkin.sql` to the development database, then smoke-test organiser invitation → recipient acceptance → staff scan → revoke → denied scan with separate accounts.
3. After explicit approval, apply the additive migration before deploying the web/API commit. Existing organiser flows remain available during this order.
4. Deploy the web/API, then release the mobile client in a separately authorised build. Older mobile organisers continue using the same check-in endpoint.
5. Verify a newly invited account sees Assigned events and its in-app invitation notification, while payment/settings endpoints still deny staff.

No email delivery is claimed: invitations appear in the recipient's YRDLY notifications and Assigned events. The recipient must already have a verified YRDLY email. A pending invitation expires after seven days; accepted membership lasts until revocation. History is a bounded operational view, while attendance totals cover the event.
