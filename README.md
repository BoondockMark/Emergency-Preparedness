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
docs/previews/           Generated visual proof SVGs
docs/contributors/       Authoring and review instructions
docs/publishing/         Moodle and print handoff instructions
.github/                  Pull request template and CI workflow
BINDER_INDEX.md           Generated inventory and review status
```

The eight section folders are kept even when empty: Start Here; Alerts & Communication; Evacuation & Shelter; Water, Food & Cooking; Home & Utilities; Hands-On Skills; Hazard Guides; Plans & Records.

## Exact setup and build

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
npm run build
```

`npm run build` validates metadata and local links, renders HTML, rejects overflowing pages, writes PDFs and SVG proofs, verifies PDF page counts, and regenerates the binder and Moodle indexes. Generated browser HTML is temporary in `build/`; PDFs and proofs are versioned for review.

To run the same checks without changing behavior (the generated outputs are still refreshed deterministically):

```bash
npm run check
```

## Preview one handout

Build first, then run:

```bash
npm run preview -- COM-03
```

Open the printed URL. For an immediate visual proof, open `docs/previews/COM-03-page-1.svg`. Use the browser print dialog only for spot checks; committed PDFs are produced by the reproducible build.

## Source choice

Handout prose uses **Markdown with YAML front matter** because it is readable in pull-request diffs and approachable for volunteers. Small, documented HTML classes provide print-specific patterns that Markdown alone cannot express reliably. A dependency-free Node build applies one shared HTML shell and CSS, so volunteers do not hand-edit repeated headers, footers, page numbers, or edge labels. This is slightly more tooling than standalone HTML, but prevents layout drift and makes page-count/overflow checks practical.

## Review and publication

1. Edit one Markdown source and keep its status `draft`.
2. Open a pull request; CI builds proof artifacts but never publishes them.
3. An editor reviews clarity, accessibility, citations, and layout.
4. An appropriate subject-matter reviewer verifies safety guidance and local facts.
5. Record both reviewers, the review date, and sources; change status to `approved` only after both reviews.
6. Rebuild, inspect every proof, merge, then follow the [Moodle handoff](docs/publishing/MOODLE.md).

See [contributor guidance](docs/contributors/CONTRIBUTING.md), [metadata reference](docs/contributors/METADATA.md), the [binder index](BINDER_INDEX.md), and [duplex proof instructions](docs/publishing/PRINTING.md).
