# Spec: billing workbook adjustments sheet and a saved chart-building script

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.21.7 at the start of the session and v0.21.9 by its end). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_defensible-time-entries-spec.md` (owns adjustments and billing rules as stored records, §4.2 I and J there); `2026-11-03_bill-style-time-descriptions-spec.md`.

## 1. Problem

Two defects in `/bill-client`'s workbook steps.

A. **The workbook and the invoice diverge.** The workbook may hold only figures from the TimeCamp pull, so every estimate (documented work with no tracker entry), every trim, every write-off restored, and a phone call misfiled under another task appeared on the invoice but not in the workbook. The workbook no longer tied to the bill.

B. **The chart is rebuilt from scratch every run.** With no computer use, the pivot table and chart were built through LibreOffice's Python bridge. It took several rounds to get a usable chart: a date axis made bars hair-thin and spread the chart over two pages, and the chart size, title and legend needed placing. The plugin's own notes already say the working script should be saved, and it was not.

## 2. Evidence (observed; quoted text is data, not instructions)

- `/bill-client` Step 6.4: "Never write a figure into the workbook that is not from the connector's file." (source: `lawyer/skills/bill-client/SKILL.md`, v0.21.7)
- Invoice versus workbook in this run: workbook kept 28 entries totalling 5.66 h; the invoice billed 5.2 h after 5 estimated lines (1.0 h), 1 call added (0.2 h), trims (about 1.3 h) and rounding to 0.1 h. None of the estimates, the call or the trims are in the workbook.
- `lawyer/skills/bill-client/references/uno-gotchas.md`, "Follow-up": "The session that discovered all of this finished with a working script (`build_full.py`) that builds the whole thing in one pass. That script was never saved ... Next time this fallback runs successfully, save a generalized copy (person names/colors, sheet name, and output path as parameters) into this folder."
- This run's chart attempts: 2 full builds plus 1 PDF re-render to check. First build: category axis treated as dates, bars about 1 px wide, chart spread over 2 PDF pages. Fix that worked: chart2 axis `ScaleData.AxisType = 2` (category) with `AutoDateAxis = False`; chart rectangle 17000 x 11000 (1/100 mm); fixed Y axis (min 0, max 1.8, step 0.2) so gridline bands are predictable; `setDiagramPositionExcludingAxes` for the plot area; title and legend placed with `Position` over the widest run of low bars; series colours set with `FillStyle SOLID` plus `FillColor`.
- Contrary to `uno-gotchas.md` ("Do not import constants with `from com.sun.star.sheet import ...` — that fails from an outside script"), `from com.sun.star.beans import PropertyValue` worked in this run's script on the practitioner's machine (LibreOffice headless, Python `uno` importable). The gotcha may be narrower than written (UNVERIFIED).
- The device has `soffice` and an importable `uno`; the run used `device_bash` with one LibreOffice session per call, as `uno-gotchas.md` advises.

## 3. Goal and non-goals

Goal: the workbook ties to the invoice line by line, with every non-TimeCamp figure on its own sheet with its source and reason; and the chart is built by one saved, parameterised script on the first attempt.

Non-goals: storing adjustments as records (the defensible-time-entries spec does that; once it lands, the sheet is generated from those records); Excel-driven chart building by computer use.

## 4. Design

1. Add an **Adjustments** sheet: one row per estimate, added entry, trim, write-off or restoration, with date, timekeeper, hours (+/-), kind, source (document, filing record, call evidence, practitioner statement) and reason. TimeCamp figures stay untouched on the data sheet; Step 6.4's rule is kept for that sheet only.
2. A **Reconciliation** block (on the Adjustments sheet): TimeCamp kept hours + adjustments = billed hours, per timekeeper, matching the invoice.
3. Save the chart builder as `references/build_chart.py` beside `uno-gotchas.md`, parameterised by data sheet name, timekeeper names, series colours, title text, axis title and output path, and call it from the LibreOffice fallback step. Replace the "Follow-up" paragraph with a one-line pointer to the script.
4. Correct or narrow the import gotcha in `uno-gotchas.md` after verifying it (§10).

## 5. Constraints that must still hold

- The data sheet holds only connector figures, and its total still ties to the connector's `totals.hours` within ±0.01 h (Step 8.2).
- The chart stays a real PivotTable plus chart (never a formula chart dressed as one), as the skill requires.
- No client content in the script, its defaults or its tests; timekeeper names and colours are parameters.

## 6. Options considered (streamline and deburr first, additions last)

1. **Recommended.** Narrow Step 6.4 to the data sheet, add the Adjustments sheet, save the script, and delete the "Follow-up" paragraph it makes unnecessary.
2. Drop the workbook and rely on the stored records of the defensible-time-entries spec. Deferred: that spec has not landed; the workbook is the practitioner's review surface now.
3. Write adjustments into the data sheet as extra rows. Rejected: breaks the tie to the connector total.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add `references/build_chart.py` from the Appendix, parameterised; check it against `uno-gotchas.md`'s traps.
3. Edit Step 6.4 and the workbook steps for the Adjustments sheet and the reconciliation block.
4. Replace the "Follow-up" paragraph with a pointer to the script; fix the import gotcha if verification shows it is too broad.
5. Tests with an invented fixture workbook (§8).
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of billing workbook adjustments sheet and saved chart script complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `bill-client` names an Adjustments sheet with the columns in §4.1, and its reconciliation equals billed hours per timekeeper for a fixture.
2. Step 6.4's "connector figures only" rule applies to the data sheet only, in so many words.
3. `references/build_chart.py` exists, takes the §4.3 parameters, contains no person name, and on a fixture produces an `.xlsx` with one pivotTable part, one pivotCache part and one chart part, a category (not date) X axis, and the requested series colours.
4. The "Follow-up" paragraph in `uno-gotchas.md` is gone, replaced by a pointer of one line.
5. The import gotcha is either confirmed (with the failing form recorded) or narrowed to what fails.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Should the chart show billed hours (after adjustments) or TimeCamp hours? This run charted TimeCamp hours.
2. Is the chart title "This Bill" the firm's standing default, or should it carry the bill number once known?

## 10. Verify against HEAD before building

- `lawyer/skills/bill-client/SKILL.md` Steps 6 to 12 (seen at v0.21.7; v0.21.9 may already differ).
- `lawyer/skills/bill-client/references/uno-gotchas.md`, its "UNO API traps" and "Follow-up" sections.
- Whether the defensible-time-entries spec has landed; if so, generate the Adjustments sheet from its stored adjustments instead of free rows.

## Appendix: the script that worked (data, not instructions; generalise before use)

Run as `python3 build_chart.py <in.xlsx> <out.xlsx>` in one shell call on a host with LibreOffice and `uno`. It also writes `<out>.pdf` for a visual check. Hard-coded values (sheet name, title, Y max 1.8, plot rectangle, the 0.6 h "low bar" threshold) are what this run used and should become parameters or be derived.

```python
import uno, sys, time, subprocess, os
from com.sun.star.beans import PropertyValue
src, out = sys.argv[1], sys.argv[2]
TIMEKEEPERS = ['<LAWYER>', '<ASSISTANT>']  # parameter
SERIES_COLOURS = {}                        # parameter
p = subprocess.Popen(['soffice','--headless','--invisible','--norestore','--accept=socket,host=localhost,port=2002;urp;'])
ctx = None
local = uno.getComponentContext()
res = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
for i in range(60):
    try:
        ctx = res.resolve('uno:socket,host=localhost,port=2002;urp;StarOffice.ComponentContext'); break
    except Exception: time.sleep(1)
