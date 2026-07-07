---
version: alpha
name: Basepair
description: Two-layer system. The console (the clinical app) is Vercel Geist Light with two deviations, success mapped to green and navy as the interface accent. Marketing surfaces share the navy under an editorial shell with a serif display face that never enters the console.
colors:
  # ---- Marketing shell (non-clinical chrome) ----
  navy: "#173c63"
  navy-press: "#0f2c4b"
  ink: "#000000"
  body: "#4c4c4c"
  muted: "#8a8a8a"
  hairline: "#e8e8e8"
  field: "#f6f8fa"
  surface: "#ffffff"
  # ---- Console neutrals (Geist) ----
  background-100: "#ffffff"
  background-200: "#fafafa"
  gray-100: "#f2f2f2"
  gray-200: "#ebebeb"
  gray-700: "#8f8f8f"
  gray-900: "#4d4d4d"
  gray-1000: "#171717"
  gray-alpha-400: "#00000014"
  # ---- Clinical scales (Geist accents, steps chips and controls use) ----
  red-100: "#ffeeef"
  red-200: "#ffe8ea"
  red-400: "#ffd7d6"
  red-700: "#fc0035"
  red-800: "#ea001d"
  red-1000: "#47000c"
  amber-100: "#fff6de"
  amber-200: "#fff4cf"
  amber-400: "#ffdc73"
  amber-800: "#ff9300"
  amber-1000: "#561900"
  blue-100: "#f0f7ff"
  blue-200: "#e9f4ff"
  blue-400: "#cae7ff"
  blue-700: "#006bff"
  blue-800: "#0059ec"
  blue-1000: "#002359"
  green-100: "#ecfdec"
  green-200: "#e5fce7"
  green-400: "#b9f5bc"
  green-700: "#28a948"
  green-800: "#279141"
  green-1000: "#003a00"
typography:
  display-xl:
    fontFamily: Source Serif 4
    fontSize: 76px
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: -1px
  display-lg:
    fontFamily: Source Serif 4
    fontSize: 44px
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: -0.5px
  heading-24:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.2px
  label-14:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
  copy-14:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
  button-14:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1
  label-14-mono:
    fontFamily: Geist Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.28px
  nav-link:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: 6px
  md: 12px
  lg: 16px
  xl: 20px
  pill: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 40px
  3xl: 64px
  section: 96px
components:
  button-primary:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    height: 40px
    typography: "{typography.button-14}"
  button-primary-active:
    backgroundColor: "{colors.navy-press}"
  button-secondary:
    backgroundColor: "{colors.background-100}"
    textColor: "{colors.gray-1000}"
    rounded: "{rounded.sm}"
    height: 40px
  button-error:
    backgroundColor: "{colors.red-800}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    height: 40px
  input:
    backgroundColor: "{colors.background-100}"
    textColor: "{colors.gray-1000}"
    rounded: "{rounded.sm}"
    height: 40px
    typography: "{typography.label-14}"
  severity-chip-critical:
    backgroundColor: "{colors.red-100}"
    textColor: "{colors.red-1000}"
    rounded: "{rounded.pill}"
  severity-chip-caution:
    backgroundColor: "{colors.amber-100}"
    textColor: "{colors.amber-1000}"
    rounded: "{rounded.pill}"
  severity-chip-info:
    backgroundColor: "{colors.blue-100}"
    textColor: "{colors.blue-1000}"
    rounded: "{rounded.pill}"
  severity-chip-success:
    backgroundColor: "{colors.green-100}"
    textColor: "{colors.green-1000}"
    rounded: "{rounded.pill}"
  severity-chip-hold:
    backgroundColor: "{colors.amber-100}"
    textColor: "{colors.amber-1000}"
    rounded: "{rounded.pill}"
  button-pill-navy:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: 16px
  button-pill-navy-active:
    backgroundColor: "{colors.navy-press}"
  button-pill-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.navy}"
    rounded: "{rounded.pill}"
    padding: 16px
---

# Basepair Design System

## Overview

Basepair is a pharmacogenomic decision-support product with two visual layers that share tokens but follow different rules.

**The console** (the app pharmacists work in) is Vercel's Geist design system, Light theme: 10-step accent scales where the step encodes intent, Geist Sans and Geist Mono, 4px spacing, 6px control radius, tonal elevation, and a two-layer focus ring. Light theme only; there is no dark mode and no toggle. Two deliberate deviations from Geist. First, for patient safety: Geist assigns blue to success, Basepair maps success to Geist green and keeps red = critical and amber = caution. Second, for brand and clarity: navy (#173c63) replaces gray-1000 as the primary action and blue-700 as the interface accent (links, focus). Blue now means Info and nothing else in the console, which removes blue's double duty between interface accent and clinical state.

