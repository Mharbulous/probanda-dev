---
name: e-file
description: >
  E-file a package through a court or tribunal's online filing portal, page by page, with the
  practitioner clicking every button that advances, agrees or submits. First venue: the BC Supreme
  Court through Court Services Online (CSO). Use when the practitioner asks to e-file, file through
  CSO or a court portal, or works the filing step of a set-down or filing job. Preparing the
  documents -> /draft and /publish. A date or deadline -> the docket-clerk agent. Filing the
  downloaded receipts -> /file-manager:housekeeping.
---

<!-- litigator v0.20.11 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| 1. Hard rules | Always, first |
| 2. Venue index | Choosing the portal's reference file |
| 3. Before the portal | Before opening the portal |
| 4. One page at a time | Every portal page |
| 5. Portal mechanics | Driving the browser |
| 6. Checking a portal's copy | The portal flattened or converted a document |
| 7. Receipt and after | The practitioner has submitted |
| 8. A venue with no reference file | No row in section 2 fits |

# E-file a package

The session fills each portal page and stops. The practitioner reviews it and clicks to advance. The practitioner signs every document and makes every submission.

## 1. Hard rules

- Never click Next, I Agree, Submit Original, or any final submit or pay button. Never sign anything, never enter or read credentials, and stop at the sign-in page until the practitioner says they are signed in.
- Save links that only add a row to the current page are allowed. They do not advance the page.
- No deadline arithmetic in this skill: every date, including the last day to file or serve, goes to the `lawyer:docket-clerk` agent (`shared/deadline-isolation.md`, "Calling docket-clerk").
- No statements of law. A rule is given only as its quoted text with its source. A question of what the law requires goes to `/legal-research`.
- Files are moved natively, never copied then deleted. Filing downloaded receipts goes through `/file-manager:housekeeping`, which only the practitioner can start.
- Internals stay confidential (`shared/internals-confidentiality.md`): the practitioner sees portal words and outcomes, never tool, agent or file-layout mechanics.
- No client or matter content is written anywhere outside the matter's own folders.
- The Chrome session is one lane. Never drive the portal while another browser agent, such as a Chrome-mode `law-getter` run, is running.

## 2. Venue index

Choose the row from the matter's forum, and read only that row's file.

| Country | Province or state | Venue | Portal | Reference file |
|---|---|---|---|---|
| CAN | BC | Supreme Court of British Columbia | Court Services Online | `references/CAN/BC/BCSC/cso.md` |

No row fits: section 8.

## 3. Before the portal

1. **The package.** Check it against the reference file's package checklist: each document present, in the matter's folder, in its final form. A missing or unfinished document stops the filing. Say which one.
2. **Signatures.** Render every document that must be signed and look at each signature line. A text check cannot see a signature. Confirm each statement names the right document. An unsigned document stops the filing until the practitioner supplies a signed copy.
3. **Preconditions.** Where the reference file lists conditions that must hold before filing, ask the practitioner to confirm each. A date in one goes to the docket-clerk agent, never counted here.
4. **Sign-in.** Open the portal's start page and stop. The practitioner signs in and says so.

## 4. One page at a time

1. Fill the whole page from the reference file and the package.
2. In one message, report what was entered and any open question.
3. Wait for the practitioner to say they clicked to advance. Then read the new page before filling it.

Leave the practitioner's own actions alone. If they have opened an edit or a dialog, ask before closing it. A portal message that refuses a page is reported in its own words, with the field it names.

## 5. Portal mechanics

- **Pop-ups are invisible to the browser extension.** Where a page opens a pop-up, open the pop-up's address in your own tab, work it there, close the tab, and type what it shows into the form. The reference file gives the address where it is known.
- **Find elements again after every Save or reload.** A reference from before the reload is stale.
- **Upload with the file-upload tool, never by clicking Choose File**, which opens a native dialog the extension cannot see. Large files take several seconds: wait, then confirm the new row appears before adding the next document.
- **An empty Save adds nothing.** A "required" message after a Save means the form was empty or the element was stale. Find it again and refill.

## 6. Checking a portal's copy

When a portal flattens or converts a document and asks the filer to confirm nothing was lost:

1. Download the portal's copy as the page offers it.
2. Compare it with the original by `/compare-documents`. Where that skill is not installed, compare deterministically first: page count, page size and rotation, each page's text, and each page's rendered image. Only pages that differ need a model's eyes.
3. Report to the practitioner which pages changed and how, and how many matched. They choose whether to accept the portal's copy or submit the original, and click it themselves.

## 7. Receipt and after

1. Note the package or submission number the receipt page shows.
2. Download each receipt and submission document the page offers, as the reference file lists them. They land in Downloads.
3. Tell the practitioner to run `/file-manager:housekeeping` on those downloads, which names and files them after their approval. Without the file-manager plugin, say the receipts stay in Downloads until moved, and move nothing.
4. Any follow-on date, such as a service or record deadline, goes to the docket-clerk agent.
5. Recording the filing on the Writing's Work Board stays with the `/draft` session working the job. This skill writes nothing to the matter's records.

## 8. A venue with no reference file

Run sections 1 and 3 to 7 against the live portal, reading each page as it comes. At the end, offer to send the portal's page sequence and quirks through `/lawyer:suggestion`, with no names, numbers or matter details, so a reference file can be added for the next filing.
