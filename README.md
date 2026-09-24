# La Habra Heights Fire Watch Emergency Preparedness Binder

GitHub is the editable source of record for print-ready US Letter handouts. Moodle at **lhhfw.com** is the resident-facing publication point. This repository does not update Moodle automatically.

> **Safety status:** The included demonstrations are **draft sample layouts**, not approved emergency advice. Bracketed local facts and source placeholders must be verified before approval or distribution.

## Repository layout

```text
assets/styles/           Shared print CSS
templates/               Generated-page HTML shell
handouts/<section>/      Markdown source and YAML metadata
scripts/                 Build, validation, and preview tools
docs/pdfs/               Generated PDFs (including watermarked/status-marked drafts)
docs/previews/           Browser-rendered PNG proofs
docs/contributors/       Authoring and review instructions
docs/publishing/         Moodle and print handoff instructions
.github/                  Pull request template and CI workflow
BINDER_INDEX.md           Generated inventory and review status
```

The eight section folders are kept even when empty: Start Here; Alerts & Communication; Evacuation & Shelter; Water, Food & Cooking; Home & Utilities; Hands-On Skills; Hazard Guides; Plans & Records.

## Exact setup and build

Requirements: Node.js 20 or newer, npm, and the ability for Puppeteer to install its pinned Chrome for Testing revision during `npm ci`.

```bash
npm ci
npm run build
```

`npm run build` validates metadata and local links, creates each handout from `templates/handout.html` and `assets/styles/print.css`, and loads that file in the Chrome for Testing revision pinned by the exact `puppeteer` dependency. That single browser page produces both the US Letter PDF and its 816×1056 PNG proofs, so warnings, checklists, procedures, grids, diagrams, mirrored binding margins, and outside-edge strips do not pass through a second renderer. For every `.sheet`, the build measures every rendered element against the printable content box and rejects clipping, horizontal or vertical overflow, content outside that box, and footer collisions. Failures identify the handout, page, selector, element bounds, and limiting region in both the log and `build/diagnostics`. PDF counts come from parsing the document catalog's page tree rather than scanning PDF text. Generated browser HTML is temporary in `build/`; PDFs and proofs are versioned for review.

The build also renders `test/fixtures/components.html` twice: once with the live stylesheet and once with the reviewed `test/fixtures/baseline.css`. It compares the resulting RGBA page images with a per-channel threshold of `0.1`; at most `0.1%` of pixels may differ. On failure, actual, expected, and magenta diff images are written to `build/diagnostics` and uploaded by CI. After intentionally reviewing a shared-style change, refresh the frozen fixture stylesheet and rerun all checks with:

```bash
npm run test:visual:update
```

Commit the updated baseline stylesheet in the same pull request so its CSS diff makes the accepted visual change explicit.

For reproducibility, the renderer blocks HTTP(S) requests, decodes the repository's text-encoded fixed Binder Sans font assets, forces UTC and `en-US`, fixes the viewport and device scale, enables background graphics, and supplies explicit 8.5 × 11 inch PDF dimensions. Do not substitute a system browser or run `npm update` when producing committed artifacts; dependency and browser upgrades must update the package manifest and lockfile and regenerate all CI proof artifacts for review. Font binaries are stored as gzip-compressed Base64 text because this repository's pull-request path does not accept binary additions; the build decodes them only into the ignored `build/` directory.

To run the same checks without changing behavior (the generated outputs are still refreshed deterministically):

```bash
npm run check
```

## Preview one handout

Build first, then run:

```bash
npm run preview -- COM-03
```

Open the printed URL. For an immediate visual proof, open `docs/previews/COM-03-page-1.png`. Use the browser print dialog only for spot checks; committed PDFs are produced by the reproducible build.

## Source choice

Handout prose uses **Markdown with YAML front matter** because it is readable in pull-request diffs and approachable for volunteers. Small, documented HTML classes provide print-specific patterns that Markdown alone cannot express reliably. A pinned Puppeteer/Chrome build applies one shared HTML shell and CSS, so volunteers do not hand-edit repeated headers, footers, page numbers, or edge labels. This is slightly more tooling than standalone HTML, but prevents layout drift and makes page-count/overflow checks practical.

## Review and publication

1. Edit one Markdown source and keep its status `draft`.
2. Open a pull request; CI builds proof artifacts but never publishes them.
3. An editor reviews clarity, accessibility, citations, and layout.
4. An appropriate subject-matter reviewer verifies safety guidance and local facts.
5. Record both reviewers, the review date, and sources; change status to `approved` only after both reviews.
6. Rebuild, inspect every proof, merge, then follow the [Moodle handoff](docs/publishing/MOODLE.md).

See [contributor guidance](docs/contributors/CONTRIBUTING.md), [metadata reference](docs/contributors/METADATA.md), the [binder index](BINDER_INDEX.md), and [duplex proof instructions](docs/publishing/PRINTING.md).
