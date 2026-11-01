# Business edit media-step crash — 1 November 2026

User confirmed the web crash happened on Proceed/Continue to Media.

## Reproduced cause

The edit dialog reset its new-upload `image` field to existing URL strings. Advancing to Media rendered each string through `BlobImage`, which calls `URL.createObjectURL`. The actual browser reproduced the error boundary: `Failed to execute createObjectURL on URL: Overload resolution failed.` Existing photos already have a separate URL preview and must not enter the local File field.

A second failure was reproduced in address validation: plain-text/invalid historical addresses throw `Cannot read properties of undefined (reading length)` instead of returning field errors. Production read-only aggregates confirmed active businesses use both structured objects and plain-text addresses. No production business data was changed by testing.

## Fix

- Edit defaults leave the new-upload field undefined; saved URL photos continue rendering separately and are preserved on save.
- Normalize saved text/structured locations before resetting the form; invalid addresses produce a validation message.
- Cancel the Continue click default before asynchronous validation so switching the footer to a submit button cannot save the form prematurely.
- Update the existing business discovery test stub for the campaign banner so the broader business suite remains runnable.

## Checks

- Both crashes had failing regressions before the corresponding fixes.
- Web targeted regressions: 3 passed. Broader business suites: 14 passed before the final Continue-click guard was added; targeted regressions passed again after that guard.
- Product typecheck, scoped edit-dialog ESLint and diff whitespace checks passed.
- Authenticated browser with owner-authorized QA actor and an intercepted synthetic business: edit opened, media step displayed, Save Changes succeeded, address and saved images preserved, zero runtime errors. Business GET/PATCH calls were mocked; no real business was edited. Success screenshot: `output/qa/business-edit-media-fixed.png` in the original product worktree.
- Mobile checked against current main: its screen already converts object/text addresses and keeps remote image URLs as remote images, uploading only local device URIs. Its real load/save-closure tests passed 4/4, including remote cover/logo preservation. No mobile runtime code change or replacement native build is needed for this web crash; the extra regression is saved in the mobile working tree.

## Release

Web hotfix is prepared on `fix/business-edit-address-crash` from product main `399195cc`. No schema migration, provider setting or payment behavior is changed. The campaign and previous payment work in the original worktrees remain preserved.
