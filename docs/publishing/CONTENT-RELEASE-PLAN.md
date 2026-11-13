# Content completion and first release

Assessment date: 2026-11-13. This is an editorial work plan, not approval or permission to distribute emergency advice. GitHub remains the source of record; Moodle publication follows `MOODLE.md`.

## Current baseline

36 handouts, 156 handout pages: 27 draft, nine under review, none approved. Water, Food & Cooking; Home & Utilities; and Hazard Guides contain no handouts. Plans & Records contains a restricted-record placeholder, not an available household worksheet. The public checkout does not establish what exists in the private library.

## First batch prepared

| Code | Changes in this batch | Required next review |
|---|---|---|
| STH-001 | Direct path through alerts, reporting, evacuation, contacts, and supplies | Editor; emergency-preparedness reviewer; resident navigation check |
| COM-001 | Replaced sample layout and placeholder citation with sourced 911 reporting draft; removed diagram placeholder | Editor and local fire-service reviewer; verify reporting wording and accessibility |
| COM-003 | Added current City signup entry point and linked form evidence; removed unrelated expense caption and neighborhood-radio field | Editor and local emergency-management reviewer; test enrollment, confirmation, delivery options, and accessibility |
| COM-004 | Replaced placeholder directory with City/County entry points, offline backup, and action-first sequence | Editor and local emergency-management reviewer; verify source suitability and local backup options |
| EVS-001 | Clarified planning versus leaving-now navigation; linked alerts and specialized plans | Editor and evacuation/accessibility reviewer; resident checklist trial |
| STH-002 | Replaced references promising procedures in empty sections with existing handouts | Editor and preparedness reviewer |
| STH-007 | Distinguished six-month supply checks from annual binder review | Editor and preparedness reviewer |

Statuses and reviewer identities have not been changed to imply completed review. Updated `lastReviewed` dates record this draft assessment only. Existing source access dates remain unchanged unless actually inspected again.

## Source checks and limitations

Checked through web access on 2026-11-13:

