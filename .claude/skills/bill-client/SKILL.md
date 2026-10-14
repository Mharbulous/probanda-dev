---
name: "bill-client"
disable-model-invocation: true
description: "Use when the user asks to \"bill a client\", \"run billing for [matter]\", or \"prep the bill\" for a BC litigation matter — walks through locating the last invoice, checking case-data, pulling unbilled TimeCamp time, cross-referencing phone call logs to catch missed billable time, and building a billing chart in Excel."
---

## Contents

| Section | Read when |
|---|---|
| Step 1 — Identify the matter and client number | Starting billing for a matter, first |
| Step 2 — Check housekeeping on "2. SOLICITOR CLIENT" before trusting file names | Before reading file names to find the last invoice |
| Step 3 — Find the most recently sent bill | Housekeeping is current and the last invoice must be located |
| Step 4 — Read the bill to find the exact last-billed date | Setting the start of the unbilled period |
| Step 5 — Cross-check against case-data / practice-data | Verifying the last invoice or recording invoices |
| Step 6 — Pull unbilled time from TimeCamp | Running or filtering the TimeCamp Detailed report export |
| Step 7 — File the export | Moving the downloaded export into the BILLING folder |
| Step 8 — Open and clean up the workbook | Opening the filed workbook, tying its Total row, tidying the table |
| Step 9 — Remove each person's near-zero days | Writing off a person's days under 0.1 hours |
| Step 9a — Cross-reference phone calls against the cleaned time data (optional deep-dive) | The practitioner wants phone time checked against TimeCamp |
| Step 10 — Build the pivot chart | Building or formatting the pivot chart |
| Step 11 — Refresh after any source-data edit | The source sheet changed after the chart was built |
| Step 12 — Save | Finishing the workbook |
| General technique notes (apply throughout) | Always, for the cross-step gotchas |

# /bill-client

End-to-end workflow for preparing the billing package for one litigation matter: find the last invoice, pull the unbilled TimeCamp time since then, cross-check it against the phone system to catch calls that TimeCamp missed, and turn it into a clean pivot-chart worksheet ready for the biller's review. Written from a walkthrough on a real matter (L8166); replace matter-specific details but keep the sequence and the gotchas below — several steps failed silently the first time and the fixes are load-bearing.

## Step 1 — Identify the matter and client number

Open the matter's workspace folder (e.g. `...\L8166 LindaleJ re Parental Loan`). The matter number is the leading token of the folder name (`L8166`). The client number is **not** derivable from the folder name — get it from case-data:

- Invoke the `case-data` skill's `profile` operation for the matter. It reports the client number, client name, matter number and short name.
- If the matter has never been initialized in case-data, the `case-data` skill's `initialize` operation will look up the client/matter via `practice-data` `matter-lookup` and seed it — do this before continuing.

## Step 2 — Check housekeeping on "2. SOLICITOR CLIENT" before trusting file names

Before reading file names to find the last invoice, confirm housekeeping has already been run on `2. SOLICITOR CLIENT`:

1. List files in that folder, compute SHA-256 hashes (`sha256sum` in bash works fine).
2. Invoke the `case-data` skill's housekeeping-log operation in `lookup` mode with the list of `{file_name, file_hash}` pairs.
3. If every non-conforming file already has a review row (matched by name or hash), housekeeping is up to date — no action needed.
4. If there are files that fail the naming grammar (`file-naming/scripts/name_gate.py`, against `file-naming/references/code-registry.md`) **and** are not yet in the review log, stop and ask the practitioner to run `/housekeeping` on that one folder, then continue once they confirm it is done. `/housekeeping` ships in the `file-admin` plugin: if it is not available in this session, say that naming those files needs `file-admin` (or the practitioner renaming them by hand), and stop. Do not skip this — file names are how the next step finds the invoice.

## Step 3 — Find the most recently sent bill

With housekeeping current, invoice files sort by name (`YYYY-MM-DD INV#nnnnn ... signed.pdf`). Pick the latest date. This is "the most recently sent bill."

