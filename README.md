# La Habra Heights Fire Watch Emergency Preparedness Binder

GitHub is the editable source of record for print-ready US Letter handouts. Moodle at **lhhfw.com** is the resident-facing publication point. This repository does not update Moodle automatically.

> **Safety status:** The included demonstrations are **draft sample layouts**, not approved emergency advice. Bracketed local facts and source placeholders must be verified before approval or distribution.

## Repository layout

```text
assets/styles/           Shared print CSS
assets/handouts/<CODE>/  Handout graphics, editable sources, and asset manifests
templates/               Generated-page HTML shell
handouts/<section>/      Markdown source and YAML metadata
scripts/                 Build, validation, and preview tools
docs/pdfs/               Generated PDFs (including watermarked/status-marked drafts)
docs/previews/           Browser-rendered PNG proofs
docs/contributors/       Authoring and review instructions
docs/publishing/         Moodle and print handoff instructions
.github/                  Pull request template and CI workflow
BINDER_INDEX.md           Generated inventory and review status
```

The eight section folders are kept even when empty: Start Here; Alerts & Communication; Evacuation & Shelter; Water, Food & Cooking; Home & Utilities; Hands-On Skills; Hazard Guides; Plans & Records.

## Exact setup and build

Requirements: Node.js 20 or newer, npm, and the ability for Puppeteer to install its pinned Chrome for Testing revision during `npm ci`.

```bash
npm ci
npm run build
```

Installation automatically links a sibling `Emergency-Preparedness-Private` clone
when its `handouts/` directory exists. The link is saved locally and ignored by
Git; existing `BINDER_PRIVATE_DIR` settings are preserved. With a link, the editor
and builds include private pages by default. Use `npm run build:public` or
`npm run editor:public` for placeholders. If you clone the private repository later,
run `npm run setup:private` and restart the editor.

`npm run build` validates metadata and local links, creates each handout from `templates/handout.html` and `assets/styles/print.css`, and loads that file in the Chrome for Testing revision pinned by the exact `puppeteer` dependency. That single browser page produces both the US Letter PDF and its 816×1056 PNG proofs, so warnings, checklists, procedures, grids, diagrams, mirrored binding margins, and outside-edge strips do not pass through a second renderer. After the handouts, the build produces `docs/pdfs/TABLE_OF_CONTENTS.pdf`, listing every generated document and its binder page, then combines those contents pages and all handouts into `docs/pdfs/EMERGENCY_PREPAREDNESS_BINDER.pdf`. For every `.sheet`, the build measures every rendered element against the printable content box and rejects clipping, horizontal or vertical overflow, content outside that box, and footer collisions. Failures identify the handout, page, selector, element bounds, and limiting region in both the log and `build/diagnostics`. PDF counts come from parsing the document catalog's page tree rather than scanning PDF text. Generated browser HTML is temporary in `build/`; PDFs and proofs are versioned for review.

The build also renders `test/fixtures/components.html` twice: once with the live stylesheet and once with the reviewed `test/fixtures/baseline.css`. It compares the resulting RGBA page images with a per-channel threshold of `0.1`; at most `0.1%` of pixels may differ. On failure, actual, expected, and magenta diff images are written to `build/diagnostics` and uploaded by CI. After intentionally reviewing a shared-style change, refresh the frozen fixture stylesheet and rerun all checks with:

```bash
npm run test:visual:update
```

Commit the updated baseline stylesheet in the same pull request so its CSS diff makes the accepted visual change explicit.

For reproducibility, the renderer blocks HTTP(S) requests, decodes the repository's text-encoded fixed Binder Sans font assets, forces UTC and `en-US`, fixes the viewport and device scale, enables background graphics, and supplies explicit 8.5 × 11 inch PDF dimensions. Do not substitute a system browser or run `npm update` when producing committed artifacts; dependency and browser upgrades must update the package manifest and lockfile and regenerate all CI proof artifacts for review. Font binaries are stored as gzip-compressed Base64 text because this repository's pull-request path does not accept binary additions; the build decodes them only into the ignored `build/` directory.

To validate sources and confirm every tracked index and PDF is current without modifying the working tree:

```bash
npm run check
```

### Fast layout lint while editing

Use the browser-backed layout lint before the full build. It uses the same pinned
font, print media mode, and element geometry checks as `npm run build`, but skips
PDFs, preview images, approval records, and visual-regression comparison. It also
checks every handout before exiting, so one overflow does not hide problems in
later handouts:

```bash
npm run lint:layout
```

