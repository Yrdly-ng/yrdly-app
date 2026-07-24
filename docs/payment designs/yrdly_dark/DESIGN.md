# Design System Strategy: High-End Editorial Dark Mode

## 1. Overview & Creative North Star
**Creative North Star: "The Nocturnal Curator"**
This design system is a transition from generic "interface" to curated "experience." Moving away from the rigid, grid-locked patterns of standard social platforms, it embraces a high-end editorial aesthetic tailored for a modern Nigerian context. It combines the expressive, rhythmic nature of traditional community storytelling with the slick, high-contrast finish of luxury digital goods.

The layout breaks the "template" look by utilizing intentional asymmetry, varying card radii to denote content importance, and a deep, atmospheric color palette. We are building a space that feels like a private lounge—intimate, premium, and focused.

---

## 2. Colors & Surface Philosophy
The palette is rooted in deep obsidian tones, punctuated by high-vibrancy "Logo Green" and "Link Blue" to guide the eye through the dark.

### Surface Hierarchy & Nesting
We define depth through **Tonal Layering** rather than structural lines.
- **Surface (Base):** `#101418` – Used for the main canvas.
- **Surface-Container-Low:** `#15181D` – For large sectioning and grouping.
- **Surface-Container:** `#1E2126` – Standard card background.
- **Surface-Container-High:** `#1B2B3A` – Primarily for interactive input zones.

**The "No-Line" Rule:** 
Do not use 1px solid borders to separate sections. Boundaries are created through background shifts. A `Surface-Container` card should sit on a `Surface-Container-Low` section to create distinction.

**The "Glass & Gradient" Rule:** 
For floating elements or primary CTAs, use Glassmorphism. Apply a semi-transparent `Surface-Bright` with a `backdrop-blur` of 12px. To add "visual soul," apply a subtle linear gradient to Primary buttons: `Primary` (#82DB7E) to `Primary-Container` (#4DA24E) at a 135-degree angle.

---

## 3. Typography
Our typography is a dialogue between the expressive and the functional.

- **Display & Headlines (Pacifico):** Used sparingly for "Hero" moments and section titles. It adds a human, cursive touch that softens the digital environment.
- **Logo (Jersey 25):** Reserved strictly for brand identity and high-impact metadata.
- **Body & Titles (Raleway/Work Sans):** Our workhorse. `Raleway` provides a geometric, modern Nigerian vibe that feels sophisticated at any scale.

**Hierarchy Strategy:**
- **Headline-LG (2rem):** Used for "Profile" or "Community" headers to establish an editorial "magazine" feel.
- **Title-MD (1.125rem):** For card titles and navigation items.
- **Label-SM (0.6875rem):** For metadata, ensuring the UI remains breathable.

---

## 4. Elevation & Depth
In this system, elevation is an atmospheric property, not a physical one.

- **The Layering Principle:** Depth is achieved by "stacking" container tiers. Place `Surface-Container-Lowest` elements inside `Surface-Container-Low` to create a "recessed" look for feeds.
- **Ambient Shadows:** Standard drop shadows are forbidden. If an element must float (e.g., a bottom-sheet or FAB), use a highly diffused shadow: `box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4)`. The shadow must feel like a glow-in-reverse.
- **The "Ghost Border" Fallback:** For input fields and specific tags, use a 0.5px border. Use the `Outline-Variant` token (#40493D) at 20% opacity. It should be felt, not seen.
- **Glassmorphism:** Use for the top navigation bar and floating menus to allow background content to bleed through, maintaining a sense of place.

---

## 5. Components

### Buttons & Inputs
- **Primary Action:** Pill-shaped (`9999px`). Gradient fill (`Primary` to `Primary-Container`). No border.
- **Secondary Action:** Pill-shaped. `Surface-Container-High` background with a `Ghost Border` of `Primary`.
- **Inputs:** Pill-shaped for search, 11px radius for forms. Background: `#1B2B3A`. Border: 0.5px solid `Primary Green`.

### Cards
- **Standard Cards:** `11px` radius. No shadows. Elevation via color shift (`#1E2126`).
- **Hero Cards:** `28px` radius. Used for profile headers or featured events to create a distinct visual anchor.
- **Nesting:** Never use divider lines. Use `Spacing-8` (2rem) of vertical white space to separate card-based content.

### Specialty Tags (Events & Marketplace)
- **Marketplace:** High-contrast `Secondary` (#A5C8FF) backgrounds with `On-Secondary` text. 
- **Events:** `Tertiary` (#6EDF51) accents to denote "live" or "upcoming" status.

---

## 6. Do’s and Don'ts

### Do:
- **Use Intentional Asymmetry:** Align text to the left but allow images to bleed to the edges of cards.
- **Embrace the Void:** Use the `Spacing-12` and `Spacing-16` tokens generously. High-end design requires "breathing room."
- **Layer Surfaces:** Always ask "can I define this area with a color shift instead of a line?"

### Don't:
- **No 100% Opaque Borders:** Never use a solid, bright white or green border unless it’s for a focused input state.
- **No Sharp Corners:** Avoid `0px` or `4px` radii. Everything should feel organic and approachable.
- **Don't Over-use Pacifico:** Cursive is for personality, not for reading. Never use it for body text or long descriptions.
- **Avoid Flat Black:** Never use `#000000`. Use the `Surface` tokens to maintain the "inky" depth of a true dark mode.