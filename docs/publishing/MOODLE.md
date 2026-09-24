# Moodle publishing handoff

GitHub is the editable source of record. Moodle at lhhfw.com is only the public delivery point. CI deliberately does **not** upload to Moodle, and no one should publish a draft or under-review file.

## Upload or replace an approved PDF

1. Confirm the merged source says `status: approved`, names both reviewers, and has current sources and `lastReviewed` date.
2. From the merged commit, run `npm ci` and `npm run build`, or download the workflow artifact for that exact commit.
3. Log into Moodle with authorized editor access and enable editing in the destination course/page.
4. Upload `docs/pdfs/CODE.pdf` to Moodle's file area. To replace a file, preserve the resident-facing filename or update every link; clear Moodle caches if the old file remains visible.
5. Copy the file's Moodle URL. In `docs/moodle-index.html`, replace the generated `PDF_URL/CODE.pdf` placeholder/link with that URL. The generated index lists **approved handouts only**.
6. Paste the index markup into Moodle's HTML/source editor (or reproduce its headings and links in Moodle's editor). Save without changing GitHub source content.
7. In a logged-out/private browser window, open the index and each PDF link. Confirm code, review date, page count, download behavior, and mobile readability.
8. Record the Moodle URL, Git commit, publisher, and publication date in the release or maintenance log used by the organization.

If the PDF changes, make the edit and approval in GitHub first, rebuild, then replace the Moodle copy. Do not edit the PDF or authoritative text only in Moodle.
