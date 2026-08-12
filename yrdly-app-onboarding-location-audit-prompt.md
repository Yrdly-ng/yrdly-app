GROUND RULES BEFORE YOU START:

- This is a READ-ONLY audit. Do not run any Supabase MCP calls (no migrations, no writes, no `migration repair`). Do not run `schedule` or `manage_task` tools. Grep and read files only.
- If you run `tsc`, a build, or any command, paste the raw terminal output verbatim. Do not report "Pass"/"compiles cleanly" without showing that output.
- For every finding (✅/⚠️/❌/🔴), cite the exact file path and line number, and paste the actual code snippet you're citing. Do not write "confirmed working," "looks correct," or "appears consistent" without the snippet proving it.
- If you did not actually open and read a file, mark that finding UNVERIFIED instead of guessing or inferring from a similar codebase.
- Every file path, line number, and snippet must come from an actual read/grep performed in this session — not reconstructed from memory or pattern-matched from what a codebase like this "usually" looks like.
- Do not silently fill gaps with inference to make the report look complete. If you run out of depth on a section, say so explicitly.
- Do not make any code changes. Audit only.
- You already have a completed audit of the mobile app's (`yrdly-mobile`) onboarding and location/filtering architecture from a prior session. Use it as the reference standard for comparison — flag anywhere `yrdly-app` diverges, is missing equivalent functionality, or handles something differently.

---

Audit `yrdly-app` (the Next.js web app at app.yrdly.ng) covering two areas:

## 1. Onboarding flow
Trace the full onboarding flow end-to-end: signup → profile setup → location selection → email/phone verification → landing in the app. For each step, confirm:
* What data is collected and where it's saved (table/columns).
* Whether the flow can be broken out of, skipped, or left in an inconsistent state (e.g. partial profile, no location set).
* Whether it matches the mobile onboarding flow in intent and data shape, or diverges.

## 2. Location, filtering, and map — parity check against yrdly-mobile
Run the same audit categories as the mobile audit, this time for `yrdly-app`:
* Home location capture and storage (`home_state`, `home_lga`, `home_ward`, `home_lat`, `home_lng`, `home_location_geom`).
* Active location filter — how it's stored, and confirmation it never overwrites the home location.
* Post, marketplace, and event location assignment and storage (state/lga/ward/lat/lng/location_geom, PostGIS POINT(lng lat) convention).
* Business location handling (noting the businesses directory is a stub per the existing audit — confirm whether any location scaffolding exists ahead of the backend).
* Location-based filtering across Home Feed, Marketplace, Events, Community, and Map.
* Map: marker sources, whether they use canonical lat/lng/location_geom, whether the map respects the active filter, any legacy location structures still in use.

For each area, explicitly state whether `yrdly-app` matches, is missing, or diverges from what was found in `yrdly-mobile`. Call out anything that would need to be bridged for the two clients to behave consistently against the shared Supabase backend.

At the end, give a full report using:

* ✅ PASS — working correctly, matches mobile
* ⚠️ MISMATCH — inconsistent between web and mobile, or internally inconsistent
* ❌ FAIL — broken and requires fixing
* 🔴 CRITICAL — could cause major production issues or cross-client data corruption

For every issue include: exact file/component, what's currently happening, what should happen, why it's a problem, and the recommended fix.

End with a FINAL VERDICT section stating whether `yrdly-app`'s onboarding + location architecture is PRODUCTION READY, NEEDS MINOR FIXES, or NOT PRODUCTION READY — and separately, whether web/mobile are in PARITY, PARTIAL PARITY, or DIVERGENT.

Do not make changes yet. This is an audit only.
