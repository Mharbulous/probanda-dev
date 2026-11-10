# Time review page and growing candidate list

Decided by the practitioner on 2026-11-10, in an interview about improving `/bill-client`. This is a spec, not a plan: it states what to build and the decisions behind it, and leaves the build order to the plan. The current process is drawn in `docs/diagrams/Built/Client billing.html` (checked against `72c1eb07`).

## Why

The practitioner wants bills that are easier to defend and more transparent about how each line was reached, with less hand work on descriptions. The first step is the review interface. Time is reviewed in two chat conversations today: the day review (`/timecamping`, stage 3) and line vetting (`/vet-billable-time`, stage 4). Chat is a poor place to see screenshots and evidence, and the practitioner's feedback through a better interface will steer the other improvements.

Separately, every resume of a bill rebuilds the candidate-date list from scratch (`/bill-client` "The status": Steps 6 to 9 always re-run), which repeats the costliest search and throws away what earlier runs found. The rule's stated reason is about how the status is worded, not about trusting the saved list (commit `295116df`; `docs/Plans/2026-11-04_bill-client-rerun-audit.md`).

## Part 1: the time review page

### What it replaces

One page replaces both the day review and line vetting. Each time block is one card holding its matter, its invoice description, its duration and its evidence.

### How it is built

- A fixed HTML template, filled by the plugin's server from stored data. No model draws or lays out the page. It follows `shared/html-pages.md`: generated from the databases, presented as a file card, never read by a session, its buttons writing through the data server's localhost listener (built on `source/lawyer/mcp/src/local-page/`, as the `/housekeeping` approval page is).
- The page stays on the practitioner's PC (Commandment 3). It is never a hosted artifact.
- Its buttons work only while a session is open. During a review the session waits on the page, as `/housekeeping` does, and acts when a click needs it.

### Each card shows

- The client and matter (file number and client name).
- The invoice description.
- The start, end and duration.
- The evidence the AI had: the block's screenshots and the screenshot reader's report on each, plus the mail, calls, calendar entries, documents and other rows its evidence chain cites.
- Its state: flagged, approved, auto-assigned (never flagged), corrected, written off, merged or split.

### Navigation

- A date picker.
- A matter dropdown, all matters by default.
- Previous and Next, through blocks in time order within the filter.
- Next flagged: the next flagged block across all matters, or within the chosen matter.

Every block can be opened, flagged or not, so any line can be defended later.

### Actions, on every block

- **Approve.** Records the approval and clears the flag.
- **Correct.** Edit the matter (dropdown), the description and the start and end times. Saving clears the flag.
- **Write off.** Takes a short reason.
- **Split** at a chosen screenshot. The time from that screenshot on becomes a new block. The waiting session at once redrafts the matter and description of both halves from the evidence on file, including the saved screenshot readings, with no new look at any image. Both halves come back flagged.
- **Merge** adjacent blocks. A script joins their descriptions with "; ", with no model. The merged block is a new block. The originals are kept and marked "merged into" it.
- **Unmerge and unsplit,** until the time is on an issued invoice. Unmerge retires the merged block and shows the originals as they were. An unmerged or unsplit block comes back flagged, because the approval was for the other version. After issue, the issued-record lock already in place makes it final.

### What is flagged

A block is flagged when there is doubt about its matter, or about what goes on the bill:

- Matter: the cases where the day review holds a ceremony today (`/timecamping` Step 6 grid): the evidence does not name the matter, sources conflict with no covering presumption, the evidence is indirect only (a calendar entry, TimeCamp's own label), or an identifier-to-matter leap not yet covered by a presumption.
- What goes on the bill: the cases line vetting singles out today (`/vet-billable-time` Steps 5 and 6): a description resting on inference, a duration the evidence cannot bound, no evidence at all, staff time described by inference, a proposed write-off from a non-billable marker, an estimate for unlogged time, and a late line from a date the last bill missed or under-billed.

A block the AI assigned without doubt is not flagged and is shown as auto-assigned.

### When a day is clear

A day is clear once every flagged block on it, across all matters, is approved, corrected or written off. Approving a block never clears another.

### What a bill needs

Only flagged blocks need the practitioner's action before the bill is made. Unflagged blocks go onto the draft invoice as the AI described them. The draft still lists every line, and the lawyer's signature is the final approval.

### TimeCamp

- A change to a block's matter or description is written to TimeCamp at once, when the practitioner clicks Approve or Correct, by the waiting session through the `timecamp` connector's `update_entry`, and read back to confirm, as `/timecamping` Step 7 does today. The card shows "saved to TimeCamp" or the error.
- One text per block: the invoice description, in bill style (`/vet-billable-time` Step 5), is also the TimeCamp note.
- Exception: a staff entry's TimeCamp note is left as the staff member wrote it. Its invoice description lives only in Probanda.
- A merge or split changes Probanda's records only. No TimeCamp entry is deleted or combined by a merge.

### Change needed before split can work: save the screenshot readings

`/timecamping` Step 5 records only the ids of the captures `billing:screenshot-reader` viewed, not what it reported. Save each capture's reading (the reader's fixed-format line) in the time-review store with its capture id, so the page can show it and a later redraft can use it without another look at the image.

## Part 2: the candidate list grows across runs

- **What a resume searches.** Every source for the days after the list's last covered date, plus, for the whole period, each source listed under "Unexplored leads" or not reached last time. Saved dates are kept. A new date is added with the date it was found.
- **Where the list lives.** In the time-review database, one row per date: strength, Lawyer or Staff, flags, when found, and links to its evidence rows. The `YYYY-MM-DD Candidate dates` file in `BILLING` is generated from those rows for the practitioner to read. No run parses it back.
- **Changes in TimeCamp after a day is cleared.** When a day is cleared, save a fingerprint of its TimeCamp entries (each entry's id, start, end, task and note). On resume, compare each cleared day in the bill's period with its fingerprint. An entry added, removed or changed comes back flagged, and the day is no longer clear. The rest of the day keeps its approvals. This replaces the reviewed-day mark that never expires.
- **Lost saves.** On resume, check each listed date against its evidence rows. A date missing rows is searched again for that date alone, and the practitioner is told. Separately, find and fix the cause of the evidence save lost on 2026-11-04 (rerun audit).
- **The status wording stays.** A resume says the list was extended and what was added. It never calls Step 6 done, kept or saved (`/bill-client` "The status").

## Open points

- What the page does in Cowork, where screenshots can be read only on the PC.
- How the page gets the screenshot images: decrypted PNGs kept for the page, or decrypted when shown. Decrypted copies of screen captures are Client Information and stay on the PC.
- The table changes in the time-review store (a "merged into" or "split from" link, readings, fingerprints, candidate-date rows) must be checked against Commandment 5: no table, column or file per tag type or link role.
- How the page's records reach `/vet-billable-time`'s tie-out and `invoice_lines.json`, which today come from `vetted.json`.
- Not yet discussed: the practitioner's other aims, more automated descriptions and transparency beyond the page.