## Step 4 — Read the bill to find the exact last-billed date

Read the invoice PDF. Look at the time-entry bar chart (or itemized list) and find the single latest date with a billed entry — **read the axis/labels precisely, do not eyeball or round to the invoice date.** The invoice date and the last billed date are often the same but are not guaranteed to be, and the whole downstream date-range filter depends on getting this exact.

Sanity-check: the last billed date should be on or before the invoice date. If it's after, something is wrong — recheck.

## Step 5 — Cross-check against case-data / practice-data

Invoke the `practice-data` skill's `invoice-data` operation for the matter number to see what practice-data thinks the last invoice date is.

- If it returns no rows and no import date, practice-data has never been populated for this matter — flag this to the user rather than silently trusting the PDF-derived date.
- If the practice-data invoices don't match what's on disk, **verify before recording anything**: open each candidate invoice PDF and confirm (a) it bears a lawyer's signature, and (b) the invoice number printed inside the document matches the invoice number in the file name. Never trust the file name alone for invoice number, date, or amount — read the PDF.
- Once verified, invoke the `practice-data` skill's `import-invoices` operation to record each invoice's matter number, invoice number, issue date, amount, amount paid and status. Leave amount paid and status blank unless the document itself gives positive evidence of what was actually paid — a static invoice PDF only proves the amount *billed*, not what happened to it afterward.

## Step 6 — Pull unbilled time from TimeCamp

1. Navigate to `https://app.timecamp.com/auth/login#/timesheets/timer`. **Do not attempt to log in on the user's behalf** — entering credentials is out of scope. Wait for the user to confirm they're logged in.
2. Navigate to `https://app.timecamp.com/app#/reports/projects_and_tasks/detailed` (or click "Detailed" in the left nav).
3. Open the **Projects** filter, click **Deselect all**, then search the matter number, confirm status is **Active**, check the one matching project, **Apply**.
4. Confirm/set: **People** = All users, **Active/archived** = Active tasks, **Invoiced status** = All, **Billable status** = Billable.
5. Set the **date range** to the day after the last-billed date (Step 4) through today.
   - **Do not type dates into the segmented From/To text fields** — typing digits and hyphens into those masked inputs reliably garbles the value (e.g. `2026-04-01` becomes `2604-01-01`). Use the calendar picker instead: click the back/forward month arrows to reach the target month, then click the day directly.
   - The end date is today unless the practitioner names another; note the one used.
6. **Read back every filter immediately before exporting — do not assume.** The Detailed report opens on whatever filters were last used, not the values above (it has opened on Billable status "All" and a stale range such as "Sep 11 - Jun 30, 2026"), and the URL never carries filter state, so the page's own labels are the only evidence. Open each dropdown and read its selected option (item 4's short names map to the full labels below):

   | Control | Expected |
   |---|---|
   | Projects | only the one matter project from item 3 |
   | People | All users |
   | Active/archived | Active tasks |
   | Invoiced status | All invoiced statuses |
   | Billable status | Billable time entries |
   | Date range label | day after the last-billed date through the end date, e.g. "May 23 - Sep 22, 2026" (year shown on the end date only); open the picker and read From/To if the label is ambiguous |

   The collapsed filter bar's wording for a correctly set Billable filter is unconfirmed, so read the expanded dropdown, not the collapsed label. Then note in your reply to the practitioner the read-back values and the page's total time for the view, in decimal hours (convert h:mm if shown that way: 53:45 = 53.75).