**Marketing surfaces** (site, showcase, docs shell) use a warmer editorial register: white canvas, one navy accent (#173c63), a serif display face, pill CTAs, and centered hero compositions. This layer is chrome. It never carries clinical meaning and its typeface and radii never leak into the console.

The governing rule on both layers: **severity is never color alone.** Every severity indicator is color plus icon plus text label. Contrast target is WCAG AA, 4.5:1 for body text (verified per pair, not assumed).

## Colors

### Marketing shell (non-clinical)

- **Navy** (#173c63): the product accent on both layers. In the console: primary action (Approve), links, focus ring. In marketing: pill CTAs, links, focus, section-tag dots, stat numbers. 11.27:1 on white; white text on navy also passes. Navy is dark and desaturated so it cannot be confused with the bright blue-700 that means Info.
- **Navy Press** (#0f2c4b): pressed/hover state for navy fills.
- **Ink** (#000000): marketing headlines.
- **Body** (#4c4c4c): marketing running text. 8.59:1 on white.
- **Muted** (#8a8a8a): 3.45:1 on white, which fails AA for small text. Large text (19px bold / 24px regular and up) and decorative captions only. Small essential text uses Body.
- **Hairline** (#e8e8e8): marketing rules and card borders.
- **Field** (#f6f8fa): soft section band behind showcased cards.
- **Surface** (#ffffff): the canvas everywhere.

### Console neutrals (Geist)

- **gray-1000** (#171717) primary text, **gray-900** (#4d4d4d) secondary, **gray-700** (#8f8f8f) disabled.
- **background-100** (#ffffff) page and card surface; **background-200** (#fafafa) subtle separation only, never a general fill.
- **gray-alpha-400** (#00000014) is the default border and divider. It is an 8-digit alpha hex by design (translucent borders layer over any surface); consumers that reject alpha hex may substitute solid #ebebeb on white.
- Hover surfaces step the gray scale: gray-100 default hover, gray-200 active.

### Clinical scales

Four Geist accent scales carry clinical meaning and nothing else does. The step encodes intent: 100 fill, 200 hover fill, 400 border, 700 high-contrast icon, 800 solid fill behind white text (the AA-safe step), 1000 text on a 100 tint. Full 10-step scales live in the engineering companion; the front matter carries the steps components consume.

- **Red** = Critical (avoid / contraindicated)
- **Amber** = Caution and Hold. Amber is the hardest hue for AA: text is always amber-1000, icons amber-800, and white text never sits on amber.
- **Blue** = Info, and only Info. Console links and the focus ring use navy, so blue never appears as interface chrome.
- **Green** = Success / verified / approved.

Forbidden accents: coral, orange, and any warm hue adjacent to red or amber. Amber's icon step is #ff9300, which is orange; a warm brand accent would read as a sixth severity state. Geist's teal, purple, and pink scales are reserved for future categorical use and carry no meaning today.

## Severity & Clinical States

Every state renders as a chip: `*-100` fill, `*-400` border, `*-1000` text, `*-700` icon (amber uses `*-800`), pill radius, and always an icon plus a text label. Chips render on white surfaces only. Cards that carry chips stay white on every band, so clinical color is always read against the same background.

| State | Hue | Meaning |
|---|---|---|
| Critical | red | Avoid / contraindicated (e.g. clopidogrel in CYP2C19 PM, CPIC Strong) |
| Caution | amber | Adjust / consider change (CPIC Moderate / Optional) |
| Info | blue | Informational, no action |
| Success | green | Verifier passed / approved / no issue |
| Hold | amber | Awaiting pharmacist sign-off (Medplum Task = requested) |

## Typography

Three families with a hard boundary:

- **Source Serif 4** (`display-xl`, `display-lg`): marketing display only. Weight 400 with negative tracking; hierarchy comes from size, never boldness. The serif is never bundled with the console. The safest boundary is a font that does not exist in the app.
- **Geist** (sans): all console UI and all marketing body text. Headings at 600, labels and copy at 400, buttons at 500. Defaults: `copy-14` and `label-14` cover most console text; the console rarely needs above `heading-24`.
- **Geist Mono**: clinical data that must read exactly or align: diplotypes (*2/*2), gene symbols, RxCUIs, LOINC codes, confidence values. Tabular figures where numbers stack.

Apply tokens; never hand-set size, weight, or line-height.

## Layout

4px spacing scale (4, 8, 12, 16, 24, 32, 40, 64, 96). Console rhythm: 8 inside a group, 16 between groups, 32 to 40 between sections. Cards take 24px padding (16 compact, 32 hero). Marketing sections sit at 96px vertical intervals with a centered ~1120px to 1200px content column.

Breakpoints: sm 401, md 601, lg 961, xl 1200, 2xl 1400. Marketing heroes center; console layouts are left-aligned working surfaces.

## Elevation & Depth

Tonal surfaces and borders first; shadows subtle and rare.

- Raised cards: `0 2px 2px rgba(0,0,0,0.04)`
- Popovers/menus: `0 1px 1px rgba(0,0,0,0.02), 0 4px 8px -4px rgba(0,0,0,0.04), 0 16px 24px -8px rgba(0,0,0,0.06)`
- Modals: `0 1px 1px rgba(0,0,0,0.02), 0 8px 16px -4px rgba(0,0,0,0.04), 0 24px 32px -8px rgba(0,0,0,0.06)`

Marketing cards may use a single faint shadow (`0 1px 3px rgba(0,0,0,0.05)`) over the hairline border. Depth otherwise comes from the white/field surface alternation.

## Shapes

Two radius vocabularies, one boundary:

- **Console**: `sm` 6px for every control, card, and alert row; `md` 12px for menus and modals; `lg` 16px for fullscreen surfaces; `pill` for severity chips and avatars only. One radius family per view; a child's radius never exceeds its parent's.
- **Marketing**: pill CTAs (9999px), 16px to 20px cards, section tags as small bordered pills with a navy dot.

Pills are marketing chrome. A pill button inside the console is a spec violation; the chip is the console's one fully round element.

## Components

### Console (Geist specs)

Heights: 40px default, 32px small, 48px large. Radius 6px. Hover and active step the scale (100→200→300 fills, 400→500→600 borders). Disabled: gray-100 fill, gray-700 text, not-allowed cursor.

- **Button primary** (Approve): navy fill, white text, darkens to navy-press. The one most important action per view.
- **Button secondary**: background-100 fill, gray-1000 text, gray-alpha-400 border.
- **Button tertiary**: transparent, gray-1000 text, gray-alpha tint on hover.
- **Button error** (Dismiss): red-800 fill, white text. Destructive only; the 800 step passes AA behind white, several 700 fills do not.
- **Input**: background-100 fill, gray-alpha-400 border, 6px radius, `label-14`.
- **Severity chip**: the quartet per state above, icon plus label always. Build one `<SeverityChip>` component; that component is where "never color alone" lives.
- **Focus ring** (two-layer): `box-shadow: 0 0 0 2px background-100, 0 0 0 4px navy` on every interactive element at `:focus-visible`. Never removed without a visible replacement. The same ring is used on marketing surfaces.

### Marketing

- **button-pill-navy**: navy fill, white text, pill radius, darkens to navy-press.
- **button-pill-outline**: white fill, navy text and 1px navy border, pill radius.
- **section-tag**: bordered pill, 13px label, 6px navy dot.
- **stat-card**: hairline border, 16px radius, serif number in navy, Geist label and description.
- **cta-band**: navy rounded card (20px), white serif headline, inverted white pill CTA.

## Do's and Don'ts

- Do render every severity indicator as color + icon + text label. No exceptions.
- Do keep chips on white surfaces; a card carrying chips stays white on any band.
- Do use the 800 step behind white text; 700 is for icons and accents on light fills.
- Do treat amber as the trap: amber-1000 text, amber-800 icons, no white text on amber, no solid amber buttons.
- Do keep one primary action per console view (navy fill).
- Do verify every new text pair against 4.5:1 before shipping; do not assume a hue family inherits a pass.
- Don't put a serif glyph anywhere in the console. Serif is marketing display only.
- Don't introduce coral, orange, or any warm accent. It will read as a severity state.
- Don't give navy clinical meaning, and don't use blue-700 outside the Info chip. Navy is interface, blue is Info, on both layers.
- Don't use pill buttons in the console or 6px buttons in marketing heroes. The radius is the layer boundary.
- Don't use background-200 as a general fill or swap gray for background tokens.
- Don't add a dark theme. The app forces light (`color-scheme: light`), by decision.