For the quickest edit/check cycle, pass one or more handout codes. Failures still
include the Markdown source line when available, and JSON plus screenshot
diagnostics are written under `build/diagnostics/`.

For a vertically overflowing page, the first diagnostic also identifies the
first authored block that crosses the footer or printable boundary. When that
block belongs to a headed section, it suggests the preceding heading as a
likely place to inspect for a page break. This is a diagnostic hint rather than
an automatic edit: keep related safety instructions together and review the
resulting proof after moving or shortening content.

```bash
npm run lint:layout -- COM-001
npm run lint:layout -- COM-001 EVS-001
```

## Preview one handout

Build first, then run:

```bash
npm run preview -- COM-001
```

Open the printed URL. For an immediate visual proof, open `docs/previews/COM-001-page-1.png`. Use the browser print dialog only for spot checks; committed PDFs are produced by the reproducible build.

## Local handout editor

Run `npm run editor`, then open **http://127.0.0.1:4174**. The server binds only
to the loopback interface and lists Markdown files discovered under `handouts/`. Select a handout and edit it in the visual, print-styled
editor beside the live preview. Toggle **Source** when you need direct access to
the canonical Markdown/HTML and YAML metadata. **Save** (or Ctrl/Cmd+S)
writes through a temporary file and rename. A save is refused if another program
changed the file since it was opened; use **Compare disk changes** to review
and merge, or **Revert** to load the disk version and discard local edits.
Unsaved edits are also kept as a per-handout browser draft, so an accidental
refresh or closed tab offers to restore the newer text without overwriting the
file on disk. The source status reports the cursor location, selection size,
word count, and character count. Tab and Shift+Tab indent or outdent every line
in a selection, and list or heading tools apply their prefix to every selected
line.

**Review changes** shows added and removed source lines since the last save,
with line numbers and optional unchanged context. Visual edits appear as their
canonical Markdown/HTML changes. **Compare with disk** reads the latest file into
a separate comparison: independent line edits are combined into a proposed text,
while overlapping edits require **Keep yours** or **Use disk** for each block.
You can inspect the last saved text for each overlap, then edit the full proposal
to combine details manually. Large, heavily changed sections are grouped into
conservative blocks. No merge markers are inserted into the handout.

**Apply merged text** updates the editor and its comparison baseline without
writing the file. **Save** checks the displayed disk revision again, so a second
external edit produces another conflict. **Use entire disk text** replaces only
the editor text and remains undoable; pending uploads are preserved. Closing the
comparison keeps the editor unchanged. Ordinary approval and validation checks
still apply when saving.

Public browser drafts now retain their last saved baseline. Restoring a draft
based on an older disk version offers comparison instead of silently treating the
current disk file as its baseline. Older drafts that lack baseline text require
an explicit whole-file choice followed by manual review. Private source, baseline,
and comparison text stay in memory and are never placed in browser draft storage.
Comparisons are cleared when their dialog closes, and a path that changes between
public and private libraries must be reopened before comparison or saving.

Editing can continue while a save finishes. Newer edits retain a browser draft
against the newly saved baseline, and a delayed save response does not replace a
different open handout. Simultaneous saves of the same revision are serialized;
one succeeds and the other must compare. Uploads that arrive during a save remain
pending for the next save.

**New handout** creates a saved draft from a basic, checklist, or step-by-step
layout. Enter a title, select a section and library, and confirm the draft's
assessment date. Codes are assigned sequentially within the section at creation;
existing files and asset directories are reserved. Templates use the shared print
components and contain verification prompts, rather than approved emergency advice.

**Duplicate** copies the saved handout into a new draft. It keeps the body and
source citations, copies images and their credits into an independent asset
manifest, and resets the version, reviewers, and proof record. Save or revert open
edits and pending uploads before creating or duplicating. Canceling the dialog
creates no files. Copies still require a fresh review and any applicable proof.

In the private editor, choose **Private library** to create a private handout.
Private copies remain private. The editor creates a matching generic public
placeholder and uses a generic filename so private titles, body text, image names,
and credits stay out of the public checkout. Both checkouts must be included in
the normal private/public review workflow. Public mode cannot duplicate a private
slot into a public document.

**Refresh list** discovers files added or changed on disk without restarting the
server. It preserves the open text, selection, unsaved browser draft, and pending
uploads; use **Revert** separately to replace open text with the disk version.
If a source or asset on disk is invalid, refresh reports the error and keeps the
previous library available. Correct that file before refreshing or creating a new
handout. If an open public file was removed, its buffer remains available in the
editor and its list entry is marked as removed. Existing revision checks continue
to prevent overwriting external edits.

