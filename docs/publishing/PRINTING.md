# Print qualification and proof records

The handout PDFs are US Letter (8.5 × 11 inches), with content inset for ordinary printer margins. Odd-numbered pages are fronts: they reserve extra blank space at the left (punch/binding edge) and carry the section strip at right. Even-numbered pages are backs and mirror this, with extra space at right and the strip at left, so the strip stays on the outside edge after turning each sheet. This front/back alternation repeats for every sheet in a longer handout; an odd final page is an unpaired front.

## Qualify a printer or print vendor

Use the generated two-page `build/calibration/printer-calibration.pdf` before approving the first handout from a printer/vendor configuration. Generate it locally with `npm run build`, or download `printer-calibration.pdf` from the workflow's `handout-proofs-<commit>` artifact. The repository stores its deterministic text generator rather than a binary PDF; CI regenerates the PDF from that reviewed source. Qualify each printer model, driver or print application, paper stock/size, scaling mode, and duplex mode that will be used for production.

1. Calculate and retain its checksum (`sha256sum build/calibration/printer-calibration.pdf`). Send the PDF file—not a browser-rendered copy—to a vendor.
2. Print on the intended stock at **Actual size / 100%**, never “fit” or “shrink oversized pages.” Select US Letter, enable background graphics when offered, and disable application-added headers/footers.
3. Select two-sided, **flip on long edge**. Hold the portrait sheet upright and turn it like a book. The back must be upright; the outside strip is right on the front and left on the back.
4. Check that the solid page boundary and 0.5-inch dashed boundary are present and unclipped. Measure the one-inch and 100-mm rulers with a reliable physical ruler.
5. Confirm the grayscale steps are distinguishable and the 7 pt, 8 pt, and 9 pt samples are legible. Assess the smallest size against the production handout's requirements; calibration visibility does not waive the design system.
6. Hold the sheet to a light. Measure the greatest horizontal and vertical displacement between corresponding targets and outside-edge strip ends. Record signed or absolute offsets in millimetres consistently.
7. Punch a sacrificial copy with the production punch/binding process. Confirm marks and content remain clear of the shaded binding zone.
8. Record the result. A vendor must return the physical sample or measurements and photos sufficient for the named reviewer to complete the record; a verbal “looks good” is not a proof.

The calibration sheet characterizes the print path. It does **not** replace physically proofing the exact handout PDF when required below.

## Proof the exact handout artifact

1. Build from the candidate source commit and do not modify the PDF afterward.
2. Run `sha256sum docs/pdfs/<CODE>.pdf` (or `shasum -a 256` on macOS).
3. Print that exact PDF with the qualified settings. For every multi-page PDF use long-edge duplex; do not reorder pages or insert blank backs. Inspect every page and every physical sheet, including an unpaired final front, for correct front/back margins, outside-edge strips, grayscale information, minimum type, and clipping.
4. Punch a sacrificial copy and measure front/back and strip alignment on every sheet. Record the greatest horizontal and vertical offsets (and ruler measurements where used), not only “looks aligned.”
5. Copy [`PROOF_RECORD_TEMPLATE.md`](PROOF_RECORD_TEMPLATE.md) to `docs/publishing/proofs/<CODE>-<YYYY-MM-DD>.md`, complete every field, and commit it. Set the handout's `proofRecord` front-matter value to that repository-relative path.

A completed record ties the handout code and source commit to the **exact PDF bytes** through `pdfPath` and `pdfSha256`, and captures printer model, driver/application, paper, scaling, duplex, reviewer/date, grayscale and punch-clearance outcomes, and measured alignment. The build rejects an `approved` handout with no record, a mismatched code/path/checksum, incomplete physical fields, or outcomes that do not begin with `PASS`.

## When review must be repeated

### New physical proof required

Create a new record and test the exact new PDF when any of these change:

- page size, margins, bleed, orientation, page count, binding/punch clearance, edge-strip position, or other page geometry;
- font family, font file/version, font metrics, minimum type treatment, or font rendering/substitution;
- HTML/CSS template, PDF renderer/browser, renderer version, print stylesheet, image processing, or any build change capable of changing pagination or output geometry;
- printer model or unit where unit-to-unit registration matters, driver/firmware, print application, scaling, duplex path, tray, finishing/binding process, vendor, paper size, or paper stock/weight;
- adding/replacing an image or diagram, changing columns, tables, warnings, callouts, page breaks, or any substantial layout/material redesign;
- any failed, marginal, clipped, illegible, shifted, or unexplained result, even if the category is not listed above.

A previously approved calibration or handout proof cannot be carried forward merely because the filename or handout code is unchanged.

### Editorial re-review only

A new physical proof is not required for text-only spelling, punctuation, citation, link-target, metadata, or wording changes **only when** the generated PDF has no pagination, wrapping, type-style, graphic, or geometry change. Compare all generated page proofs and PDFs. The editor and subject-matter reviewer must re-review affected meaning, sources, local facts, and `lastReviewed`; update the artifact checksum/reference as part of approval. If text reflows, the PDF bytes/layout change cannot confidently be classified as editorial-only, or visual comparison is ambiguous, require a new physical proof.

CI and screen review check geometry and overflow but cannot replace the required physical test.
