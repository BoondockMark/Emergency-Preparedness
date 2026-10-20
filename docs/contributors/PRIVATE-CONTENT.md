# Private binder pages

The public repository contains a safe placeholder for every private handout. The
private repository contains the real Markdown at the **same relative path**, for
example `handouts/plans-records/PRP-001-household-records.md`. Add `private: true`
to the public placeholder's YAML front matter, alongside the usual required
metadata. Its title, code, section, citations, and body must all be safe to share.
Use a short message such as “Private information omitted. Insert your authorized
copy here.” on each reserved page, separated by `<!-- pagebreak -->` on its own
line. Optionally set `pageCount` to the number of placeholder pages.

The private replacement uses the normal handout metadata and review process.
The contents table automatically spans multiple pages as the binder grows. Its
code, section, and sectionNumber must match the public slot. Private and public
lengths may differ; each build computes its own contents page and page numbers. Missing or invalid replacements fail
a private build; they are never silently replaced with placeholders. Unmarked
public handouts cannot be overridden. Private-only handouts need public slots
before they will appear in a binder.

## Local builds

From the public repository:

```bash
git clone https://github.com/BoondockMark/Emergency-Preparedness-Private.git ../Emergency-Preparedness-Private
npm ci
BINDER_PRIVATE_DIR=../Emergency-Preparedness-Private npm run build:private
```

Private builds require `BINDER_PRIVATE_DIR` to explicitly select a checkout outside
the public worktree. Without this selection, `npm run build` uses placeholders.
Cloning uses your existing GitHub access; the renderer does not download content
or store tokens. `--public` ignores the private-directory setting.

- `npm run build:private` requires the private checkout and fails if absent.
- `npm run build:public` always uses placeholders, even with a private checkout.
- `npm run check -- --private` validates the full private binder without comparing
  it to the public committed PDFs.
- `npm run preview -- PRP-001 --private` previews private output after building.

Private HTML, PDFs, previews, diagnostics, and indexes stay in ignored
`<private-checkout>/build/binder/`; print `<private-checkout>/build/binder/pdfs/EMERGENCY_PREPAREDNESS_BINDER.pdf`.
They are never copied into `docs/` or the committed binder index. Public build
working files use `build/`; public PDFs continue to use `docs/pdfs/`.
Browser temporary data is also placed in the private checkout.
An approved private document is excluded from the Moodle publication index.

Private graphics live in `assets/handouts/<CODE>/` in the private repository,
with the same manifests and asset requirements as public graphics. Keep the
entire manifest for that code there; it replaces the public asset set for that
code in private builds. Private proof records live under
`docs/publishing/proofs/` in the private repository.

## Pull requests and CI

Public pull requests always build with `--public`; they cannot obtain private
content or upload private proofs. To proof a public PR with private pages, use
**Build private binder → Run workflow** in the private repository and supply the
reviewed public commit SHA or `refs/pull/NUMBER/merge`. Review public build scripts
and dependency changes first: that code will run with private content. Private
repository pull requests also build the full binder. Proof artifacts remain in
the private repository and require its access permissions. No cross-repository
secret or access token is needed for the public repository.

The private workflow defaults to public `main`. For initial testing before the
architecture PR is merged, select its branch or commit as `public_ref`. Neither
repository automatically publishes a private binder to Moodle or a public PR.
The downloaded full binder itself contains sensitive information; distribute it
only to its intended readers.