The toolbar applies headings, emphasis, and lists directly in Visual mode.
Component wrappers, tables, and page breaks insert after the
selected paragraph or section, or at the end if nothing is selected. Click the
new component to edit its text. Select a table cell to enable **Add table row**
and **Add table column**; select a component to enable **Remove component**.
These controls keep you in Visual mode. In Source mode, insertion still uses
the text cursor. Visual page breaks also update an explicit `pageCount` assertion.
Visual edits retain the
YAML front matter and serialize the handout body as supported HTML. Preview rendering uses the same parser,
`templates/handout.html`, and `assets/styles/print.css` as the build. The editor
is a local authoring aid; generated PDFs still require `npm run build`.

The **Live print preview** starts at **Fit to width**, so the full page width remains
visible as the window or pane changes size. Choose **25%–200%** for a fixed zoom,
use **Previous**, **Next**, or the **Page** field to navigate, and drag the divider
to resize the editor and preview. The divider also supports Left/Right arrow keys,
Home/End for its limits, and double-click to reset the split. On smaller screens,
the panes stack and the divider is hidden.

**Preview only** expands the proof to use the full workspace; **Show editor** or
Escape returns to editing. The preview keeps the page and relative scroll position
when edits refresh it or zoom changes. Switching handouts starts at page one;
removing pages clamps the position to the remaining document. These controls affect
the on-screen preview only; PDF generation and layout validation use the original
print geometry. Choosing a source-only validation issue brings the editor back.

**Build PDF proof** generates a downloadable proof of the selected handout from
its current editor text and images, including unsaved edits and pending uploads.
Progress covers source checks, asset preparation, print layout, PDF generation,
and approval-record verification. Source/metadata, clipping, missing links,
low-resolution images, page-count, or embedded-font failures block the download;
accessibility warnings remain visible. Click a source-mapped finding to return to
the affected line. **Cancel build** stops an active job. Closing the dialog keeps
the build running so you can continue editing.

Proofs use the same pinned browser, fonts, PDF settings, timestamp normalization,
and single-handout print checks as the command-line renderer. Approved handouts must also pass the
existing proof-record and exact-checksum checks. Ready PDFs are kept in memory
for up to 15 minutes and are accessible only to the editor session that built them.
Private scratch files and browser profiles stay in the private checkout's
`build/editor/` area and are removed when the job finishes or is cancelled.

The proof button does not save source, commit pending uploads, update `docs/pdfs/`,
or publish anything. Editing the text or refreshing the library marks an existing
proof out of date and disables its download until you rebuild. Downloads are named
`<CODE>-proof.pdf`. The full binder, committed proofs, and release checks still use
`npm run build` and the normal review/publication workflow.

**Handout details** opens a form for the title, version, review date, reviewers,
and structured sources. Choose a source type to see the relevant fields; add or
remove sources as needed. **Check approval readiness** checks the form against
source approval requirements without changing status or saving. **Apply details**
updates the editing buffer; **Save** writes it to disk. Code, section, private
flags, proof records, and other metadata remain intact. Malformed YAML must first
be corrected in Source mode. The publishing build still verifies the proof record.

**Undo** and **Redo** share an in-memory history across Visual and Source mode,
including formatting, component, image, status, and details changes. Use
Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z or Ctrl+Y to redo. Nearby typing is grouped;
saving keeps the history. Opening another handout, reverting, permanently deleting
an asset, or discarding pending uploads resets it. History keeps the most recent
150 snapshots and does not persist across reloads; public browser draft recovery
continues to work separately. Pending uploads stay available when their insertion
is undone, until saved or explicitly discarded.

**Save & PR…** brings the Git workflow into the editor. Ordinary **Save** and
Ctrl/Cmd+S continue to save locally without committing or using GitHub.

1. Choose **Save & PR…**, enter a commit/PR title and optional notes, then choose
   **Save and review changes**. This saves through the existing validation and
   disk-conflict checks, verifies GitHub access, and prepares a saved snapshot.
2. Review the target repository, file list, summary, and source/manifest diff.
   Only this handout and its declared asset files are included; unrelated files
   and commits are excluded. Syntax/metadata errors must be corrected first.
3. Choose **Commit, push and create draft PR**. The editor creates its own branch,
   pushes it, and returns a GitHub link. Later uses update the same open PR. After
   that PR is merged, another change starts a new branch and PR.

