# Mobile web UX audit — 17 November 2026

Status: **in progress; keep PR #97 draft**. Continue `feature/mobile-web-ux-refresh-nov2026`. No production merge or deployment.

## Authentication and isolated QA

All five dedicated core QA accounts were reset and their GitHub environment passwords updated by the user. Buyer, seller, organizer, admin and non-admin password sign-ins were verified after the seed job. Credentials are not included in this report or screenshots.

The initial workflow failed before runner allocation because the environment rejected `refs/pull/97/merge`. The environment now allows that exact PR ref; account validation, seeding, builds and authenticated Playwright execution run successfully against the isolated QA tenant. Production credentials/data were not used. Conflicts with current main were resolved while retaining the stronger booking regression fixtures.

The Work cloud browser reached production and isolated QA login pages. Its secure QA login later returned a generic Network error; automatic retries stopped. **CI authentication is working; this does not establish a signed-in Work browser session.** Native runtime and installed PWA behavior remain unverified.

## Screenshot coverage and evidence quality

The suite covers **320, 360, 375, 390, 430, 768, 1024 and 1440px**, in light and dark mode. Twelve surfaces per combination produce 192 screenshots: Home, Explore, Marketplace, Businessplace, Events, Messages, Profile, Settings, Create menu, and the first post/listing/event creation screens.

Initial authenticated run 44093721245 passed six matrix tests, but visual inspection found loading placeholders and a Create exit animation in early captures. Those captures are provisional evidence. Readiness checks now wait for visible accessible headings, YRDLY shimmer skeletons, pulse/spinner placeholders, category loading and fonts. Desktop Settings intentionally hides its mobile heading, so readiness uses accessible headings rather than the first DOM h1. Create-menu captures wait for panel and backdrop opacity to reach their final values; creation captures also wait for the menu exit animation to finish.

Baseline run **44110010185** at commit `be5d1b5264d141792739e18b518a5161efd87703`: **6 passed (5.1m)**; static and visual jobs both succeeded. All 192 PNGs were downloaded and their archive SHA-256 verified. Representative loaded light/dark screenshots were inspected, including the previously incomplete desktop Create, Marketplace and Messages captures. This confirms those evidence-timing defects are fixed; it does not approve the entire redesign.

