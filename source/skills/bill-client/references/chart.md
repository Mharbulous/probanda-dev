# The bill's chart

Read when: `/bill-client` Step 7 finds the last signed invoice has a chart, or the practitioner asks for one. Written from a walkthrough on a real matter. Several steps failed silently the first time, and the fixes below are why they are here.

## 1. Write the workbook

*(No computer use? `request_cowork_directory` + `references/build_chart.py` cover steps 2 and 3. Read `references/uno-gotchas.md` first.)*

Write the workbook from `invoice_lines.json` with the session's spreadsheet tooling (for example Python with openpyxl). Put one sheet, **"Time Tracking Report - decimal"**, with a header row and then one row per entry in the file's `rows`, in order:

| Column | Header | Value |
|---|---|---|
| A | Day | the row's `date`, as a date |
| B | User | the row's `user` |
| C | Time | the row's `hours`, as a number |

No Total row. Never write a figure into the workbook that is not from that file, so the chart shows what the invoice bills.

The workbook goes in the matter's draft folder's `BILLING` subfolder. Resolve the draft folder by glob (`0. DRAFT*`, case-insensitive, exactly one match, never create it — per the workspace output rule's bucket-1 rule, `source/skills/shared/workspace-output-rule.md`); create only the `BILLING` leaf if absent. Name the workbook `YYYY-MM-DD TimeCamp Time report re YYYY-MM-DD  to present.xlsx` (today's date, then the range start date). If a file of that name is already there, stop and ask the practitioner; never overwrite it.

## 2. Open and tidy the workbook

1. `request_access` to Excel, open the file.
   - **If the workbook is already open**, do NOT use `open_application`/`request_access` to "bring Excel forward" — on this environment that reliably launches a brand-new blank workbook (Book1, Book2, ...) instead of switching windows, and repeating it compounds the mess. Instead use the ribbon's **View → Switch Windows** (lists windows within the same Excel instance) or, if that only shows unrelated blank books, open the target file directly from File Explorer / the Recent list. Close stray blank books with Ctrl+W once identified — but see the caution below before pressing it.
   - **Ctrl+W closes the active window, not "the extra one."** If focus is ambiguous (this environment's screenshot-vs-actual-frontmost state can desync, showing "desktop shell is frontmost" errors), verify which workbook is actually focused before pressing Ctrl+W — it has closed the real billing workbook by mistake in testing. AutoSave (see below) is the safety net if this happens.
   - **Rely on AutoSave, not memory, to recover from a wrong-window mistake.** If the correct workbook gets closed accidentally, it is not lost — reopen it from its saved path (check the file's "Date modified" to confirm your edits persisted) rather than trying to reconstruct anything from scratch.
2. Go to the **"Time Tracking Report - decimal"** worksheet. **Tie the workbook to the file before changing anything:** the sum of the Time column (`=SUM(C:C)`) must equal the file's `rounded_hours`, and its row count must equal the number of `rows`. If either does not tie, stop, leave the workbook untouched in `BILLING`, and report both figures to the practitioner.
3. Select the whole table: click any cell inside it, then **Ctrl+A** (selects the current region — more reliable here than Ctrl+Shift+End, which can leave the selection in an ambiguous state).
4. Turn on the filter (Data tab → Filter, or Ctrl+Shift+L).
5. Sort by the Day column, ascending.

## 3. Build the pivot chart

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
3. Repeat per series. Each person's color is their roster key's entry in `colors.chart_series` in the `style` of `practice_data__firm_profile`, with no reconfirmation needed. For anyone with no entry, ask the practitioner — names and colors are easy to transpose when told verbally, so read the mapping back before applying it — and on their approval add it with `practice_data__upsert_firm_profile`, sending the whole `colors` object.
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

## 4. Refresh after any source-data edit

Any time the underlying "Time Tracking Report - decimal" sheet is edited (rows deleted, Notes added, project reclassified, etc.) after the pivot chart was built, go back to the chart sheet, click the chart, and hit **Refresh** (PivotChart Analyze/Design tab). The pivot table and chart pick up the new row count automatically — no need to manually reset the data source unless the column layout changed.

## 5. Save, and export the picture

`Ctrl+S`. Confirm the file is saved with AutoSave/manual save before considering the task done. If AutoSave is on (check the toggle top-left of the Excel window), it is also your safety net — if a window gets closed by mistake mid-edit (see step 2), the file's "Date modified" timestamp will confirm whether recent changes survived, and reopening it from its saved path recovers the work rather than losing it.

Then save the chart as a PNG (`build_chart.py` writes one itself; otherwise right-click the chart's border → **Save as Picture...**) in `<matter-data folder>\bill-client\`.

## General technique notes (apply throughout)

- **Date/segmented text fields**: prefer clicking calendar pickers over typing formatted date strings — masked inputs frequently garble typed dates.
- **File Explorer copy/paste**: never type an address-bar path between a Copy and a Paste — the `type` action goes through the clipboard and silently discards the copied file reference. Navigate via the sidebar tree or Back button instead.
- **Ribbon flyouts / Format-pane controls**: expect to need two clicks; if still unresponsive, find an alternate control (checkbox, direct object double-click, manual drag) rather than persisting with the same click.
- **Filtered-row deletion**: always use `Go To Special → Visible cells only` before deleting rows under an active filter. Verify with `Ctrl+End` afterward that only the intended rows are gone.
- **Switching to an already-open Excel workbook**: use the ribbon's View → Switch Windows, not `open_application`/`request_access` — the latter tends to spawn a new blank workbook instead of focusing the existing one, especially when multiple Excel windows/instances are already open.
- **Chart object drag reliability**: plain single-shot `left_click_drag` is inconsistent on chart sub-objects (plot area, legend, title) in this environment — it has resized instead of moved, or grabbed the wrong nested object. Prefer the explicit multi-step `mouse_move` → `left_mouse_down` → `mouse_move` (intermediate) → `mouse_move` (final) → `left_mouse_up` sequence for any chart-element drag, and always verify the result with a screenshot (zoom in on text elements specifically) before moving on. Keep `Ctrl+Z` handy — several of these drags grabbed the wrong element on the first attempt.
- **PivotChart field buttons intercept clicks** on nearby chart elements (they visually sit near/over the legend). Hide them (PivotChart Analyze → Field Buttons) before trying to select or drag the legend, to avoid repeatedly triggering their filter dropdown by accident.