The editor keeps your current checkout and staging intact. The saved working
files can therefore still appear modified relative to your checkout until it is
synchronized normally. You do not need to stage them separately for this workflow.
A failed push or PR request keeps completed local commits and remote pushes;
choose **Save and review changes** again to resume the same branch. The editor
never force-pushes. If someone changes the same handout/assets on the base branch
or changes the editor branch externally, sync and review those changes before
retrying. Git state is stored under `.git/handout-editor/`; an interrupted process
may leave `publish.lock` there, which can be removed once no publication is running.

One-time setup, if not already configured: install Git and the
[GitHub CLI](https://cli.github.com/), use a checkout with an `origin` on github.com,
and configure your author and GitHub access from that checkout:

```bash
git config user.name "Your Name"
git config user.email "you@example.org"
gh auth login --hostname github.com
gh auth setup-git --hostname github.com
```

The origin's fetch and push URLs must identify the same repository. Your account
needs write access. Private handouts use their separate private checkout and
require GitHub to confirm the target repository is private, including on retries.
A new private handout's public placeholder needs its own public-repository PR;
this action publishes only the selected library. Editor-created PRs start as
drafts; build artifacts, proof records, approval and publication remain part of
the normal review process. Git commit hooks are not run by this isolated-index
workflow; `commit.gpgsign` is honored when enabled. The editor does not store
GitHub credentials or browser copies of the publication diff. Prepared reviews
expire after ten minutes, and large changes above 30 MB / 150 files or a 150 KB
text diff require the normal Git workflow.

**Review dashboard** summarizes the saved files in the current library. Search by
code, title, section, or reviewer, and combine status, library, and section filters.
The summary buttons filter validation errors, missing or duplicate reviewers,
review reminders, and files needing checks. Needs attention also includes drafts,
under-review handouts, unreadable files, and invalid or future review dates.

Review reminders default to **12 calendar months** after `lastReviewed`; choose
3, 6, 12, or 24 months and an **As of** date to plan another review window. Month
ends clamp to the last real date (for example, February 29 becomes February 28
in the following year). A reminder becomes due on that date. This is a planning
rule, not an approval or publication policy, and does not modify metadata.

**Refresh saved data** rereads known files, including edits made outside the
editor. **Check all saved handouts** runs the existing saved-file syntax/layout
checks and shows findings with the check time. **Stop checks** stops after the
current handout; closing the dashboard also stops further checks. Concurrent
background checks of the same saved version share their result. Source changes
invalidate older results; recheck after external asset changes. **Refresh list**
is still needed to discover added or removed files. A passing check does not
certify approval or replace proof review.

The dashboard excludes unsaved text and pending uploads. **Open handout** uses
the editor's existing discard confirmation when switching documents; opening the
current handout returns to its buffer without discarding edits. Private metadata
is shown only when that private library is loaded. Dashboard rows, searches, and
check details stay in memory and clear when the dialog closes; public-only mode
shows public placeholders. The dashboard never saves files or changes workflow
status. It is also available through Commands by searching “review dashboard”.

**Link** inserts or edits a link from the current selection in Visual or Source
mode. In Visual, select text or place the cursor in a paragraph, then choose
**Link**; click an existing link to edit it without following its destination.
In Source, select plain text on one line, or put the cursor inside an HTML link.
Links use HTML anchors, matching the existing handout renderer. The same tool is
available through Commands by searching “link” or “hyperlink”.

Enter descriptive text and an address using HTTP/HTTPS, mailto:, tel:, #anchor,
or an explicit local path beginning with /, ./, or ../. The editor rejects
unsafe schemes and malformed addresses; it does not fetch destinations or verify
that they exist. Local paths are still checked by the publishing build. Changing
only an address preserves the link's formatted contents and unrelated attributes;
changing its text replaces formatting inside the link. Image links keep their
image while you change the address. **Remove link** keeps the contents and any
named anchor needed by cross-references. Each action shares Undo/Redo and requires
Save to persist. Closing the dialog leaves edits unchanged and clears its fields.
If the document or Visual render changes while the dialog is open, select the link
again before applying it. Private link text and addresses stay out of browser
draft storage, like other private edits.

**Commands** (Ctrl/Cmd+K) opens a searchable palette from Source, Visual, or the
print preview. Search by action or topic, such as “image”, “PDF”, “outline”,
“sources”, or “save”. Use Up/Down to choose an available action and Enter to run
it, or click a result. Disabled actions explain why they are unavailable. Escape
or Ctrl/Cmd+K closes the palette and restores the editor selection. Commands use
the existing controls, including their validation, confirmations, and Undo/Redo.
Place the cursor or select text in the editor before running a formatting command;
if the editor refreshes or the buffer changes while the palette is open, reopen
it before applying the action. Search terms clear when the palette closes and
are never stored in browser storage. Choose **Keyboard shortcuts and help** in
the palette for the full shortcut reference.

**Document outline** lists Markdown and standalone HTML headings from the current
buffer with page and source line numbers. Select a heading to navigate to it in
the current editor mode; unrendered changes fall back to Source. **Move up** and
**Move down** swap neighboring sibling sections on the same page. A section
includes its subheadings, text, components, and image references. **Duplicate
section** copies that section while reusing its existing assets. Nested HTML or
uncertain boundaries require structural edits in Source; sections with HTML IDs
must be copied there with unique IDs. Page breaks and front matter stay in place.
These changes share Undo/Redo and still need layout review and validation.

**Find / replace** (Ctrl/Cmd+F, including in Visual mode) searches literal source
text. It searches the handout body by default; **Include front matter** explicitly
includes metadata. Match case and Unicode whole-word options narrow results.
**Next match** / **Previous match** wrap and select the exact range in Source;
Enter / Shift+Enter in the Find field also navigate. **Replace match** replaces
the selected result, or selects a result first. **Replace all** confirms the count
and records one undoable change. Replacement text is literal, including dollar
signs. Searches are limited to 10,000 results, with bulk replacement disabled if
there are more. Search terms and replacement text stay in memory and clear when
switching handouts or libraries. Escape in the search panel closes it.

The header's **Status** menu updates the front matter to one of the three workflow
states: **Draft**, **Under review**, or **Approved**. Approval is not a validation
bypass: the handout must still name both reviewers, provide complete sources and
a proof record, and pass the approval-specific checks before it can be published.

To add an image in **Visual** mode, click a paragraph or section and choose
**Insert image**. Choose an existing thumbnail or upload/drop a PNG, JPEG, or SVG,
then insert before or after that section (or at the end of the handout). Click an
image directly to open **Edit image**. The size slider, full/half-width presets,
alignment, crop ratio, and crop focus show a live preview and load the image’s
current settings. Choose another thumbnail or **Upload and replace** to replace
that occurrence while keeping its size and placement. **Apply changes** preserves
authored captions and credits. **Insert another image** adds a separate occurrence.
These tools stay in Visual mode; Source mode also supports images at the cursor.
Cropping changes CSS positioning without altering the original file. Uploads
record required alternative text and creator/source/license metadata, and remain
pending until **Save**. **Remove from page** keeps the asset available. Permanent
deletion is under **Manage assets** and allowed only after every reference has been
removed and the handout saved. New uploads are stored as GitHub-safe Base64 text
files (such as `photo.jpg.base64`) while manifests and handouts continue to use
the ordinary `photo.jpg` name; builds decode them automatically. This avoids
binary-file upload restrictions and unsafe-SVG attachment handling. See the
[graphics and assets guide](docs/contributors/ASSETS.md#github-compatible-storage).

## Source choice

Handout prose uses **Markdown with YAML front matter** because it is readable in pull-request diffs and approachable for volunteers. Small, documented HTML classes provide print-specific patterns that Markdown alone cannot express reliably. A pinned Puppeteer/Chrome build applies one shared HTML shell and CSS, so volunteers do not hand-edit repeated headers, footers, page numbers, or edge labels. This is slightly more tooling than standalone HTML, but prevents layout drift and makes page-count/overflow checks practical.

## Review and publication

1. Edit one Markdown source and keep its status `draft`.
2. Open a pull request; CI builds proof artifacts but never publishes them.
3. An editor reviews clarity, accessibility, citations, and layout.
4. An appropriate subject-matter reviewer verifies safety guidance and local facts.
5. Record both reviewers, the review date, and sources; change status to `approved` only after both reviews.
6. Rebuild, inspect every proof, merge, then follow the [Moodle handoff](docs/publishing/MOODLE.md).

See [contributor guidance](docs/contributors/CONTRIBUTING.md), the [graphics and assets guide](docs/contributors/ASSETS.md), [metadata reference](docs/contributors/METADATA.md), the [binder index](BINDER_INDEX.md), and [duplex proof instructions](docs/publishing/PRINTING.md).

## Private pages

See [private binder setup](docs/contributors/PRIVATE-CONTENT.md) for authenticated
builds, matching public placeholder pages, and private pull-request proofs.

For private content in the editor, start with `npm run editor:private` after
installation links the sibling private repository. For a custom location, set
`BINDER_PRIVATE_DIR` instead.
Private page saves go to that private checkout. See [private editor setup](docs/contributors/PRIVATE-CONTENT.md#view-and-edit-private-pages).