[Successful CI run and full private artifact](https://github.com/Yrdly-ng/yrdly-app/actions/runs/44110010185). [Screenshot review archive](https://chatgpt.com/library?file_id=libfile_2a0e83af63108191be360dc765755f11&account_id=personal) contains 176 original PNGs; the 16 Settings captures with account contact details remain in the private GitHub artifact.

Only disposable QA fixtures are shown. Tests open creation screens without publishing. The verified QA buyer reached the actual first listing/event form screens; phone-gate captures do not substitute for form review. Later wizard steps and submission are not covered by this visual suite.

## Findings and implementation

| Finding | Evidence | Change/status |
| --- | --- | --- |
| Small login controls, missing password-toggle name and autofill metadata | Deployed login screenshot/accessibility tree and source | Named 44px password toggle, focus state, input names/autocomplete, 16px mobile fields and larger recovery/sign-up controls |
| Create action hierarchy and small navigation targets | Source and rendered mobile screenshots | Four distinctive illustrated action cards, larger navigation targets, compact topbar and clearer Marketplace typography |
| Global topbar and bottom navigation duplicate creation screen controls | Actual 320–1440 creation screenshots | Hide global chrome on post/listing/event creation; retain page back controls and desktop sidebar; safe-area bottom padding |
| Category chips and form labels lack robust accessible semantics | Source and rendered creation forms | Associated title/description labels, 44px category chips, selected states and Post content name |
| Business verification label implies independent business verification | Business detail source | Say Phone verified only for an explicit true phone flag |
| Create close button can shrink beside long title | Source and narrow screenshots | Preserve 44px width and action selectors |
| Businessplace and Events consume most of the first phone viewport with hero/search/filter controls | Loaded 390px screenshots in both themes | Compacted mobile heading/section gaps and removed duplicate inner padding; Events management links scroll in one row; updated screenshot review tracked in PR #97 |
| Small secondary copy and controls remain in feed metadata, Profile shortcuts and Settings descriptions | Representative loaded phone screenshots | Profile actions/tabs now 44px; shortcuts have larger labels and focus rings. Settings rows are keyboard buttons, wrap descriptions at 14px with 16px titles, and have a named 44px theme switch; updated screenshot review tracked in PR #97 |
| Desktop Settings has a hidden mobile heading | 1024px browser failure | Fixed readiness check; not an application navigation failure |
| Shimmer skeletons were not covered by generic animation waits | Actual dark Marketplace/Messages captures and Skeleton source | Wait for `.yrdly-skeleton` before screenshot capture |

No payment, auth, verification or notification dispatch logic was changed by the UX work. Current main was integrated, including its already-existing unrelated fixes.

## Native reference and limits

Source comparison: native ScreenHeader uses 16px horizontal spacing, a 17px bold Outfit title, safe-area-aware spacing and map/notification actions. Focused creation screens and consistent mobile navigation follow that hierarchy. Native badge artwork does not override phone-verification semantics. No native runtime screenshots were reviewed, so visual parity is not approved.

## Latest polish pass

Commit `4686e868231937d193d8fef02deab1e1ce9329eb` implements the discovery/account fixes above. Local TypeScript, lint and browser discovery pass. The authenticated matrix now also exercises the Settings email dialog by keyboard, toggles theme with the keyboard and restores it, and checks Profile action/tab touch heights. The latest authenticated run and screenshot review are linked in PR #97; the baseline evidence above predates this polish pass.

## Validation

- TypeScript and lint pass; lint retains existing repository warnings.
- Feature parity: 46 passed.
- Payment regressions: 108 passed; mocked/local tests, no live payments.
- Business regressions: 37 passed. Two stale harnesses now exercise staged checkout delegation and the actual milestone component with a disabled local fixture; no provider payments.
- Conflict resolution: the seven directly affected booking tests pass.
- Browser tests check authenticated routes, theme, page overflow, Create geometry, Escape/focus return, existing creation destinations, and hidden mobile app navigation on focused creation screens.
- `git diff --check` passes.

## Daily prompt tap regression

The user confirmed daily-question push receipt but tapping opened Notifications. The `/daily-prompts` URL was missing from the web safe-destination list. The service worker and authenticated URL-only preflight therefore fell back to `/notifications`, including a typed daily reminder after its type was reduced to a legacy target URL. Add the existing question route to the allowlist; retain same-origin checks, recipient checks and source authorization. A regression reproduced the failure before the fix and now passes for typed reminders, self-tests and legacy URL payloads. The browser release test also exercises the exact `notificationTarget=/daily-prompts` preflight.

Release QA at `14ffc846`: 8 Playwright tests passed (4.8m), including later wizard review and mocked daily-question presentation, plus all static checks. The new routing patch needs its updated CI run and a fresh physical PWA tap before release approval.

## Wizard screenshot findings

Later-step screenshots exposed a 320px toast clipped by the global reduced-motion `transform:none` rule. Remove that rule while keeping animation/transition duration reduction; preserve structural centering transforms. Toast dismiss controls now have an accessible name and 44px target. Mobile listing/event review steps also need actual entered details: add summaries before publication controls, without changing submission behavior. Browser checks assert toast geometry under reduced motion and mobile summary contents.

## Resumed release checks

- User confirmed an actual iPhone PWA background push and successful Home tap.
- Two Android self-test provider receipts were `ok`; phone-display/tap confirmation remains pending. A third tester was sent one labelled, device-scoped test.
- Found and reproduced a worker defect: short delivery TTL expired awaiting-receipt rows before the 15-minute provider check. The fix separates send expiry from a bounded 24-hour receipt window; expired notifications cannot be resent. Four new behavioral regressions pass locally.
- Daily question/reminder and notification suite: 132 baseline checks passed. Live scheduler active; campaign disabled, tester cohort empty, seven approved questions and two opted-in users. No broadcast enabled.
- Added later listing/event review and daily-answer composer browser coverage. Daily endpoint responses in these presentation tests are explicit mocks; this is not database response persistence proof.
- Separate isolated QA deployment requested using its existing QA environment. Main-project branch preview lacks server configuration; production credentials were not copied to previews.

## Remaining release gates

- Inspect the updated discovery/account screenshots at every requested breakpoint and complete remaining text-scaling/contrast review.
- Inspect later listing/event wizard steps, dialogs, populated conversations, validation errors, keyboard focus, text scaling, contrast and long content.
- Resolve the Work browser QA sign-in network error before claiming interactive authenticated cloud-browser review.
- Compare rendered native screens and test physical iPhone Safari and installed PWA safe areas, viewport and keyboard behavior.
- Keep PR #97 draft until redesign and QA are complete. Daily prompts and PWA/native push testing resumed on 17 November under the user’s release instruction. Native Liquid Glass remains postponed.
