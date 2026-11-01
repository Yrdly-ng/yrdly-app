# Business profile image — 1 November 2026

## Request and implementation

The web business form previously offered only Business Photos, using the first photo as a banner. Added a separate optional Business profile image control in Media & Hours for both create and edit, with a circular preview and square-image guidance. Renamed existing uploads to Banner & gallery photos and explain the first image becomes the banner.

Profile upload uses the existing authenticated storage upload path and writes logo_url and legacy logo independently of image_urls and cover_image. Existing profile images, separate cover_image records, and gallery images are preserved on text-only or profile-only edits. Upload failures block saving rather than reporting false success. No database migration or mobile runtime change is required; mobile already has separate cover/logo controls.

## Verification

- Combined business editing/profile/presentation/parity suites: 21 passed, 0 failed.
- Product typecheck passed; scoped ESLint passed with one existing unrelated use-posts effect dependency warning.
- Authenticated QA browser: open Edit Business, Continue to Media, select profile image, inspect desktop/390px layout, Save Changes. One profile upload, independent logo/banner/gallery payload, preserved address, zero runtime errors. Business reads/writes and storage upload were intercepted with synthetic fixtures; no real business was edited. Existing QA authentication remained real.
- Creation and editing save closures covered by meaningful tests: separate profile/banner upload, logo-only edits, preserved existing logo, no inferred logo from banner, and upload failure before database writes.
- Screenshots retained in the original worktree: output/qa/business-profile-image-desktop.png and business-profile-image-mobile.png.

## Release

Prepared from production main 7ad44c40 on feat/business-profile-image. Publishing directly to main follows the owner's standing release authorization. Paid event gates and finance changes are outside this release.