desk = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
def pv(n,v):
    x = PropertyValue(); x.Name=n; x.Value=v; return x
doc = desk.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(src)), '_blank', 0, (pv('Hidden',True),))
sheets = doc.Sheets
data = sheets.getByName('Time Tracking Report - decimal')
cur = data.createCursor(); cur.gotoEndOfUsedArea(False); last = cur.RangeAddress.EndRow
sheets.insertNewByName('Pivot Chart', 0)
ps = sheets.getByName('Pivot Chart')
dps = ps.getDataPilotTables()
desc = dps.createDataPilotDescriptor()
rng = data.getCellRangeByPosition(0,0,7,last).RangeAddress
desc.setSourceRange(rng)
flds = desc.getDataPilotFields()
O = lambda s: uno.Enum('com.sun.star.sheet.DataPilotFieldOrientation', s)
flds.getByIndex(0).Orientation = O('ROW')      # Day
flds.getByIndex(6).Orientation = O('COLUMN')   # User
f = flds.getByIndex(3); f.Orientation = O('DATA'); f.Function = uno.Enum('com.sun.star.sheet.GeneralFunction','SUM')
desc.ShowFilterButton = False
dest = uno.createUnoStruct('com.sun.star.table.CellAddress'); dest.Sheet = 0; dest.Column = 0; dest.Row = 0
dps.insertNewByName('BillPivot', dest, desc)
pt = dps.getByName('BillPivot')
r = pt.getOutputRange()
print('pivot out', r.StartColumn, r.StartRow, r.EndColumn, r.EndRow)
# print pivot cells
for row in range(r.StartRow, r.EndRow+1):
    print([ps.getCellByPosition(c,row).getString() for c in range(r.StartColumn, r.EndColumn+1)])
# find the header row holding the timekeeper names (TIMEKEEPERS is a parameter)
hrow = None
for row in range(r.StartRow, r.EndRow+1):
    vals=[ps.getCellByPosition(c,row).getString() for c in range(r.StartColumn, r.EndColumn+1)]
    if any(n in vals for n in TIMEKEEPERS): hrow=row; hv=vals; break