- City [Contact](https://www.lhhcity.org/142/Contact) and [Your Fire Department](https://www.lhhcity.org/170/Your-Fire-Department) both identify 911 for emergencies.
- National 911 Program [Calling 911](https://www.911.gov/calling-911/), updated 2023-01-24, supports location, callback number, incident details, and call-taker instructions.
- City [Be Informed](https://www.lhhcity.org/478/Be-Informed) describes Everbridge and embeds a [City-branded Nixle form](https://local.nixle.com/signup/widget/i/9157). The older `/279/AlertLHH` address redirected to Be Informed. Older search excerpts retain text-keyword instructions; those were not carried into the draft.
- Ready LA County [Emergency Notifications](https://ready.lacounty.gov/emergency-notifications/) links city systems and explains County, WEA, EAS, and weather-radio options.
- Signup was inspected without submitting personal data. Enrollment, delivery, language choices, and accessibility have not been tested. Do not claim those tests passed.
- Ready.gov evacuation/alerts and FEMA WEA pages returned 403 during rechecking. Their existing citations were retained with original access dates; source freshness remains a reviewer task.

## First release checklist

Complete per handout, beginning with STH-001, COM-001/003/004, and EVS-001. Add EVS-002–005, STH-002/007, and COM-005 next. Include or clearly route readers to the relevant access, caregiver, and animal plans.

- [ ] Assign a named editor and a separate qualified subject-matter reviewer; record outcomes in the PR.
- [ ] Verify safety statements, local terms, official links, and agency responsibilities against current sources.
- [ ] Resolve local transport, pickup, route, shelter, and enrollment questions; do not promise unconfirmed services.
- [ ] Remove unresolved verification markers only when the underlying question has been resolved.
- [ ] Have residents complete the worksheets and find urgent actions without coaching; include access and language needs.
- [ ] Rebuild using the dependency-pinned Chrome; inspect every changed page in color and grayscale.
- [ ] Perform physical printer calibration and required duplex/punch-clearance checks; complete an exact-PDF proof record using `PROOF_RECORD_TEMPLATE.md`.
- [ ] Record both reviewers, sources, proofRecord, and review date; set approved only after the required reviews.
- [ ] Build from the merged source and publish approved PDFs using `MOODLE.md`; test links while logged out and on mobile.
- [ ] Record source commit, PDF checksum, publisher, Moodle URL, and publication date in the organization's release log.

No completed print proof, human signoff, enrollment confirmation, or Moodle publication is asserted by this checklist.

## Next content batches

Proposed identifiers are planning suggestions, not reserved codes. Check both authorized libraries before assigning them; never recycle a published code.

| Order | Proposed work | Scope and acceptance criteria | Reviewer expertise |
|---|---|---|---|
| 1 | WFC-001 Water storage | Household quantity worksheet, safe storage, rotation, animal/access needs; extend STH-002 rather than duplicate it | Public health / water utility |
| 1 | WFC-002 Drinking-water advisories | Distinguish boil, do-not-drink, and do-not-use instructions; source any treatment method and limitations; identify local provider | Public health / water utility |
| 1 | WFC-003 Food during outages | Before/during/after checklist; current official time/temperature thresholds and discard rules | Food-safety professional |
| 1 | WFC-004 Cooking during outages | No-cook options, approved outdoor equipment, fuel and carbon-monoxide boundaries | Fire service / public health |
| 2 | HUT-001 Power outage | Lighting, communications, medical-device/refrigeration planning, utility alerts, relocation triggers | Utility / clinician or equipment specialist |
| 2 | HUT-002 Utility hazards | Provider-specific boundaries and emergency contacts; cross-reference SKL-003's no-shutoff practice | Serving utilities / electrician / plumber |
| 2 | HUT-003 Backup power | Generator and battery distinctions; placement, charging, storage, and installation instructions tied to current official and manufacturer sources | Fire service / qualified electrician |
| 2 | HUT-004 Sanitation disruption | Water/sewer interruption planning, hygiene, waste handling, local restrictions | Public health / sanitation provider |
| 3 | HZD-001–004 Hazard guides | Wildfire, earthquake, extreme heat, flooding/debris flow; confirm local applicability; one or two action pages each with before/during/after and linked worksheets | Relevant local hazard specialists |
| 4 | PRP-002–005 Blank records | Household summary, medicine/equipment inventory, document checklist, drill log; reuse existing worksheets; decide public blank versus restricted completed copy | Editor / privacy and relevant subject reviewer |

Do not draft treatment doses, utility-operation instructions, generator distances, or local evacuation routes from memory. Research current authoritative sources first, record access dates, and keep new content draft pending review.

## Simplify existing material

| Topic | Document responsibilities | Acceptance criteria |
|---|---|---|
| Accessibility | STH-004 introduces planning; EVS-010 holds the detailed evacuation worksheet | Readers enter each key fact once and can carry a short support summary |
| Animals | STH-006 covers all-animal planning; EVS-006 coordinates children/animals; EVS-011 covers small-animal execution | Consistent supply periods, service-animal distinction, and links; livestock destination/transport gap assessed |
| Supplies | STH-002 covers home reserves; EVS-002 covers portable supplies | Clear separation of home stock and carryable load, consistent maintenance schedule |
| Information | COM-003 receives alerts; COM-004 finds official information; COM-007 checks uncertain claims | Protective actions precede optional cross-checking; official instructions distinct from neighborhood coordination |
| Skills | Longer instruction sheets plus short field summaries where needed | Essential warnings remain with each standalone summary; diagrams reviewed with the text |

## Specific reviewer questions

- SKL-001: establish whether “Mark Hughes” and “Mark J Hughes” represent distinct people before treating the metadata as two independent reviews.
- SKL-008: AI editorial/source-comparison labels do not establish the required accountable human reviews; assign qualified people before approval.
- COM-002/008/009: radio lead must verify current channel authorization, equipment suitability, settings, bandwidth, power, callsigns and net procedures; test on physical radios and record app/firmware versions.
- SKL-006/007: qualified CPR/AED and bleeding-control reviewers must inspect the full words and diagrams before release.
- Longer worksheets: test EVS-010 (10 pages), EVS-011 (8 pages), and SKL-001 (8 pages) for a short action summary while preserving detailed planning/training material.

## Maintenance

Recheck contacts and alert enrollment after changes; check supplies at least every six months and according to product/professional instructions; review the whole binder annually and after a move, drill, emergency, or change in household needs. Assign a maintenance owner at release; none is assigned by this document.

## Validation of this batch

The seven edited handouts passed the pinned-browser layout lint. The public binder build passed for all 36 handouts / 156 pages, including local links, image/font checks, printable geometry, and the visual fixture comparison at its existing 0.1% tolerance. The final `npm run check` passed after the Quick Start wording/formatting cleanup, confirming that the generated artifacts match the final sources. Screen proofs for all 18 edited handout pages were inspected. Physical grayscale, duplex, printer qualification, and punch-clearance outcomes remain unverified; no physical proof record was created.

### CI artifact refresh

The initial PR check on Ubuntu reported stale `SKL-001.pdf` and the combined binder despite byte-identical repeated local builds. Both PDFs were regenerated on the CI runner and committed. Decoded-object comparison found changes only in two embedded font programs: `head` creation/modification timestamps and associated checksums differed between the local and CI font builds. Glyph data, metrics, and page-content objects were unchanged. Builds on systems with different font metadata can reproduce this byte mismatch; the refreshed PDFs use CI output.

When the public freshness check fails, CI now keeps the failure but regenerates candidate artifacts for the proof upload and logs their binary deltas. A maintainer must review and commit them; CI does not auto-approve or auto-commit. Physical review requirements remain in force.
