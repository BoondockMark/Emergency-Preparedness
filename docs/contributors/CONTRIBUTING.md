# Contributing and review

## Add or edit a handout

1. Create or edit a `.md` file in the matching `handouts/<section>/` folder. Use `CODE-short-title.md` and never recycle a code after publication.
2. Copy the front matter from an existing source and consult [METADATA.md](METADATA.md).
3. Mark unverified prose **SAMPLE TEXT — NOT APPROVED ADVICE**. Put unverified local details in a `local-info` block and use `[VERIFY]`; never guess emergency numbers, radio frequencies, sandbag sites, endorsements, or official instructions.
4. Add source title, issuing body, URL, publication/update date where available, and access date. Paraphrase rather than copying long passages.
5. Run `npm run build`; inspect each SVG and PDF page at normal size and in grayscale.
6. Submit a pull request using the checklist.

## Reusable patterns

Markdown headings, lists, and emphasis are supported. These HTML wrappers are intentionally allowed:

- `<div class="warning">…</div>` — urgent hazard or stop condition.
- `<div class="checklist"><ul>…</ul></div>` — tick-box list.
- `<ol class="procedure">…</ol>` — numbered action sequence.
- `<div class="diagram">…</div>` — diagram or labeled placeholder.
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
