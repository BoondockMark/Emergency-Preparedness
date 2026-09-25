---
name: Handout change
title: "[CODE] Short description"
---

## Change

<!-- Identify handouts/codes and whether each change is editorial-only, substantial/material redesign, or another physical-proof trigger. Explain the classification using docs/publishing/PRINTING.md. -->

## Review record

- [ ] Status is `draft` or `under-review` unless both reviews and any required physical proof below are complete.
- [ ] Editor: @________ — reviewed on YYYY-MM-DD
- [ ] Subject-matter reviewer and qualification/role: @________ — reviewed on YYYY-MM-DD
- [ ] Local facts have a cited verifier, or remain `[VERIFY]` and unpublished.
- [ ] Sources and `lastReviewed` are current.
- [ ] Editorial-only changes received editorial/subject-matter re-review and caused no wrapping, pagination, style, graphic, or geometry change.

## Build and artifact

- [ ] `npm ci`
- [ ] `npm run lint:layout -- CODE` while editing (repeat `CODE` for each changed handout)
- [ ] `npm run check`
- [ ] Every PDF and SVG proof was inspected, including grayscale usability.
- [ ] Page count and edge-strip placement are correct.
- [ ] Exact candidate PDF: `docs/pdfs/________.pdf`
- [ ] Source commit (full SHA): `________________________________________`
- [ ] PDF SHA-256: `________________________________________________________________`

## Physical proof

- [ ] I checked `docs/publishing/PRINTING.md` triggers (geometry/fonts/renderer, stock/printer/driver/settings, and substantial layout).
- [ ] New proof is **required / not required** (delete one). Reason: ________
- [ ] When required, calibration and exact handout PDF were printed at 100%; duplex pages used long-edge flip.
- [ ] When required, grayscale, punch clearance, and measured front/back/outside-strip alignment passed.
- [ ] Approved or materially redesigned handout references completed record: `docs/publishing/proofs/________.md`
- [ ] Handout front matter `proofRecord` points to that record and its checksum matches the exact PDF above.

Printer/model, driver/application, paper stock, and duplex result (or “see proof record”):

## Publication

- [ ] This PR does not publish directly to Moodle.
- [ ] If approved, a named Moodle editor will follow `docs/publishing/MOODLE.md` after merge.
