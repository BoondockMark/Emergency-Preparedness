# La Habra Heights Fire Watch Emergency Preparedness Binder

This repository contains the public handouts, graphics, review records, binder
configuration, and generated publication artifacts. The reusable editor and PDF
build tools now live in **BinderPress**, a separate application repository.
Moodle at **lhhfw.com** remains the resident-facing publication point. This
repository does not update Moodle automatically.

> Draft/sample content is not approved emergency advice. Verify local facts,
> sources, and proofs through the established review process before distribution.

## Setup

Requires Node.js 22.12 or newer, npm, and Git. From this content checkout, run:

```sh
npm ci
npm run editor
```

Open http://127.0.0.1:4174. Installation supplies the tested
[BinderPress application](https://github.com/BoondockMark/BinderPress), installed from its HTTPS source archive and pinned to
full commit `048c82db8ce9d2c132a13266b2a01803cba4f6a7`, and downloads its
lockfile-selected Chrome for Testing revision. No sibling application checkout
is required. Do not run `npm update` when generating reviewed proofs.

## Work on content

```sh
npm test
npm run lint:layout -- COM-001
npm run build:public
npm run check -- --public
npm run preview -- COM-001
```

`build` produces per-handout PDFs, a table of contents, the combined binder, PNG
proofs, and indexes. `check` verifies committed PDFs and indexes without changing
them. Layout, approval, proof-record, private-content, and visual-regression
checks are supplied by the pinned application.

The configuration in `binderpress.config.json` preserves our existing title,
branding, eight sections, codes, folders, Moodle index class, private sibling
name, and complete-binder filename. Keep published codes and section order stable.

## Repository layout

```text
binderpress.config.json   Binder identity and ordered sections
handouts/<section>/       Markdown sources and YAML metadata
assets/handouts/<CODE>/   Authored graphics and manifests
docs/pdfs/               Generated PDFs
docs/previews/           Generated page proofs
docs/contributors/       Local authoring and review policies
docs/publishing/         Physical proof and Moodle handoff instructions
test/                    Content-specific integration checks
BINDER_INDEX.md          Generated inventory and review status
```

Print CSS, fonts, templates, the editor, build scripts, component design fixtures,
and application tests belong to BinderPress. Its [README](https://github.com/BoondockMark/BinderPress) and
[editor guide](https://github.com/BoondockMark/BinderPress/blob/main/docs/EDITOR.md) document the visual editor, source editing, images, conflict handling, review
dashboard, PDF proofs, and Save & PR.

## Private pages

Installation links a sibling `Emergency-Preparedness-Private` checkout when it
exists. If you clone it later, run `npm run setup:private` and restart the editor.
Set `BINDER_PRIVATE_DIR` for a custom location. Existing local links are preserved.

Linked private pages are included by default. Use `npm run editor:public` or
`npm run build:public` to select public placeholders. `editor:private` and
`build:private` require private content. Private files and build outputs stay in
the private checkout. Never commit `.binder-local.json`.

See [private-content guidance](docs/contributors/PRIVATE-CONTENT.md).

## Review and publication

1. Edit content while keeping its status `draft`.
2. Build and review the PDF and page proofs in a pull request.
3. Obtain distinct editorial and subject-matter reviews and verify local facts.
4. Record reviewers, sources, review date, and required physical proof.
5. Set `approved` only after review, rebuild, and follow the manual Moodle handoff.

See [contributor guidance](docs/contributors/CONTRIBUTING.md),
[graphics and assets](docs/contributors/ASSETS.md),
[metadata](docs/contributors/METADATA.md), [binder index](BINDER_INDEX.md),
[printing](docs/publishing/PRINTING.md), and [Moodle handoff](docs/publishing/MOODLE.md).

## Application migration

The extraction preserves the current upstream cross-platform and system-font
fixes. Local migration verification compares fresh builds from upstream and the
extracted application on the same machine. Content and publication artifacts
are retained unchanged. The Linux CI build remains the release-artifact
environment; Windows builds validate layout without comparing PDF bytes across
systems. See the [content release plan](docs/publishing/CONTENT-RELEASE-PLAN.md)
for publication work.

Application development and shared-style baseline updates now happen in the
BinderPress repository. Validate any application upgrade against this binder
before accepting new artifacts.
