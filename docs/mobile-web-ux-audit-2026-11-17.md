# Mobile web UX audit — 17 November 2026

Status: **in progress; release blocked**. Continue branch `feature/mobile-web-ux-refresh-nov2026` and draft PR #97. No merge or production deployment.

## Browser evidence and limits

The Work cloud browser reached both production and the isolated QA site. Both redirected to login. A real QA login screenshot was captured and inspected at the browser's current 1363px viewport. The secure QA sign-in request was declined; no credentials were entered. Authenticated screens, installed PWA behavior and the requested viewport matrix have **not** been visually approved.

Screenshot: [QA login before changes](https://chatgpt.com/library?file_id=libfile_645e4ab50a7481919843210e31dcb298&account_id=personal). This shows the deployed QA revision, not this branch's new changes.

| Surface | Live visual review this session | Prepared browser coverage |
| --- | --- | --- |
| Login | Desktop screenshot and accessibility tree inspected | Auth entry used by isolated QA tests |
| Home, Explore, Marketplace, Businessplace, Events | Blocked by QA sign-in | All eight widths, light and dark |
| Messages, Profile, Settings | Blocked by QA sign-in | All eight widths, light and dark |
| Create menu | Blocked by QA sign-in | Four actions, geometry, Escape and focus return, both themes |
| Post, listing and event creation | Blocked by QA sign-in | Open existing routes or capture the existing phone gate; no publishing |
| Installed iPhone PWA | Not inspected | Physical-device checks still required |

Widths prepared: **320, 360, 375, 390, 430, 768, 1024, 1440**. Test discovery is not browser execution. Phone-gate screenshots are explicitly named as such and do not count as review of a creation form; a verified QA buyer is needed for that release gate.

## Findings and changes

| Finding | Evidence | Change in this branch |
| --- | --- | --- |
| Password toggle has no accessible name and only a 16px icon hit area | Live login accessibility tree, screenshot and source | Named Show/Hide password control, pressed state, 44px hit area and keyboard focus ring |
| Login fields rely on placeholders and lack autofill metadata | Live tree and source | Explicit accessible names, names and autocomplete attributes |
| Login inputs use 14px text; small mobile input text risks Safari focus zoom | Source; mobile behavior still needs device verification | 16px on phones, existing desktop sizing retained |
| Sign-up and password recovery controls are small | Live screenshot and source | 44px minimum height and larger readable text |
| Business detail announces independent business verification | Source: `BusinessDetailScreen.tsx` | Remove generic verification claim; show Phone verified only for an explicit true phone flag, matching directory semantics |
| Listing/event title and description labels lack input associations | Source | Associate labels and fields; improve label readability |
| Event/listing category chips have small touch areas and no selected state for assistive technology | Source | 44px minimum height, keyboard focus rings and `aria-pressed` |
| Post content lacks a persistent accessible name | Source | Add Post content accessible name |
| Create close control can shrink beside a long heading | Source | Preserve 44px width with `shrink-0`; add stable action selectors for browser tests |
| Existing screenshot suite omits 360/1024 for page captures and has no theme matrix | Source | All eight widths in both themes, route assertions and failure screenshots |

The new visual changes still need rendered screenshot review. These code findings are not claims about uninspected authenticated screens.

## Native reference

Source comparison only: native `src/components/ScreenHeader.tsx` uses 16px horizontal spacing, a 17px bold Outfit title, safe-area-aware top spacing, and map/notification actions. Native `VerifiedBadge.tsx` has distinct visual badge shapes, but its generic verification semantics must not override the web requirement to say Phone verified. No native runtime screenshots were inspected, so cross-platform visual parity remains pending.

## Why visual CI fails before browsers

Confirmed on GitHub's job annotations for run `44086932514`, attempt 2, job `134069062063`:

> Branch "refs/pull/97/merge" is not allowed to deploy to yrdly-qa due to environment protection rules.

GitHub records zero executed steps and no runner assignment. This is an environment protection rejection, not a Playwright installation or test failure. The retry had the same result. Environment protections and secret scope were preserved.

An administrator must provide an allowed execution path for the PR's isolated QA job, or make a deliberate environment-policy change. Do not use `pull_request_target`, remove the environment to expose secrets, or use production credentials as a workaround.

The workflow now also runs TypeScript, lint, parity, payment/business regressions and browser-test discovery in a separate job without QA secrets. This does not resolve or replace the authenticated visual release gate.

## Validation

- TypeScript: passed locally.
- Lint: passed with existing repository warnings.
- Feature parity: 46 passed.
- Payment regressions: 108 passed; mocked/local tests, no live payments.
- Business regressions: 37 passed after updating two stale harnesses to load the existing staged-booking module and render the real milestone component against a disabled local fixture. No production booking/payment logic changed.
- Playwright: six matrix tests discovered successfully. Authenticated execution and generated matrix screenshots remain blocked.
- `git diff --check`: passed.

## Remaining release gates

- Authenticate the Work browser with a dedicated QA account and inspect every requested screen at all eight widths.
- Resolve the isolated QA environment execution restriction and inspect actual screenshots from the branch.
- Inspect later wizard steps, dialogs, keyboard navigation, text scaling, light/dark contrast, loading/error/empty states, and long content.
- Compare rendered screens with the native app and continue the wider Home/Explore/Messages/Profile/Settings redesign from that evidence.
- Test physical iPhone Safari and installed PWA viewport/safe-area/keyboard behavior.
- Keep PR #97 in draft until these gates pass. Daily prompts, PWA push testing and native Liquid Glass remain on hold.
