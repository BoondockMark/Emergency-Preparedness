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
