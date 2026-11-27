# YRDLY Modern Web Standards

This document adopts Google Chrome's **Modern Web Guidance** for the YRDLY web application. Treat it as an engineering standard, not a mandate to use every new browser API.

## Project context and compatibility

- Product: YRDLY social/community marketplace web app.
- Framework: Next.js App Router (React); confirm the current route and rendering strategy before changing it.
- Target browser support: **Baseline Widely Available**, unless a feature has an explicit product requirement and progressive enhancement/fallback strategy.
- Keep the existing architecture, UI system, analytics, auth, and data-access patterns unless an audit demonstrates a change is necessary.
- Avoid adding dependencies or client-side JavaScript for behavior the browser can provide natively and accessibly.

## Required workflow for agents

For a substantial UI, performance, accessibility, HTML/CSS, navigation, or browser-feature change:

1. Consult the current Google Chrome Modern Web Guidance using its CLI/skill (search relevant use cases, then retrieve the exact guide): `npx modern-web-guidance@latest search "<use case>"` and `npx modern-web-guidance@latest retrieve "<guide-id>"`. If unavailable, use the official guide library: https://developer.chrome.com/docs/modern-web-guidance/guides.
2. Read project code and tests around the target. Understand current behavior and route-level architecture before editing.
3. Select the smallest applicable modern pattern. Check Baseline/browser compatibility; use progressive enhancement or fallback for features not widely available. Do not enable volatile or origin-trial guidance by default.
4. Implement without regressions: preserve existing product behavior, security/privacy controls, analytics instrumentation, keyboard support, and responsive layouts.
5. Validate the actual affected route/component: run relevant tests, lint/typecheck/build as appropriate; test keyboard and reduced-motion behavior; inspect mobile and desktop layouts.
6. For performance changes, capture a before/after measurement or trace when possible. Report the metric, test conditions, and limits—never claim improvement without evidence.

## Standards

### Performance and responsiveness
- Protect Core Web Vitals: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1 at the 75th percentile of real visits.
- Prioritize the main content and LCP asset; avoid competing fetches, lazy-load offscreen media, and size/format images for actual display dimensions.
- Break up long main-thread tasks; defer noncritical work; avoid expensive synchronous layout and rerendering.
- For large feeds, lists, chat histories, and dashboards, evaluate pagination/virtualization and offscreen rendering. Use `content-visibility` only where its trade-offs and intrinsic-size placeholder are understood; never apply it indiscriminately to above-the-fold or small content.
- Avoid duplicate API requests, unnecessary refetching, and blocking navigation on unrelated data. Use existing cache conventions; don't introduce a second cache layer without an ADR.
- Prioritize user-triggered work over background/analytics work. Batch/debounce telemetry where safe, preserve critical events.
- Avoid global `will-change`, layout thrashing, and costly animations. Prefer transform/opacity and honor reduced motion.

### HTML, accessibility, and interaction
- Prefer semantic HTML and native interactive elements (buttons, links, forms, dialog, popover, details) where appropriate; don't recreate browser behavior with custom JS unnecessarily.
- Maintain logical DOM/focus order; use correct landmarks and heading structure; accessible names for icon-only controls.
- Dialogs/drawers/popovers must handle focus, dismissal, Escape where expected, background inertness, and focus restoration.
- Forms must have labels, clear validation, programmatically associated errors, and usable keyboard/screen-reader feedback.
- Respect zoom/text scaling, contrast/forced-colors, reduced motion, and touch-sized controls. Don't rely on color alone.
- Test assistive technology/keyboard workflows; avoid ARIA when native semantics suffice.

### Responsive design and visual stability
- Design mobile-first; verify narrow widths, tablet, desktop, zoom, and dynamic viewport/system UI.
- Avoid overflow and unexpected layout shifts; reserve image/media dimensions and use stable font fallbacks.
- Use fluid type, container queries, and modern CSS only where they simplify the design and are compatible with the project's target.
- Keep visual hierarchy, interaction affordances, and design-system consistency.

### Security, privacy, and reliability
- Use safe DOM/content APIs; sanitize untrusted rich text with the project's vetted sanitizer. Never inject raw HTML without a verified safe path.
- Keep CSP and other security headers deliberate; review any relaxation. Use secure, privacy-preserving third-party resource policies.
- Don't cache private/authenticated content in shared caches or service workers. Make caching policy explicit for personal, mutable, and public data.
- Feature-detect browser APIs and provide graceful failure/fallback. Avoid exposing sensitive data through analytics, logs, errors, or page metadata.

### Search and public content
- Keep public, intended-to-be-indexed pages crawlable and render meaningful content/metadata.
- Use descriptive titles, canonical URLs, correct robots directives, sitemap/internal links, and valid structured data where appropriate.
- Never expose private routes, user data, chat, account settings, or gated content for indexing. Treat app SEO separately from the marketing/public site.

## Review checklist

- [ ] Relevant Modern Web Guidance use case consulted (or reason recorded).
- [ ] Correctness and existing behavior preserved.
- [ ] Browser support / Baseline checked; fallback for limited support.
- [ ] Keyboard, focus, semantics, and reduced-motion reviewed.
- [ ] Mobile and desktop reviewed; no overflow or layout shift introduced.
- [ ] Performance impact measured when applicable; no unsupported performance claims.
- [ ] Relevant automated tests, lint, typecheck, and build passed (or limitations stated).
- [ ] Privacy/security/cache/SEO implications reviewed for the change.

## Official references

- Modern Web Guidance: https://developer.chrome.com/docs/modern-web-guidance/get-started
- Guide library: https://developer.chrome.com/docs/modern-web-guidance/guides
- Performance guidance: https://developer.chrome.com/docs/modern-web-guidance/guides/performance/performance
- Accessibility guidance: https://developer.chrome.com/docs/modern-web-guidance/guides/accessibility/accessibility
- Baseline: https://web.dev/baseline/
- Core Web Vitals: https://web.dev/articles/vitals