7. **Export → Download Excel (XLSX)**. If the practitioner runs the export in their own browser, they read the six values and the page total to you (or send screenshots of each expanded dropdown and the total) before you accept the file.
8. **Tie the file to the view.** When the workbook is first opened (Step 8), before any row is deleted, the trailing Total row on the "Time Tracking Report - decimal" sheet must equal the noted page total within ±0.01 h (±0.02 h if the page total was converted from h:mm, since a minute is 0.0167 h). Compare against that Total row, not the sum of the rows: each row is rounded to two decimals, so the row sum runs slightly low (L8145: rows 53.67 h, Total 53.75 h). The read-back proves the filters were right. The tie proves the file came from that view. Both are needed.
9. **On a mismatch, stop.** If a read-back value is wrong, set that control again and read back all six once more. If any is still wrong, do not export or go on to Step 7. If the Total row does not tie, stop before any cleanup in Step 8 and leave the filed workbook untouched in `BILLING`. Either way, report to the practitioner which value was wrong and what the page or file showed.

## Step 7 — File the export

*(No computer use? `request_cowork_directory` + `references/uno-gotchas.md` cover Steps 7–10.)*

The download lands in the user's Downloads folder, which is outside the reach of the Read/Write/Edit file tools — use computer-use (File Explorer) instead:

