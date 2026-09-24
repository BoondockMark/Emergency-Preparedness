# Print design system

This is the approved reference for resident-facing US Letter handouts. The
non-publishable, intentionally dense component specimen is
`test/fixtures/components.html`; it exists only for validation and visual
review. Never link or copy the specimen into Moodle.

## Principles and tokens

Token values live at the top of `assets/styles/print.css`. Contributors should
use the semantic component classes instead of one-off sizes, colors, or page
coordinates.

| Token group | Approved decision |
|---|---|
| Typography | Bundled **DejaVu Sans** is named `Binder Sans`. Body text is 9.5 pt, headings are 10.5–25 pt, captions are 8 pt, and only credits/folios may use the 7.5 pt floor. Body leading is 1.34. |
| Spacing | A 0.025 in base step provides the named `--space-1` through `--space-6` scale. Prefer these intervals inside new components. |
| Rules | `--rule` separates content; `--rule-strong` defines controls, tables, and verified-information boundaries. A rule must support—not replace—a label. |
| Grayscale | Primary and secondary ink remain readable on white. Soft and medium shades establish grouping. Meaningful diagrams use labels plus line style, pattern, or shape. |
| Warnings | Caution, warning, and danger have distinct words, symbols, border styles, and contrast-safe fills. Color is redundant. |
| Geometry | Pages are 8.5 × 11 in. Fronts reserve 0.86 in at the binding edge and 0.60 in outside; backs mirror those values. Top/bottom content limits are 0.55/0.52 in. The outside-edge section tab occupies the section's numbered 1 in vertical slot, measured from the top edge. |

## Component use

- **Page title (`h1`)**: exactly one per sheet. Use normal title styling for
  short titles and `title--compact` only when a reviewed long title wraps
  poorly. Follow heading levels in order; do not choose a level for appearance.
- **Lede**: one plain-language statement of scope or outcome immediately after
  the title. It is not a substitute for an urgent warning.
- **Danger (`warning warning--danger`)**: an immediate severe-harm or
  life-safety stop condition. Put the required stop/leave action first.
- **Warning (`warning`)**: an urgent action needed to reduce serious risk.
- **Caution (`warning warning--caution`)**: a preparation or handling step that
  prevents a lower-severity hazard. Do not use warning styles merely for
  emphasis.
- **Local information**: jurisdiction-specific names, numbers, locations, and
  frequencies. Keep the verification label until a qualified reviewer confirms
  every value.
- **Procedure**: ordered actions whose sequence matters. Start each step with a
  verb and put prerequisites before actions.
- **Checklist**: independent items a reader can mark complete. Use a procedure
  instead if order affects safety.
- **Table**: compact comparison or lookup data, with a visible caption and
  scoped row/column headings. Do not use tables for layout.
- **Figure**: a meaningful image or diagram in a semantic `figure`. Put its
  uniquely identified `figcaption` directly after the image and connect the
  figure with `aria-labelledby`. Captions explain relevance; credits identify
  origin. Alternative text communicates the image's purpose without repeating
  the caption verbatim.
- **Sources**: visible issuing body/title, update date where known, access date,
  and a durable URL. Long URLs may wrap. Source metadata must also be present in
  front matter.
- **Two-column grid**: short, parallel blocks that are read completely down the
  left column, then down the right. Keep DOM order identical to visual reading
  order; never alternate sentences or procedure steps across columns.

## Accessibility acceptance checks

The build checks every rendered handout and the fixture for:

1. **Text size:** 9 pt minimum for instructional content and 7.5 pt for
   captions, credits, and folios; approved defaults are larger where space
   permits.
2. **Contrast:** at least 4.5:1 for normal text and 3:1 for large text against
   the effective background.
3. **No color-only meaning:** each warning has a severity word, symbol, and
   distinctive border. Review diagrams and printed grayscale proofs manually
   for labels, patterns, and line styles.
4. **Reading order:** one `h1` per sheet, no skipped heading level, and source
   order that matches the intended grid/column order. Keyboard and screen-reader
   review remains required for structural changes.
5. **Relationships:** figures need adjacent, explicitly associated captions;
   data tables need captions and scoped headers; every image needs validated
   alternative text.

Automation also rejects content outside the printable region, footer overlap,
clipping, inadequate raster resolution, missing assets, changed visual
baselines, incorrect page counts, and PDFs without an embedded font program.
Review a screen proof, a grayscale print, and a physical duplex copy before
approval because automation cannot judge comprehension or printer mechanics.

## Bundled font evaluation

DejaVu Sans was selected over host Arial because it is legible at the approved
small print sizes, includes the symbols used by the components, has regular and
bold weights, and permits redistribution and PDF embedding under the Bitstream
Vera terms. Its wider metrics consume slightly more horizontal space than
Arial, so the dense fixture and every handout are overflow-tested. This tradeoff
is preferable to platform-dependent pagination.

The exact upstream font bytes are stored as reproducible gzip/base64 text
artifacts and decoded during the build:

| File produced | SHA-256 of decoded TTF |
|---|---|
| `DejaVuSans.ttf` | `ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280` |
| `DejaVuSans-Bold.ttf` | `5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895` |

Copyright, source, and redistribution terms are recorded in
`assets/fonts/LICENSE.txt`. The build waits for `Binder Sans`, produces PDFs,
and then requires at least one embedded font program. Do not replace, subset, or
add font files without recording provenance, license terms, hashes, metric
review, and a new fixture baseline.

## Changing the system

Change tokens deliberately, run `npm run test:visual:update`, inspect both
fixture pages and generated handouts, then run `npm run check`. A baseline
update records an approved decision; it is not evidence that the decision is
accessible or correct. Explain token and baseline changes in review.