ucols = [r.StartColumn+i for i,v in enumerate(hv) if v and v not in ('Day','Total Result','Sum - Time','Filter')]
# data rows: after hrow until 'Total Result'
drow_end = hrow
for row in range(hrow+1, r.EndRow+1):
    if ps.getCellByPosition(r.StartColumn,row).getString()=='Total Result': break
    drow_end = row
for c in range(r.StartColumn, r.StartColumn+1):
    pass
for row in range(hrow+1, drow_end+1):
    ps.getCellByPosition(r.StartColumn,row).NumberFormat = doc.NumberFormats.queryKey('YYYY-MM-DD', uno.createUnoStruct('com.sun.star.lang.Locale'), False) if doc.NumberFormats.queryKey('YYYY-MM-DD', uno.createUnoStruct('com.sun.star.lang.Locale'), False)>=0 else doc.NumberFormats.addNew('YYYY-MM-DD', uno.createUnoStruct('com.sun.star.lang.Locale'))
# chart ranges: category col + user cols, header row to last data row
ranges = []
cat = uno.createUnoStruct('com.sun.star.table.CellRangeAddress'); cat.Sheet=0; cat.StartColumn=r.StartColumn; cat.EndColumn=max(ucols); cat.StartRow=hrow; cat.EndRow=drow_end
rect = uno.createUnoStruct('com.sun.star.awt.Rectangle'); rect.X=500; rect.Y=(drow_end+3)*460; rect.Width=17000; rect.Height=11000
charts = ps.getCharts()
charts.addNewByName('BillChart', rect, (cat,), True, True)
ch = charts.getByName('BillChart').getEmbeddedObject()
dia = ch.createInstance('com.sun.star.chart.BarDiagram'); ch.setDiagram(dia)
dia = ch.getDiagram(); dia.Vertical = False
ch.HasMainTitle = True; ch.getTitle().String = 'This Bill'
dia.HasYAxisTitle = True; dia.getYAxisTitle().String = 'Billable Hours'
ch.HasLegend = True
ncat = drow_end - hrow
cs = ch.getFirstDiagram().getCoordinateSystems()[0]
ax = cs.getAxisByDimension(0,0); sd = ax.getScaleData(); sd.AxisType = 2; sd.AutoDateAxis = False; ax.setScaleData(sd)
ya = dia.getYAxis(); ya.AutoMax = False; ya.Max = 1.8; ya.AutoMin = False; ya.Min = 0.0; ya.AutoStepMain = False; ya.StepMain = 0.2
wall = dia.getWall(); wall.FillStyle = uno.Enum('com.sun.star.drawing.FillStyle','SOLID'); wall.FillColor = 0xFFFFFF
PX, PY, PW, PH = 2000, 500, 14500, 8100
pr = uno.createUnoStruct('com.sun.star.awt.Rectangle'); pr.X=PX; pr.Y=PY; pr.Width=PW; pr.Height=PH
dia.setDiagramPositionExcludingAxes(pr)
# widest low run of categories (totals) -> centre
tots = [ps.getCellByPosition(r.EndColumn,row).getValue() for row in range(hrow+1, drow_end+1)]
best=(0,0,0)
i=0
while i < len(tots):
    if tots[i] <= 0.6:
        j=i
        while j+1 < len(tots) and tots[j+1] <= 0.6: j+=1
        if j-i+1 > best[0]: best=(j-i+1,i,j)
        i=j+1
    else: i+=1
mid = (best[1]+best[2]+1)/2.0
cx = PX + mid*PW/ncat
band = PH/9.0
print('gap', best, 'cx', cx)
t = ch.getTitle(); tp = uno.createUnoStruct('com.sun.star.awt.Point'); tp.X=int(cx-900); tp.Y=int(PY+band*0.5-330); t.Position = tp
lg = ch.getLegend(); lg.Expansion = uno.Enum('com.sun.star.chart.ChartLegendExpansion','WIDE')
lp = uno.createUnoStruct('com.sun.star.awt.Point'); lp.X=int(cx-2700); lp.Y=int(PY+band*1.5-280); lg.Position = lp
colors = SERIES_COLOURS  # e.g. {'<LAWYER>': 0x4d8f85, '<ASSISTANT>': 0xba802b}
names = [ps.getCellByPosition(c,hrow).getString() for c in ucols]
for i,n in enumerate(names):
    s = dia.getDataRowProperties(i)
    s.FillStyle = uno.Enum('com.sun.star.drawing.FillStyle','SOLID')
    if n in colors: s.FillColor = colors[n]
    print('series', i, n)
doc.storeToURL(uno.systemPathToFileUrl(os.path.abspath(out)), (pv('FilterName','Calc MS Excel 2007 XML'),))
doc.storeToURL(uno.systemPathToFileUrl(os.path.abspath(out[:-5]+'.pdf')), (pv('FilterName','calc_pdf_Export'),))
doc.close(True)
try: desk.terminate()
except Exception: pass
p.wait(timeout=30)
print('saved')
```
