---
version: alpha
name: Basepair
description: Two-layer system. The console (the clinical app) is Vercel Geist Light with two deviations, success mapped to green and navy as the interface accent. Marketing surfaces share the navy under an editorial shell with a serif display face that never enters the console.
colors:
  # ---- Marketing shell (non-clinical chrome, warm ivory) ----
  navy: "#173c63"
  navy-press: "#0f2c4b"
  ink: "#211f1a"
  muted-foreground: "#6b6459"
  canvas: "#f4f1ea"
  muted: "#eae3d4"
  hairline: "#e0d8c7"
  surface: "#ffffff"
  # ---- Console neutrals (Geist) ----
  background-100: "#ffffff"
  background-200: "#fafafa"
  gray-100: "#f2f2f2"
  gray-200: "#ebebeb"
  gray-400: "#e2e2e2"
  gray-700: "#8f8f8f"
  gray-900: "#4d4d4d"
  gray-1000: "#171717"
  gray-alpha-400: "#00000014"
  # ---- Clinical scales (Geist accents, steps chips and controls use) ----
  red-100: "#ffeeed"
  red-200: "#ffe8ea"
  red-400: "#ffd7d4"
  red-700: "#fc0035"
  red-800: "#ea001d"
  red-1000: "#47000c"
  amber-100: "#fff6de"
  amber-200: "#fff4cf"
  amber-400: "#ffdc73"
  amber-800: "#ff9300"
  amber-900: "#d17700"
  amber-1000: "#561900"
  blue-100: "#f0f7ff"
  blue-200: "#e9f4ff"
  blue-400: "#d3e4ff"
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
    fontSize: 60px
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: -0.02em
  display-lg:
    fontFamily: Source Serif 4
    fontSize: 48px
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: -0.02em
  display-md:
    fontFamily: Source Serif 4
    fontSize: 40px
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: -0.01em
  display-sm:
    fontFamily: Source Serif 4
    fontSize: 30px
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: -0.01em
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
  2xs:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.3
  nav-link:
    fontFamily: Geist
    fontSize: 14px
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
  button-cta-navy:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 16px
  button-cta-navy-active:
    backgroundColor: "{colors.navy-press}"
  button-cta-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.navy}"
    rounded: "{rounded.md}"
    padding: 16px
---

# Basepair Design System

## Overview

Basepair is a pharmacogenomic decision-support product with two visual layers that share tokens but follow different rules.

**The console** (the app pharmacists work in) is Vercel's Geist design system, Light theme: 10-step accent scales where the step encodes intent, Geist Sans and Geist Mono, 4px spacing, 6px control radius, tonal elevation, and a two-layer focus ring. Light theme only; there is no dark mode and no toggle. Two deliberate deviations from Geist. First, for patient safety: Geist assigns blue to success, Basepair maps success to Geist green and keeps red = critical and amber = caution. Second, for brand and clarity: navy (#173c63) replaces gray-1000 as the primary action and blue-700 as the interface accent (links, focus). Blue now means Info and nothing else in the console, which removes blue's double duty between interface accent and clinical state.

