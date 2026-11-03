# Reports and safety: web/mobile parity — 2026-11-03

User approved implementation of clearer report detail and full mobile admin controls after the code-informed review. Scope: product web/backend and Expo mobile. Preserve existing financial flows, launch animation and repository changes.

Plan: shared server-authorized case API for general/post/comment reports; human identities/content context, category/status filters, resolve/dismiss/reopen and hide/restore controls with recorded reasons/history. Mobile staff receive the same report workflow as web. Sensitive child-safety attachments never auto-render. Existing automated review and account enforcement reused. Clarify general reports versus order disputes and remove unsupported review-time promises. Verify authorization, invalid/conflicting transitions, audit history, UI states, typechecks and relevant lint/tests. Additive migrations must be reviewed/tested before release; no production application in this task without explicit authorization.

Implementation owners: moderation_backend_fix (product/backend, web, migration/tests); moderation_mobile_fix (native UI/services/tests). Root reviews integration and documents results. No production data or payment mutation is authorized by UI validation.

## Backend and web completion (specialist)

- Shared admin list/detail/action API implemented for general/post/comment reports, with staff identity checks, safe field projection, names/content, saved state and merged legacy/new history. Child-safety media references omitted; other attachments require deliberate viewing.
- Web Reports & Safety replaces raw-ID action cards; staff inspect details then record reasons and confirm actions. Existing automated content reviews remain available with deliberate image inspection. General report copy directs payment issues to transactions; removed unsupported 24–48-hour dispute review promises.
- `20261103154337_audited_report_review.sql` adds atomic case actions/audit, restricted RPC execution, comment hiding with restrictive visibility policies and owner-write protection. Report rows are retained. Migration NOT applied anywhere.
- Checks: 4 PGlite cases and 6 real-handler/helper API cases pass. TypeScript and scoped ESLint pass. `test:reports` added to existing QA workflow. Manager performs cross-app UI integration checks.
- Rollout must apply migration in QA and verify against actual schema/RLS before production release. No external moderation actions, payment operations or deployments were performed.

## Integration review

Root independently reran all 10 backend API/SQL checks successfully. Actual web moderation component exercised in Chrome with fixture API at 390px and 1440px: open case, human details, submit one reasoned decision, reload authoritative history; no browser exceptions. This lightweight fixture did not load the full Next/Tailwind runtime, so production styling/authenticated QA checks remain necessary. Actual native component rendered through React Native Web at 390px/1024px without browser errors or overflow. Mobile full release suite passed 332 checks before final attachment refinement; final focused moderation/store-safety suite covers the resulting component. Both specialist final TypeScript and scoped lint checks passed (mobile warnings noted in its handoff).

Not yet live. Next rollout step: authorize/apply `20261103154337_audited_report_review.sql` to QA Staging, deploy matching QA API, then authenticated staff/nonstaff smoke tests against the actual schema and private media policies. Production migration application needs explicit authorization. Deploy backend before publishing new mobile builds. Existing animation build requests do not contain these uncommitted moderation changes. No production report, account or payment has been modified.
