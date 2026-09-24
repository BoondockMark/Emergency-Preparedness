# Graphics and assets

This guide explains how to add photographs, illustrations, maps, and diagrams
to printable handouts. Assets are local and validated so the same inputs produce
the browser proof and PDF without relying on a network service.

## Directory structure

Give each handout an asset directory whose name exactly matches its metadata
`code`:

```text
assets/handouts/
├── COM-001/
│   ├── manifest.json
│   ├── smoke-column.jpg
│   └── smoke-column-source.svg
└── EVA-002/
    ├── manifest.json
    └── evacuation-route.svg
```

Use descriptive, lower-case file names. Keep editable originals alongside the
published graphics when useful, but do not reference those originals from a
handout or list them in the manifest unless they are also publication assets.
Do not place source graphics in `docs/pdfs/` or `docs/previews/`; those
directories contain generated output.

Published graphics may be SVG, PNG, or JPEG. Use SVG for diagrams. GIF, WebP,
BMP, PDF, and office-document images are not supported.

## Asset manifest

Every asset directory needs a `manifest.json`. Add one entry for each published
graphic:

```json
{
  "assets": [
    {
      "file": "smoke-column.jpg",
      "type": "photograph",
      "creator": "Alex Example",
      "source": "Fire Watch field photograph, 2026-08-12",
      "license": "Used with written permission",
      "alt": "A narrow smoke column rising behind a dry hillside.",
      "caption": "Smoke may be visible before flames.",
      "decorative": false
    }
  ]
}
```

The required fields are `file`, `type`, `creator`, `source`, `license`, and
`decorative`. `type` must be `photograph`, `illustration`, or `diagram`.
Meaningful graphics also require useful `alt` text. `caption` is recommended
when the graphic needs a visible explanation, but is not required by the
manifest validator.

Record the actual creator, origin, and redistribution terms. Do not assume that
an image found online can be republished. Keep permission records outside the
generated output as required by the project owner.

### Alternative text

Alternative text communicates the graphic's purpose rather than merely saying
“image of.” Copy it exactly into both the manifest and the HTML `alt` attribute:

```json
{
  "alt": "A narrow smoke column rising behind a dry hillside.",
  "decorative": false
}
```

A purely decorative image instead uses both `"decorative": true` and
`"alt": ""`. It must still have an explicit `alt=""` in the handout. Never
omit the `alt` attribute.

## Add a graphic to a handout

Handouts are Markdown files, but documented HTML components may be used for
print layout. Reference an asset with the exact repository-relative path
`../assets/handouts/<CODE>/<file>`:

```html
<figure class="figure figure--full figure--crop-3x2"
        style="--crop-position: 50% 35%"
        aria-labelledby="smoke-column-caption">
  <img src="../assets/handouts/COM-001/smoke-column.jpg"
       alt="A narrow smoke column rising behind a dry hillside.">
  <figcaption id="smoke-column-caption">
    Smoke may be visible before flames.
    <span class="credit">Photo: Alex Example, used with permission.</span>
  </figcaption>
</figure>
```

Do not use absolute paths, `file:` URLs, remote HTTP(S) URLs, data URLs, or
`srcset`. A handout may reference assets only from its own code directory. The
build verifies that the file is manifested and that its HTML and manifest
alternative text match exactly.

A caption explains why the graphic matters. A credit gives visible attribution.
Neither replaces the manifest's source and license record. Give each caption a
unique `id` and connect its figure with `aria-labelledby` as shown above.

## Sizing and cropping

Use one width class on every figure:

- `figure--full` uses the printable width.
- `figure--half figure--left` wraps text on the right.
- `figure--half figure--right` wraps text on the left.

After a floated half-width figure and its related text, add:

```html
<div class="figure-clear"></div>
```

With no crop class, the image keeps its intrinsic proportions. The controlled
crop classes are `figure--crop-3x2`, `figure--crop-4x3`, and
`figure--crop-square`. They use `object-fit: cover`; set `--crop-position` only
after confirming the crop retains important content. Use `figure--contain` when
the complete image must remain visible.

Raster graphics must provide at least **200 effective pixels per inch (PPI)** at
their rendered size. A 7-inch-wide image therefore needs to be at least 1,400
pixels wide, and a 3.5-inch-wide image needs to be at least 700 pixels wide.
Avoid upscaling and retain the original when its license permits.

## Diagrams and maps

Use SVG and add `figure--diagram figure--contain` for diagrams and maps:

```html
<figure class="figure figure--full figure--diagram figure--contain"
        aria-labelledby="route-caption">
  <img src="../assets/handouts/EVA-002/evacuation-route.svg"
       alt="A solid line leads from Home to the Meeting Place and a dashed line leads to the alternate location.">
  <figcaption id="route-caption">
    <strong>Figure 1.</strong> Primary and alternate evacuation routes.
    <span class="credit">Diagram: project maintainers; see asset manifest.</span>
  </figcaption>
</figure>
```

Diagrams must remain understandable in grayscale. Combine labels, shapes,
patterns, and solid or dashed lines instead of using color alone. Include an SVG
`<title>` and `<desc>`, and convert unsupported fonts to paths when necessary.
The build rejects SVG scripts, event handlers, embedded HTML, and external
resources.

## Build and review checklist

Run:

```bash
npm run build
npm test
npm run check
```

Then inspect every affected `docs/previews/<CODE>-page-<N>.png` and
`docs/pdfs/<CODE>.pdf`:

- View each page at normal size and zoom in to check raster quality.
- Inspect color and grayscale output.
- Check crops, captions, credits, labels, and reading order.
- Confirm that no content clips, overflows, or enters the binding margin.
- Confirm diagrams remain understandable without color.
- For two-page handouts, complete the physical duplex test in
  [PRINTING.md](../publishing/PRINTING.md).

Commit the source graphic, manifest, handout source, and regenerated tracked
artifacts together. Follow the review requirements in
[CONTRIBUTING.md](CONTRIBUTING.md); a graphic change can require a new physical
proof under the [printing policy](../publishing/PRINTING.md).