**Marketing surfaces** (site, showcase, docs shell) use a warmer editorial register: a warm-ivory canvas (#f4f1ea) with white cards, one navy accent (#173c63), a serif display face, 12px CTAs, and centered hero compositions. This layer is chrome. It never carries clinical meaning and its typeface and radii never leak into the console.

The governing rule on both layers: **severity is never color alone.** Every severity indicator is color plus icon plus text label. Contrast target is WCAG AA, 4.5:1 for body text (verified per pair, not assumed).

## Colors

### Marketing shell (non-clinical)

The marketing shell is a warm-ivory system, not a white one. Depth comes from warm-neutral panel layering — ivory canvas, tan filled cards, white raised cards — rather than shadows or new hues. Navy stays the only accent, and the status palette is never warmed: chips keep their exact console values on every band.

- **Navy** (#173c63): the product accent on both layers. In the console: primary action (Approve), links, focus ring. In marketing: CTAs, links, focus, section-tag dots, stat numbers. 11.27:1 on white and roughly 10:1 on ivory; white text on navy also passes. Navy is dark and desaturated so it cannot be confused with the bright blue-700 that means Info.
- **Navy Press** (#0f2c4b): pressed/hover state for navy fills.
- **Canvas** (#f4f1ea): warm ivory, the marketing page background.
- **Surface** (#ffffff): cards and popovers, the raised layer against ivory. Any card carrying clinical chips is this white.
- **Muted** (#eae3d4): tan filled cards, the middle layer of the panel stack.
- **Hairline** (#e0d8c7): rules and card borders, tuned to the warm neutrals.
- **Ink** (#211f1a): headlines and running text, a warm near-black.
- **Muted-foreground** (#6b6459): secondary text. 5.18:1 on ivory and 4.58:1 on tan — passes AA on both, where the old #8a8a8a sat at 3.45:1 and failed.

### Console neutrals (Geist)

- **gray-1000** (#171717) primary text, **gray-900** (#4d4d4d) secondary, **gray-700** (#8f8f8f) disabled.
- **background-100** (#ffffff) page and card surface; **background-200** (#fafafa) subtle separation only, never a general fill.
- **gray-alpha-400** (#00000014) is the default border and divider. It is an 8-digit alpha hex by design (translucent borders layer over any surface); consumers that reject alpha hex may substitute solid #ebebeb on white.
- **gray-400** (#e2e2e2) is the solid border step. Corrected: the old value #eaeaea was lighter than gray-300 — an inverted scale step — and #e2e2e2 restores the monotonic ramp.
- Hover surfaces step the gray scale: gray-100 default hover, gray-200 active.

### Clinical scales

Four Geist accent scales carry clinical meaning and nothing else does. The step encodes intent: 100 fill, 200 hover fill, 400 border, 700 high-contrast icon, 800 solid fill behind white text (the AA-safe step), 1000 text on a 100 tint. Amber is the one exception on the icon step — see below. The icon steps now share a single lightness band (oklch L 0.62–0.66) across all four hues, so the same step carries the same visual weight everywhere and the step genuinely encodes intent. The token base is authored in oklch(); hex values here are reference equivalents. Full 10-step scales live in the engineering companion; the front matter carries the steps components consume — the 200 hover fills and green-800 now exist as real tokens, not just documented intent.

- **Red** = Critical (avoid / contraindicated)
- **Amber** = Caution and Hold. Amber is the hardest hue for AA: text is always amber-1000, and the icon step is **amber-900** (#d17700, oklch(0.655 0.151 61.6)) — 3.07:1 on amber-100 and 3.31:1 on white. Amber-800 (#ff9300) measured 2.07:1 on amber-100, a WCAG 1.4.11 failure as an icon; it remains reserved for solid fills behind white text and nothing else. Amber's tint-to-text hue drift (yellow tints, red-brown text) is inherited from Geist and retained deliberately.
- **Blue** = Info, and only Info. Console links and the focus ring use navy, so blue never appears as interface chrome.
- **Green** = Success / verified / approved. The icon token (`--success`) is darkened off-scale to #25a445 (oklch(0.631 0.172 147.2)): 3.06:1 on green-100, where green-700 sits at 2.89:1. Green-700 itself is unchanged in the ramp (charts still use it).

Forbidden accents: coral, orange, and any warm hue adjacent to red or amber. Amber's icon and solid steps (#d17700, #ff9300) already live in orange territory; a warm brand accent would read as a sixth severity state. Geist's teal, purple, and pink scales are reserved for categorical use and carry no meaning today.

**Charts** never draw from the four clinical hues for categorical data — a red series beside a red chip counterfeits severity. Categorical series use the reserved teal/purple/pink scales. `--chart-3` no longer reuses amber-700 (1.86:1 on white — invisible); it is oklch(0.655 0.142 70) ≈ #c77e00. Treat the current chart-1..4 assignments as placeholders to revisit before any chart ships.

## Severity & Clinical States

Every state renders as a chip: `*-100` fill, `*-400` border, `*-1000` text, `*-700` icon (amber uses `*-900`), pill radius, and always an icon plus a text label. Chips render on white surfaces only. Cards that carry chips stay white on every band, so clinical color is always read against the same background.

| State | Hue | Meaning |
|---|---|---|
| Critical | red | Avoid / contraindicated (e.g. clopidogrel in CYP2C19 PM, CPIC Strong) |
| Caution | amber | Adjust / consider change (CPIC Moderate / Optional) |
| Info | blue | Informational, no action |
| Success | green | Verifier passed / approved / no issue |
| Hold | amber | Awaiting pharmacist sign-off (Medplum Task = requested) |

## Typography

Three families with a hard boundary:

- **Source Serif 4** (`display-xl` 60px, `display-lg` 48px, `display-md` 40px, `display-sm` 30px): marketing display only. Weight 400 with negative tracking (-0.02em on xl/lg, -0.01em on md/sm); hierarchy comes from size, never boldness. The serif is never bundled with the console. The safest boundary is a font that does not exist in the app.
- **Geist** (sans): all console UI and all marketing body text. Headings at 600, labels and copy at 400, buttons at 500. Defaults: `copy-14` and `label-14` cover most console text; the console rarely needs above `heading-24`. Nav links are 14px (`text-sm`). The console micro tier is `2xs` (11px/1.3); uppercase micro-labels add `tracking-caps` (0.12em).
- **Geist Mono**: clinical data that must read exactly or align: diplotypes (*2/*2), gene symbols, RxCUIs, LOINC codes, confidence values. Tabular figures where numbers stack.

The ramp now exists as Tailwind `@theme` tokens, and sizes MUST come from them (`text-display-lg`, `text-2xs`, `text-sm`, …). Apply tokens; never hand-set size, weight, or line-height.

## Layout

4px spacing scale (4, 8, 12, 16, 24, 32, 40, 64, 96). Console rhythm: 8 inside a group, 16 between groups, 32 to 40 between sections. Cards take 24px padding (16 compact, 32 hero). Marketing sections sit at 96px vertical intervals with a centered ~1120px to 1200px content column.

Breakpoints: sm 401, md 601, lg 961, xl 1200, 2xl 1400. Marketing heroes center; console layouts are left-aligned working surfaces.

## Elevation & Depth

Tonal surfaces and borders first; shadows subtle and rare. The three recipes are unchanged in value but now live as `@theme` tokens — `--shadow-raised`, `--shadow-popover`, `--shadow-modal` — consumed as the `shadow-raised` / `shadow-popover` / `shadow-modal` utilities. Never hand-inline a shadow stack.

- `shadow-raised` (cards): `0 2px 2px rgba(0,0,0,0.04)`
- `shadow-popover` (popovers/menus): `0 1px 1px rgba(0,0,0,0.02), 0 4px 8px -4px rgba(0,0,0,0.04), 0 16px 24px -8px rgba(0,0,0,0.06)`
- `shadow-modal` (modals): `0 1px 1px rgba(0,0,0,0.02), 0 8px 16px -4px rgba(0,0,0,0.04), 0 24px 32px -8px rgba(0,0,0,0.06)`

Marketing cards may use a single faint shadow (`0 1px 3px rgba(0,0,0,0.05)`) over the hairline border. Depth otherwise comes from the warm-neutral panel layering: ivory canvas, tan muted cards, white surface cards.

## Shapes

Two radius vocabularies, one boundary:

- **Console**: `sm` 6px for every control, card, and alert row; `md` 12px for menus and modals; `lg` 16px for fullscreen surfaces; `pill` for severity chips and avatars only. One radius family per view; a child's radius never exceeds its parent's.
- **Marketing**: `md` 12px CTAs, 16px to 20px cards, section tags as small bordered pills with a navy dot.

Pill radius is reserved for small round furniture — severity chips and avatars in the console, section tags in marketing. A pill button is a spec violation on either layer; the chip is the console's one fully round element. The layer boundary now lives in the button radius step: 6px controls are console, 12px CTAs are marketing.

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

- **button-cta-navy**: navy fill, white text, 12px radius (`md`), darkens to navy-press.
- **button-cta-outline**: white fill, navy text and 1px navy border, 12px radius.
- **section-tag**: bordered pill, 13px label, 6px navy dot.
- **stat-card**: hairline border, 16px radius, serif number in navy, Geist label and description.
- **cta-band**: navy rounded card (20px), white serif headline, inverted white 12px CTA.

## Do's and Don'ts

- Do render every severity indicator as color + icon + text label. No exceptions.
- Do keep chips on white surfaces; a card carrying chips stays white on any band, and the status palette is never warmed to match the ivory shell.
- Do use the 800 step behind white text; 700 is for icons and accents on light fills (amber's icon is the 900 step — its 800 fails 3:1 on the tint).
- Do treat amber as the trap: amber-1000 text, amber-900 icons, amber-800 reserved for solid fills behind white text and nothing else, no solid amber buttons.
- Do keep one primary action per console view (navy fill).
- Do verify every new text pair against 4.5:1 and every icon or non-text indicator against 3:1 (WCAG 1.4.11) before shipping; do not assume a hue family inherits a pass.
- Don't put a serif glyph anywhere in the console. Serif is marketing display only.
- Don't introduce coral, orange, or any warm accent. It will read as a severity state.
- Don't give navy clinical meaning, and don't use blue-700 outside the Info chip. Navy is interface, blue is Info, on both layers.
- Don't use pill buttons on either layer, and don't use 6px buttons in marketing heroes. The radius is still the layer boundary — 6px controls in the console, 12px CTAs in marketing — and pill stays with chips, avatars, and section tags.
- Don't draw chart series from the four clinical hues; categorical data uses the reserved teal/purple/pink scales.
- Don't use background-200 as a general fill or swap gray for background tokens.
- Don't add a dark theme. The app forces light (`color-scheme: light`), by decision.