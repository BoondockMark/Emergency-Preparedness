# Contributing and review

Use the approved typography, component intent, warning severity, accessibility
criteria, and page geometry in [PRINT-DESIGN-SYSTEM.md](PRINT-DESIGN-SYSTEM.md).
The component specimen is a test fixture and must never be published.

## Add or edit a handout

1. Create or edit a `.md` file in the matching `handouts/<section>/` folder. Use `CODE-short-title.md` and never recycle a code after publication.
2. Copy the front matter from an existing source and consult [METADATA.md](METADATA.md).
3. Mark unverified prose **SAMPLE TEXT — NOT APPROVED ADVICE**. Put unverified local details in a `local-info` block and use `[VERIFY]`; never guess emergency numbers, radio frequencies, sandbag sites, endorsements, or official instructions.
4. Add source title, issuing body, URL, publication/update date where available, and access date. Paraphrase rather than copying long passages.
5. Put every visual and its editable source in `assets/handouts/<CODE>/`, add it to that directory's `manifest.json`, and follow the image workflow below.
6. Run `npm run build`; inspect each SVG and PDF page at normal size and in grayscale.
7. Submit a pull request using the checklist.

## Images and diagrams

Use the stable asset convention `assets/handouts/<CODE>/` (for example,
`assets/handouts/COM-03/smoke-column.jpg`). Keep editable source files there too,
but do not reference those source files from a handout or list them as published
assets in the manifest. Use clear, lower-case file names. Do not use absolute
paths, `file:` URLs, remote `http(s):` URLs, or data URLs. Published formats are
SVG for diagrams and PNG or JPEG for raster artwork. GIF, WebP, BMP, PDF, and
office-document images are rejected. Diagrams must be SVG.

Every meaningful image needs concise alternative text that communicates its
purpose in this handout rather than merely saying “image of.” Copy that text
exactly into both the `<img alt>` attribute and manifest. A purely decorative
image is allowed only when its manifest has `"decorative": true` **and**
`"alt": ""`; it must still have an explicit `alt=""` in HTML. Never omit `alt`.

Use a `<figure>` with one width class. Captions are optional; credits are not a
substitute for manifest metadata:

```html
<figure class="figure figure--full figure--crop-3x2" style="--crop-position: 50% 35%">
<img src="../assets/handouts/COM-03/smoke-column.jpg" alt="A narrow smoke column rising behind a dry hillside.">
<figcaption>Smoke may be visible before flames. <span class="credit">Photo: A. Example / Example Agency, used with permission.</span></figcaption>
</figure>
```

- `figure--full` uses the printable width. `figure--half` uses half width; add
  `figure--left` or `figure--right` to wrap nearby text, followed by
  `<div class="figure-clear"></div>`.
- With no crop class, intrinsic proportions are retained. Controlled choices are
  `figure--crop-3x2`, `figure--crop-4x3`, and `figure--crop-square`; they use
  `object-fit: cover`. Set the optional `--crop-position` percentage only after
  checking that important content is not cut off. Use `figure--contain` where
  the entire image must remain visible.
- Add `figure--diagram` to diagram figures. Diagrams must remain understandable
  when printed in grayscale: use labels, shapes, patterns, and solid/dashed line
  styles rather than color alone. Include an SVG `<title>` and `<desc>`, convert
  unsupported fonts when needed, and inspect the print proof. The build rejects
  SVG scripts, event handlers, embedded HTML, and external resources before it
  copies the SVG into build output.
- Raster images must provide at least **200 effective pixels per inch (PPI)** at
  their rendered print width. For example, a 7-inch-wide image needs at least
  1400 pixels across. Crop classes do not excuse inadequate resolution. Avoid
  upscaling and retain the original when licensing permits.

## Reusable patterns

Markdown headings, lists, and emphasis are supported. These HTML wrappers are intentionally allowed:

- `<div class="warning">…</div>` — urgent hazard or stop condition.
- `<div class="checklist"><ul>…</ul></div>` — tick-box list.
- `<ol class="procedure">…</ol>` — numbered action sequence.
- `<div class="diagram">…</div>` — diagram or labeled placeholder.
- `<figure class="figure …">…</figure>` — a full/half-width image or diagram with caption and credit (see above).
- `<div class="local-info">…</div>` — locally specific facts requiring verification.
- `<div class="sources">…</div>` — visible citations on the handout.
- `<div class="grid">…</div>` — two-column content.
- `<!-- pagebreak -->` — exactly one break in a two-page handout.

## Required review path

A handout may move from `draft` to `under-review` when it is ready for review. Approval requires two distinct roles:

1. **Editor:** checks plain language, organization, accessibility, source completeness, metadata, and the printed proof.
2. **Subject-matter reviewer:** has appropriate expertise or authority for the topic and checks every safety statement, local fact, diagram, and source against current guidance.

The PR records reviewer names and outcomes. The source metadata is then updated with both names and `lastReviewed`. If either review is incomplete, keep `under-review`. Only an approved PR may set `status: approved`. Substantive later changes return the handout to `under-review`.

## Print review

Check color and grayscale proofs, legibility, clipping, and blank punch space. For two-page documents, perform the physical duplex test in [PRINTING.md](../publishing/PRINTING.md). Automated checks cannot confirm a specific printer's feed direction or alignment.
