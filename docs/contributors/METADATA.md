# Handout metadata

Every handout starts with block-style YAML between `---` delimiters. The build
loads this metadata with `scripts/lib/metadata.mjs`, which deliberately supports
only mappings, lists, and scalar values. YAML aliases, tags, flow collections,
and multi-line scalars are rejected so metadata has one predictable meaning.
Errors use the form `source/path.md: field.name: concise explanation`.

## Document schema

| Field | Type and rule |
|---|---|
| `code` | Unique section code and three-digit document index, such as `COM-001`. |
| `title` | Resident-facing title. |
| `section` / `sectionNumber` | Exact binder section and matching number, 1–8. |
| `status` | `draft`, `under-review`, or `approved`. |
| `version` | String or number in `MAJOR.MINOR` form, such as `1.0`. |
| `lastReviewed` | A real ISO calendar date (`YYYY-MM-DD`), not merely text in that shape. For drafts, it is the date the draft was last assessed and is not an approval claim. |
| `pageCount` | Integer `1` or `2`, checked against source page breaks and the PDF. |
| `reviewers.editor` | Name of the editor, or `unassigned` before approval. |
| `reviewers.subjectMatter` | Name of the qualified technical reviewer, or `unassigned` before approval. |
| `sources` | Non-empty list of structured source records described below. |

Section numbering is: 1 Start Here; 2 Alerts & Communication; 3 Evacuation &
Shelter; 4 Water, Food & Cooking; 5 Home & Utilities; 6 Hands-On Skills; 7
Hazard Guides; 8 Plans & Records.

Document-code prefixes are: `STH` Start Here; `COM` Alerts & Communication;
`EVS` Evacuation & Shelter; `WFC` Water, Food & Cooking; `HUT` Home &
Utilities; `SKL` Hands-On Skills; `HZD` Hazard Guides; and `PRP` Plans &
Records. Assign indexes sequentially within each section and retain all three
digits (for example, `COM-001`, `COM-002`). The complete code appears on the
outside-edge tab so a filed handout identifies both its section and its index.

## Structured sources

Every source has a `type` and `title`. Optional `publicationDate`, `updateDate`,
and `accessDate` values, when present, must be real ISO dates. Approved records
have these additional requirements:

| `type` | Representation and required fields for approval |
|---|---|
| `web` | A public web page or online document: `title`, `organization`, absolute HTTP(S) `url`, and `accessDate`; add `publicationDate` or `updateDate` when the publisher supplies one. |
| `non-web` | A book, printed standard, or other non-web publication: `title`, `organization`, and a complete human-readable `citation` (edition, publisher, pages, or document identifier as applicable). Do not invent a URL or access date. |
| `interview` | A conversation used as evidence: descriptive `title`, `interviewee`, `role`, and `interviewDate`. Obtain permission and do not commit private contact details. |
| `local` | A file or record supplied locally but not publicly retrievable: descriptive `title`, `provider`, `location` (a durable repository/file-record identifier, not a workstation path), and `receivedDate`. Do not invent a public URL. |

Example web source:

```yaml
sources:
  - type: web
    title: Ready, Set, Go! Wildland Fire Action Guide
    organization: California Department of Forestry and Fire Protection
    url: https://www.fire.ca.gov/prepare/get-ready-to-go
    publicationDate: 2025-05-01
    accessDate: 2026-09-24
```

## Status-dependent rules

Draft and under-review handouts may use `unassigned` reviewers and visibly
marked incomplete source data. This makes work in progress buildable. An
`approved` handout fails validation unless all of the following are true:

1. Both `reviewers.editor` and `reviewers.subjectMatter` contain names, neither
   is `unassigned`, and the names differ so the two required roles are recorded
   independently.
2. Every source meets the requirements for its `type`; URLs and dates are valid.
3. No source field contains `PLACEHOLDER`, `[VERIFY]`, sample-text language, or
   another unresolved verification marker.
4. The body contains no `SAMPLE TEXT`, `NOT APPROVED ADVICE`, `PLACEHOLDER`,
   `[VERIFY ...]`, or “requires verification” marker.
5. `lastReviewed` is a real ISO calendar date and `code` and `version` match the
   formats above. These format rules apply to every status, not only approval.
6. The approved handout also supplies the separately validated `proofRecord`
   required by the publishing build.

Validation fixtures in `test/metadata-fixtures/` exercise a valid approval and
each approval rejection. Run them with `npm test`.

## Asset manifest

Each `assets/handouts/<CODE>/` directory has a `manifest.json`. The build checks
the manifest even if an asset is not yet referenced, verifies referenced files
exist, and requires the HTML `alt` text to match. See
[`PRINT-DESIGN-SYSTEM.md`](PRINT-DESIGN-SYSTEM.md) and
[`ASSETS.md`](ASSETS.md) for the complete asset workflow, and
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the authoring and print rules.
