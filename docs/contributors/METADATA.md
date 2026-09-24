# Handout metadata

Every source begins with YAML front matter:

| Field | Meaning |
|---|---|
| `code` | Stable, unique code such as `COM-03`; never reused. |
| `title` | Resident-facing title. |
| `section` / `sectionNumber` | Exact binder section and its number, 1–8. |
| `status` | `draft`, `under-review`, or `approved`. |
| `version` | Editorial version, incremented when published content changes. |
| `lastReviewed` | ISO date (`YYYY-MM-DD`) of the latest recorded review. For a draft, this is the date its placeholder content was last assessed, not an approval claim. |
| `pageCount` | `1` or `2`; checked against source breaks and output PDF. |
| `reviewers.editor` | Named editor, or `unassigned` before review. |
| `reviewers.subjectMatter` | Named qualified reviewer, or `unassigned` before review. |
| `sources` | YAML list of sources or an explicit placeholder while draft. |

Section numbering: 1 Start Here; 2 Alerts & Communication; 3 Evacuation & Shelter; 4 Water, Food & Cooking; 5 Home & Utilities; 6 Hands-On Skills; 7 Hazard Guides; 8 Plans & Records.

## Asset manifest

Each `assets/handouts/<CODE>/` directory has a `manifest.json`. The build checks
the manifest even if an asset is not yet referenced, verifies referenced files
exist, and requires the HTML `alt` text to match. Example:

```json
{
  "assets": [
    {
      "file": "evacuation-route.svg",
      "type": "diagram",
      "creator": "Jane Example, LHH Fire Watch",
      "source": "Created for COM-03 from reviewed route information",
      "license": "Project-owned; approved for publication",
      "alt": "Two labeled evacuation routes lead east from the neighborhood meeting point; Route B is dashed.",
      "caption": "Use Route B if officials close Route A.",
      "decorative": false
    }
  ]
}
```

| Asset field | Requirement |
|---|---|
| `file` | File name only, unique within the manifest. Published files are `.svg`, `.png`, `.jpg`, or `.jpeg`; diagrams must be SVG. |
| `type` | `photograph`, `illustration`, or `diagram`. |
| `creator` | Person or organization that made the visual. Use `Unknown` only after a documented rights review, never as a shortcut. |
| `source` | Original publication, repository, or a note that the project created it. Include a stable URL here when applicable; image HTML itself remains local. |
| `license` | License name/version, public-domain basis, or a concise permission record. “Found online” is not permission. |
| `alt` | Useful replacement text. Must exactly match the `<img alt="…">` value. An empty string is valid only for an explicitly decorative asset. |
| `caption` | Optional visible caption. If supplied, render equivalent text in `<figcaption>`; the manifest alone does not print it. |
| `decorative` | Required Boolean. Set `false` for meaningful content. Set `true` deliberately for decoration and use an empty `alt`. |

Record permission correspondence or license evidence with the editable source in
the same asset directory when redistribution is allowed. Do not put private
contact information in the repository. Reconfirm that licenses permit both the
repository copy and distributed print/PDF output.
