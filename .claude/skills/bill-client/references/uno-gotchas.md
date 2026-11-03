# Building the billing chart without Excel (LibreOffice fallback)

Use this when the user declines the computer-use prompt, so Excel and File
Explorer are off the table. The sandbox already has LibreOffice and its
Python bridge (the `uno` module), and together they can build a genuine
PivotTable and PivotChart with no screen at all. A real session did this
end to end on 2026-08-31 (E2E report `2026-08-31-1446 bill-client-e2e-test.md`).
Every trap below cost that session real time — read this before writing
any script.

Why this matters: the practitioner's standing instruction is to always
build a real PivotTable/PivotChart. A sheet of formulas with an ordinary
chart on top can look identical, but right-click Refresh does nothing,
and people who trust the formatting feel misled when they find out.

## Getting the exported file

- Ask for the Downloads folder with `request_cowork_directory`. This is a
  lighter permission than full computer use, and users who declined the
  big prompt have granted it.
- Do not try to pull the download out of the browser with a `fetch()`
  call — the tool blocks base64-encoded response bodies, so the file can
  never come back through that channel.

## Working in a mounted matter folder

- A mounted (cloud-synced) matter folder may let you create new files
  but refuse to overwrite or delete any file. If a save fails with
  "Permission denied", save under a new filename instead, and tell the
  user why the folder now has two versions.

## Running LibreOffice headless

- **Never run `pkill -f soffice`.** The sandbox wraps every bash call in
  a process whose own command line contains your full script text
  (inside an encoded proxy variable) — including the word "soffice".
  `pkill -f` matches on the full command line, so it kills the wrapper,
  which kills your own call before it prints anything. The symptom is
  exit code 143 with zero output.
- **Do everything in one script, in one bash call, with one LibreOffice
  session.** Open the workbook, build the pivot table, read its output
  range while the document is still open, add the chart, set the colors,
  save once, then close. LibreOffice quits on its own when the last
  document closes, so a second script in a later bash call will find
  nothing to connect to.
- If a run crashes, it can leave a lock file next to the workbook, named
  like `.~lock.<filename>#`. While it exists, opening the file returns
  `None` instead of a document (the next line then fails with a
  confusing `NoneType` error). Delete the lock file and rerun.

## UNO API traps

- `from com.sun.star.sheet import DataPilotFieldOrientation` fails from an
  outside script: an enum type cannot be imported by name. Its values and
  structs can (`from com.sun.star.sheet.DataPilotFieldOrientation import ROW`,
  `from com.sun.star.beans import PropertyValue`). `build_chart.py` needs no
  such import: it uses
  `uno.Enum("com.sun.star.sheet.DataPilotFieldOrientation", "ROW")` and
  `uno.createUnoStruct(...)`.
- To color a chart series, set `FillStyle` to
  `uno.Enum("com.sun.star.drawing.FillStyle", "SOLID")` and `FillColor`
  to the color integer. Setting `Color` silently does nothing.
- On a bar diagram, `Vertical = False` gives the normal upright column
  chart. `Vertical = True` gives sideways bars — the opposite of what
  the name suggests. Check the result by converting to PDF
  (`soffice --convert-to pdf`) and reading it back.
- Do not remove and re-add a chart in place. Removing a chart from the
  live collection can leave the old chart part inside the saved file,
  so the next save holds two charts stacked on top of each other.
  Rebuild the chart sheet from a fresh copy of the pre-pivot workbook
  instead.

## Checking the result

Unzip the finished `.xlsx` and confirm it contains real pivot parts — a
pivotTables XML part, a pivotCache XML part, and exactly one chart XML
part inside the archive's internal "xl" folder — plus the right fill
colors inside that chart's XML.

One caveat to pass on to the practitioner: LibreOffice does not write
the internal link that ties the chart itself to the pivot table
(`c:pivotSource`), so in Excel, Refresh works on the pivot table's
cells but may not appear on the chart's own right-click menu.

## The script

`build_chart.py`, beside this file, builds the pivot and chart in one call; its docstring gives the command.
