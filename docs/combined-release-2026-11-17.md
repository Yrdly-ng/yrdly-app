# Combined web/native implementation checkpoint — 17 November 2026

Scope: approved discovery UI, mobile-first web/PWA polish, daily questions and existing social/commerce/business/event notifications. Finish and consolidate source changes before the user’s combined device-testing round. No further APK builds during implementation. Keep draft PRs unmerged and campaigns disabled until QA/release gates pass. Native iOS Liquid Glass remains postponed.

## Implementation included

- Native discovery design is merged in Yrdly-ng/yrdly-mobile #23; web discovery design is merged in Yrdly-ng/yrdly-app #96. Do not reimplement their approved category chips, listing cards/shoppable images, business rows or chronological event presentation. Real data and explicit Phone verified semantics remain authoritative.
- Web #97 contains the remaining responsive navigation, Create actions, typography, focused creation forms, summaries, Profile/Settings, themes, toast layout and populated conversation work. It uses the same eight requested widths; text scaling and accessible controls are included.
- Web #97 + native #24 quote each tagged answer’s original daily question in feed and post detail, preserve historical question navigation and show moderated local neighbour responses. Existing tagged posts gain context without data rewriting. Ordinary posts are unchanged.
- Daily notifications now carry the question ID end to end, including both dispatcher implementations, native URL translation and PWA authenticated URL preflight. Legacy current-question links remain supported.
- The native receipt-worker patch separates send expiration from receipt collection and never resends an expired notification. Existing sender identity, grouping, preferences, token ownership and authoritative transaction-state rules remain intact.
- Native preflight matches the Firebase SDK’s installation-token request and bounded server-error retry, while retaining fail-closed behavior, safe diagnostics and synthetic installation cleanup. No credential or API restriction was changed.

## Reviewable changes

Web: https://github.com/Yrdly-ng/yrdly-app/pull/97
Native: https://github.com/Yrdly-ng/yrdly-mobile/pull/24

Both remain draft. The native question UI depends on the web question-by-ID endpoint. Edge Function source is committed separately from deployment; dispatch/receipt-worker changes are not live merely because the web branch is deployed.

## Evidence already obtained

- Web visual checkpoint b7f67d8b: all 12 authenticated browser cases passed, with 292 screenshots in light/dark mode across the eight widths and extended form/question/conversation views. Real isolated QA answer persistence, retry dedupe, server-owned location, moderation/locality and auth checks passed. Static checks also passed.
- Native checkpoint d2eeedfb: TypeScript, lint (existing warnings), 475 regression checks and Android/iOS JavaScript compilation passed. These are source/bundle checks, not installed UI approval.
- Physical iPhone PWA and Android push receipt were confirmed by the user. Daily-question tapping previously opened Notifications; the corrected candidate still requires device verification.
- APK #78 produced no artifact: Firebase installation-token preflight stopped it before compilation. A subsequent synthetic check with the same client configuration succeeded locally. The exact transient provider failure is unknown; the source now provides bounded retry and safe HTTP diagnostics.

## Combined testing/release gate — later phase

After all source checks complete, use one candidate for the consolidated Android UI/notification/daily-question round. Include web/iPhone PWA safe areas and keyboard behavior, Android foreground/background/locked-state delivery and tap destinations, older-question links, category/filter and listing image variations, social sender/grouping rules, and sandbox-only buyer/seller/business/event flows. Signed native iOS and store-privacy review remain separate store-release gates.

Do not enable general daily broadcasts, change live payment state, test on customer content, submit to stores or automatically merge/deploy unfinished work. No new APK build is authorized by this checkpoint alone; respect the user’s instruction to finish consolidation first.