1. `request_access` to File Explorer.
2. Locate the newest `TimeCamp Time report.xlsx` in Downloads, rename it (F2) to `YYYY-MM-DD TimeCamp Time report re YYYY-MM-DD  to present.xlsx` (today's date, then the range start date).
3. Cut it (right-click → Cut, not Ctrl+X — more reliable to trigger via context menu).
4. **Navigate to the destination folder using the sidebar folder tree (click through), never by typing a path into the address bar after cutting.** The `type` action writes through the clipboard internally, which silently overwrites the cut file reference — the paste then does nothing and the mistake is easy to miss. If a path must be entered, do it *before* cutting, or use Back/sidebar navigation instead.
5. Paste (Ctrl+V) into the matter's draft folder's `BILLING` subfolder. Resolve the draft folder by glob (`0. DRAFT*`, case-insensitive, exactly one match, never create it — per the workspace output rule's bucket-1 rule, `.claude/skills/shared/workspace-output-rule.md`); create only the `BILLING` leaf if absent.

## Step 8 — Open and clean up the workbook

1. `request_access` to Excel, open the file.
   - **If the workbook is already open**, do NOT use `open_application`/`request_access` to "bring Excel forward" — on this environment that reliably launches a brand-new blank workbook (Book1, Book2, ...) instead of switching windows, and repeating it compounds the mess. Instead use the ribbon's **View → Switch Windows** (lists windows within the same Excel instance) or, if that only shows unrelated blank books, open the target file directly from File Explorer / the Recent list. Close stray blank books with Ctrl+W once identified — but see the caution below before pressing it.
   - **Ctrl+W closes the active window, not "the extra one."** If focus is ambiguous (this environment's screenshot-vs-actual-frontmost state can desync, showing "desktop shell is frontmost" errors), verify which workbook is actually focused before pressing Ctrl+W — it has closed the real billing workbook by mistake in testing. AutoSave (see below) is the safety net if this happens.
   - **Rely on AutoSave, not memory, to recover from a wrong-window mistake.** If the correct workbook gets closed accidentally, it is not lost — reopen it from its saved path (check the file's "Date modified" to confirm your edits persisted) rather than trying to reconstruct anything from scratch.
2. Go to the **"Time Tracking Report - decimal"** worksheet (the raw entry list, not the pre-formatted summary sheet). Run Step 6 item 8's Total-row tie now, before deleting anything.
3. Delete row 2 if it's a stray blank/Total row right under the header, and delete the trailing Total row at the very bottom of the data (Ctrl+End to find it) — these are junk rows from the export, not billing data. Delete the entire row (right-click row header → Delete), don't just clear contents.
4. Select the whole table: click any cell inside it, then **Ctrl+A** (selects the current region — more reliable here than Ctrl+Shift+End, which can leave the selection in an ambiguous state).
5. Turn on the filter (Data tab → Filter, or Ctrl+Shift+L).
6. Sort by the Day column, ascending.

## Step 9 — Remove each person's near-zero days

Firm policy: if a person's billable total for a day is under 0.1 hours, write off **that person's** rows for that day — judge each person separately, not the whole day. Several 0.08 entries by one person that sum past 0.1 stay in.

1. Add a helper column (e.g. right after the last data column) with `=SUMIFS($D$2:$D$<last>,$A$2:$A$<last>,A2,$U$2:$U$<last>,U2)` (Day in column A, Time in D; swap U for the real User column), filled down the full data range.
2. Re-select the full range including the helper column and re-apply the filter so the helper column gets its own dropdown.
3. On the helper column's filter, **Number Filters → Less Than → 0.1**.
4. **To delete only the filtered rows, do not select row headers by click + shift-click and hit Delete** — under an active filter that can select and delete the entire contiguous block, visible and hidden rows alike, silently wiping data that should have stayed (confirmed by testing: it deleted everything, and `Ctrl+End` jumping back to the header row is the tell). Instead:
   - Select the filtered range (e.g. `A2:H<last>`).
   - `F5` → **Special...** → **Visible cells only** → OK.
   - *Then* use **Home → Delete → Delete Sheet Rows** — do not right-click a row header: that collapses the multi-area selection to the one clicked row, deleting only it.
5. **Immediately after deleting**, the sheet will look blank — this is expected, not a bug: the filter criterion "< 0.1" now matches nothing (everything left is ≥ 0.1), so every remaining row is hidden. Clear the filter on the helper column to bring the data back.
6. Delete the helper column entirely once done.
7. If anything looks wrong after a delete (data missing, `Ctrl+End` lands somewhere unexpected), **`Ctrl+Z` immediately** before doing anything else.

## Step 9a — Cross-reference phone calls against the cleaned time data (optional deep-dive)

TimeCamp's automatic activity tracking regularly fails to recognize phone calls as billable client work, silently filing them as "Write-off / Non-billable" or dumping them into an unrelated catch-all task. When the practitioner wants confidence that no billable phone time was lost, cross-check the client's phone records against TimeCamp before charting.

### Find the client's phone number(s)

Get the client's name and phone number from case-data / the matter's intake documents (e.g. an Identification & Conflict Check Form in `2. SOLICITOR CLIENT`) — never guess or assume a number.

### Pull the call log — within the last 60 days

If the unbilled period starts >60 days back, do the archives section below first.

1. Navigate to `https://login-businessconnect.telus.com/`. **Do not log in on the user's behalf** — wait for the user to confirm they're authenticated.
2. **Switch to the practitioner's own line before searching.** The portal defaults to an account-wide "Call Queue Management" view, which does not show the practitioner's personal call log correctly. Click the dropdown next to the avatar (top right) and select **My Extension**.
3. Go to **Call Log** (Simple tab).
4. Set the date range to the widest preset available — **Last 60 days**. This is the portal's hard limit; it cannot look back further no matter what range is selected.
5. **Search by phone number, not by typed name — and set call direction explicitly.** Typing a full name (e.g. "Joe Lindale") into the search box can return nothing, because contacts may be saved under a shortened first name. Instead, click the two-people "contacts" icon next to the search bar, search the surname there, and select the matching contact — this both confirms the client's stored number and auto-populates the main search field with it. Then open the funnel/filter icon next to the date range and explicitly check **Call Direction: All** (or both Inbound and Outbound) — the default can silently exclude outbound calls the practitioner placed, making it look like the client never called when in fact only inbound calls were being shown.

### Pull the call log — beyond 60 days

TELUS also auto-delivers periodic call-log archives as zipped CSVs to a local synced folder (e.g. `...\ADMIN\BILLING\Telus`) — ask the practitioner for the path if not already connected, and request access via `request_cowork_directory`. Files are named like `<monYYYY-MM-DD>_<monYYYY-MM-DD> rcvd YYYY-MM-DD EF TELUS Business Connect™.zip`, delivered roughly monthly with overlapping date windows.

1. Identify and extract only the zip(s) covering the unbilled period (Step 4's last-billed date through today) — do not extract the entire historical archive. If Extract All fails silently, browse inside the zip — and close each zip window when done.
2. Each CSV has columns `Type, Direction, From, To, Extension, Forwarded To, Name, Date, Time, Action, Action Result, Result Description, Duration`. A single real call typically produces **two rows**: a per-extension "queue" record (blank `Type`) and a full `"Voice"`-typed record with accurate `From`/`To`. **Trust the `"Voice"`-typed row's `Direction` field as authoritative** — the queue-perspective row's `Direction` label does not reliably reflect who actually called whom.
3. Filter to real, answered calls: `Action Result` of `Accepted` or `Call connected`, and duration ≥ 30 seconds (shorter entries are misdials, ring-drops, or voicemail-only touches, not conversations).
4. Dedupe: the two rows per call will have near-identical start times and durations — group by date + start time rounded to the minute, keep the longer duration and the `"Voice"` row's direction.

### Match calls to TimeCamp entries and annotate

Work from the "Time Tracking Report - decimal" sheet built in Steps 6–9.

1. For each real call (date, start time, duration, direction), find TimeCamp rows for that day whose time window overlaps the call.
   - If one entry's span fully covers the call, that's a clean match.
   - If the call is longer than any single entry, multiple consecutive/overlapping entries may together account for it — annotate all of them, not just one.
2. In each matched row's **Notes** cell, write `Phone call from [Client Name]` for an inbound call or `Phone call to [Client Name]` for an outbound call — direction comes from the authoritative TELUS record, not a guess. When one entry covers more than one call (e.g. a broad block spanning two separate short calls), name each call's time in the note so it's unambiguous, e.g. `Phone calls from Joe Lindale (4:12 PM and 4:39 PM calls)`. **If a cell already has a note, append the new note to the end of the existing text rather than overwriting it.**
3. Save the workbook after each batch of edits.
4. Calls with **no** overlapping TimeCamp entry at all, or where only a small sliver of a long call is covered, are gaps — flag them to the practitioner as potentially unbilled time rather than fabricating an entry unprompted. Once approved, close them in TimeCamp (next section) — an Excel-only fix does not count.

### Close approved gaps directly in TimeCamp

Once the practitioner approves treating a gap as billable, fix it at the source — the live TimeCamp timesheet (`https://app.timecamp.com/auth/login#/timesheets/timer`), not just the Excel export — so the correction survives future exports:

1. Confirm the correct person is selected via the person-icon dropdown (top right of the Timesheet view) before editing anyone's day.
2. Navigate to the call's date (the calendar-icon dropdown next to the date heading supports jumping by month) and scroll to its time window.
3. Look for a nearby entry whose time span brackets the call. It is frequently logged generically as **"Write-off / Non-billable"**, or filed under an unrelated or uncategorized task (e.g. an entry named after a to-do like "Brahm to review") — TimeCamp's own automatic categorization is not reliable evidence of what the time actually was.
4. **Verify before touching anything.** Hover the row to reveal the **$** and **⋮** buttons; click **⋮ → Show computer activities**, and confirm an activity literally named `telus business connect` (a "TELUS Business Connect phone call/Phone") appears within that window. Only reclassify entries confirmed this way.
5. Click the entry's **Notes** field and type the same `Phone call from/to [Name]` note (append, don't overwrite, if the cell already has content).
6. Click the entry's **project name** (e.g. "Write-off") to open the project picker, and select the correct client matter — it typically appears as the top **suggested** result once the picker opens or once you start typing the matter number. This flips the entry from write-off/uncategorized to billable under the right matter.
7. **TELUS's own logs are the authoritative record of when a call happened and who was on it — reclassify accordingly even when TimeCamp had already filed that stretch of time under a different, seemingly legitimate task or a different client matter.** Don't assume TimeCamp's existing categorization is correct just because it names a real project.
8. If a single call spans multiple TimeCamp entries (the practitioner was multitasking, or the call ran longer than any one entry), repeat the note-and-reclassify on every overlapping entry, not just one.
9. If a call has genuinely **no** TimeCamp entry anywhere covering it, create a brand-new manual time entry for that window instead of reusing an unrelated one — ask the practitioner to walk through the exact "add time entry" UI steps if unfamiliar with it, and confirm the new entry's time window and matter before saving.
10. **Pause and ask the practitioner for direction whenever the right call is genuinely ambiguous** — e.g. two or more overlapping entries claiming the same window across different, genuinely distinct client matters — rather than guessing which one is "really" the phone call.

## Step 10 — Build the pivot chart

1. With the cleaned table selected (`Ctrl+A` inside it), Insert → PivotChart → New Worksheet. **Build a real PivotTable/PivotChart — never a formula-built chart styled to look like one.**
2. In the field list, check **Day**, **User**, and **Time**. Day/User land in Axis (Categories) by default, Time in Values.
3. Move **User** to the Legend (Series): right-click the field in the Axis (Categories) box → **Move to Legend Fields (Series)**.

### Formatting the chart

Office ribbon flyout menus (Add Chart Element → submenu items) and Format-pane radio buttons are unreliable to click on the first try in this environment — a click often "arms" the control without firing it. Expect to click the same spot twice. If a flyout item still won't register after two tries, fall back to a nearby working control (e.g. use the checkbox instead of the radio button, or drag the element manually instead of using the position gallery).

- **Legend position/overlap**: double-click the legend to open the **Format Legend** pane directly (more reliable than the ribbon). Uncheck **"Show the legend without overlapping the chart"** to let it sit inside the plot area, then drag the legend box to the desired position manually — grab from near the box's edge/border, not dead center, and drag using explicit `mouse_move` → `left_mouse_down` → `mouse_move` (intermediate step) → `left_mouse_up`, not a single click-drag action (single-shot drags were unreliable here; the multi-step version worked consistently).
- **Chart title**: Design → Add Chart Element → Chart Title → Above Chart, then double-click the title box, Ctrl+A, type the desired text (e.g. an invoice/bill placeholder like "This Bill" or "Bill No. ___" if the actual number isn't known yet). Drag it down to overlap the plot if an overlapping title was requested, same manual-drag technique as the legend.
- **Vertical axis title**: Design → Add Chart Element → Axis Titles → Primary Vertical, then double-click and retype (e.g. "Billable Hours").
- **Enlarging the chart**: maximize the Excel window first (more room to work with), then click an empty area inside the chart border to select the whole Chart Area (handles appear at all four corners/edges — if instead a sub-element like an axis or plot area got selected, click again slightly differently), and drag the bottom-right corner handle outward. Check that the title, axis title, legend, and every date label on the x-axis are still fully visible and not cropped — scroll down/right in the sheet to confirm the far edges of a large chart aren't cut off.
- **Mandatory final step:** apply "Positioning the chart title and legend" below before saving.

### Custom series colors by team member

If the user wants each person's time bars colored consistently (e.g. by role), apply a per-series fill color:

1. Click once on any bar of the target series to select **all** bars in that series (confirm via the formula bar — it shows a `SERIES(...)` formula naming that person, and every bar of theirs shows selection handles). A second click on an already-selected series drills into a single data point instead — if that happens, click empty chart space to deselect and start over with a fresh single click.
2. Right-click one of the selected bars → a mini toolbar with **Fill** appears alongside the context menu → **Fill** dropdown → **More Fill Colors... → Custom** tab → type the hex code directly into the **Hex** field (don't use the color wheel) → Tab to confirm the preview swatch matches → OK.
3. Repeat per series. Standing default colors for every pivot chart (no reconfirmation needed): the practitioner's own series `#4d8f85`, the firm's one other regular timekeeper, if any, `#ba802b`. For anyone else, ask the practitioner — names and colors are easy to transpose when told verbally, so read the mapping back before applying it.
4. **Double-clicking a bar in a PivotChart does not open Format Data Series** — it triggers a "Show Detail" drill-down dialog instead (a PivotChart-specific quirk that plain charts don't have). Use **single-click-to-select, then right-click → Fill dropdown** as described above, not double-click.

### Maximizing the plot area

By default the plot area (the axes/bars rectangle) sits well inside the chart's outer boundary, wasting space. To fill more of the chart:

1. Click once on empty space inside the plot area (between gridlines, not on a gridline itself, not on a bar) to select the **Plot Area** specifically — confirm via the pane header ("Format Plot Area") or Name Box.
2. Drag a corner handle toward the matching outer chart-area corner using the multi-step `mouse_move` → `left_mouse_down` → `mouse_move` (intermediate) → `mouse_move` (final) → `left_mouse_up` technique — a plain `left_click_drag` on a plot-area handle is unreliable here and has grabbed the whole Chart Area object instead, silently moving/relocating the entire chart rather than resizing the plot area. Verify after each drag (see next point) and `Ctrl+Z` immediately if the wrong thing moved.
3. Dragging one corner moves both adjacent edges (it's a rectangle) — e.g. dragging the top-right corner up-and-right raises the whole top edge *and* extends the whole right edge in one action. Use this to cover two sides per drag instead of four separate drags.
4. Leave headroom at the bottom for rotated x-axis date labels — don't drag the bottom edge down to the chart's outer edge, or the labels get cropped or squeezed against the field buttons below.
5. **If a PivotChart's field buttons (the "Sum of Time" / category-field dropdown buttons) are still shown, hide them first** (PivotChart Analyze tab → **Field Buttons** → toggles all off with one click). They visually overlap the plot-area corner and legend, and clicking there grabs the field button (opening its filter dropdown) instead of the chart element underneath — this cost multiple failed drag attempts before being hidden. Hiding them is also generally correct for a client-facing bill, which doesn't need interactive filter controls.

### Positioning the chart title and legend

The user's preferred placement algorithm — apply this whenever no other explicit instruction is given:

1. **Find the widest bar-free horizontal band.** Scan the category axis for the largest contiguous run of low bars (i.e., avoid tall spikes). Default target is the **horizontal center of the plot area**; if the center is blocked by a tall bar (or several), shift the whole title+legend block to whichever side — left or right — has the largest contiguous bar-free run. Don't assume a side; measure both and pick the wider one (by category count and/or by how low the bars stay), and defer to the practitioner's read of "biggest gap" if they state one explicitly.
2. **Stack title above legend, both horizontally centered on that gap's midpoint.**
3. **Title goes in the top band** — the horizontal strip between the axis maximum and the first gridline below it (e.g. between 7 and 6 on a 0–7 axis). **Legend goes in the second band** — between that gridline and the next one down (e.g. between 6 and 5). This keeps both elements clear of the plot's top border.
4. **No gridline may visibly cross any title or legend text.** After placing each element, deselect it and zoom into that region (screenshot + zoom, not just eyeballing the full-size screenshot) to confirm no line passes through the glyphs. If a line crosses text, nudge the element a few pixels vertically until the gridline falls in the whitespace between the title and legend, or between legend entries, rather than through a word.
5. **Selecting and moving the title is not the same gesture as the legend.** A single click on the chart title enters text-*edit* mode directly (cursor blinking inside the text) rather than object-select mode — dragging from there does nothing, and arrow keys move the text cursor, not the shape. Press **Escape once** after the click to drop into object-select mode (solid border, round handles, no blinking cursor) before dragging. The legend does not have this quirk — a single click selects it as a draggable object right away.
6. **Grab the legend/title body, not a resize handle, when moving it.** Clicking exactly on a corner or edge-midpoint circle resizes instead of moves (this stretched a legend into a wide two-column strip that then overlapped a tall bar, in testing). Grab from just inside the border, a few pixels in from any handle, and use the multi-step `mouse_move` → `left_mouse_down` → `mouse_move` (intermediate) → `mouse_move` (final) → `left_mouse_up` drag technique, same as elsewhere in this skill.
7. **After shrinking the whole chart (see "Enlarging the chart" / scale-down for proportion), the legend does not auto-shrink to fit and may show truncated text** (e.g. "Brahm…" cut off, other entries missing). Re-select the legend and drag its own corner handle outward until every entry's full name is visible before repositioning it.

## Step 11 — Refresh after any source-data edit

Any time the underlying "Time Tracking Report - decimal" sheet is edited (rows deleted, Notes added, project reclassified, etc.) after the pivot chart was built, go back to the chart sheet, click the chart, and hit **Refresh** (PivotChart Analyze/Design tab). The pivot table and chart pick up the new row count automatically — no need to manually reset the data source unless the column layout changed.

## Step 12 — Save

`Ctrl+S`. Confirm the file is saved with AutoSave/manual save before considering the task done. If AutoSave is on (check the toggle top-left of the Excel window), it is also your safety net — if a window gets closed by mistake mid-edit (see Step 8), the file's "Date modified" timestamp will confirm whether recent changes survived, and reopening it from its saved path recovers the work rather than losing it.

## General technique notes (apply throughout)

- **Date/segmented text fields**: prefer clicking calendar pickers over typing formatted date strings — masked inputs frequently garble typed dates.
- **File Explorer cut/paste**: never type an address-bar path between a Cut and a Paste — the `type` action goes through the clipboard and silently discards the cut file reference. Navigate via the sidebar tree or Back button instead.
- **Ribbon flyouts / Format-pane controls**: expect to need two clicks; if still unresponsive, find an alternate control (checkbox, direct object double-click, manual drag) rather than persisting with the same click.
- **Filtered-row deletion**: always use `Go To Special → Visible cells only` before deleting rows under an active filter. Verify with `Ctrl+End` afterward that only the intended rows are gone.
- **Never trust a file name for a legal/financial fact** (invoice number, amount, date) — confirm against the actual document content before recording anything to a database.
- **Switching to an already-open Excel workbook**: use the ribbon's View → Switch Windows, not `open_application`/`request_access` — the latter tends to spawn a new blank workbook instead of focusing the existing one, especially when multiple Excel windows/instances are already open.
- **Chart object drag reliability**: plain single-shot `left_click_drag` is inconsistent on chart sub-objects (plot area, legend, title) in this environment — it has resized instead of moved, or grabbed the wrong nested object. Prefer the explicit multi-step `mouse_move` → `left_mouse_down` → `mouse_move` (intermediate) → `mouse_move` (final) → `left_mouse_up` sequence for any chart-element drag, and always verify the result with a screenshot (zoom in on text elements specifically) before moving on. Keep `Ctrl+Z` handy — several of these drags grabbed the wrong element on the first attempt.
- **PivotChart field buttons intercept clicks** on nearby chart elements (they visually sit near/over the legend). Hide them (PivotChart Analyze → Field Buttons) before trying to select or drag the legend, to avoid repeatedly triggering their filter dropdown by accident.
- **TELUS Business Connect: account view vs. personal view.** The account-wide "Call Queue Management" view and an individual practitioner's "My Extension" view show different call logs. Switch to **My Extension** (avatar dropdown, top right) before searching a specific practitioner's own calls.
- **TELUS call-direction filter defaults can hide outbound calls.** Always open the funnel/filter icon and explicitly set Call Direction to **All** (or both Inbound and Outbound) — don't trust the unfiltered default view to show both directions.
- **TELUS web portal call log is capped at 60 days.** For anything older, use the periodically-delivered zipped CSV archives in the practitioner's synced local folder instead — extract only the zip(s) covering the needed date range, not the whole history.
- **TimeCamp's own project/task categorization is not authoritative for phone calls.** A call can be filed under "Write-off," an unrelated uncategorized task, or even a different real client matter, because TimeCamp's automatic activity matching doesn't recognize phone-system activity reliably. Confirm via "Show computer activities" on the entry (looking for a `telus business connect` activity) before reclassifying, but once confirmed, TELUS's own log is the authoritative source for what the time actually was — reclassify even over an existing, seemingly legitimate categorization.

