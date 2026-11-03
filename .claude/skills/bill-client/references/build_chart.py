#!/usr/bin/env python3
"""Build the bill's real PivotTable and chart in LibreOffice, with no screen.

    build_chart.py IN.xlsx OUT.xlsx --timekeeper "NAME=#RRGGBB" [--timekeeper "NAME=#RRGGBB" ...]
                   [--sheet NAME] [--title TEXT] [--axis-title TEXT]

IN.xlsx is the workbook chart.md section 1 writes: a data sheet with the headers Day, User and Time
in columns A to C and no Total row. It is never saved over. --timekeeper pairs a name with its bar
colour and must cover every User in the data.

Writes OUT.xlsx, and OUT.pdf beside it to check by eye, and nothing else. It refuses if either
already exists. The Y axis and the place for the title and legend are derived from the data.

Run it once, in one shell call, on a host with soffice and the Python uno module. On success it
prints one line with the rows and total hours, to tie to invoice_lines.json as chart.md section 2
says. Exit 0 on success, 1 on a refusal (the reason goes to stderr), 2 on bad arguments.
"""
import argparse
import itertools
import math
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

try:
    import uno
except ImportError:
    uno = None

DATA_SHEET = "Time Tracking Report - decimal"
DATA_HEADERS = ["Day", "User", "Time"]
PIVOT_SHEET = "Pivot Chart"
PIVOT_NAME = "BillPivot"
CHART_NAME = "BillChart"
DAY_FORMAT = "YYYY-MM-DD"
CONNECT_SECONDS = 60

# Lengths in 1/100 mm. This chart size keeps the chart on one PDF page.
CHART_X, CHART_WIDTH, CHART_HEIGHT = 500, 17000, 11000
PLOT_X, PLOT_Y, PLOT_WIDTH, PLOT_HEIGHT = 2000, 500, 14500, 8100
ROW_HEIGHT = 460
TITLE_CHAR_WIDTH, TITLE_HALF_HEIGHT = 200, 330
LEGEND_CHAR_WIDTH, LEGEND_ENTRY_WIDTH, LEGEND_HALF_HEIGHT = 170, 600, 280

MAX_START_BANDS = 9
EPSILON = 1e-9


class Refused(Exception):
    """A reason to stop before writing anything."""


def timekeeper(text):
    match = re.fullmatch(r"(.+)=#?([0-9a-fA-F]{6})", text)
    if not match:
        raise argparse.ArgumentTypeError(f"expected NAME=#RRGGBB, got {text!r}")
    return match.group(1), int(match.group(2), 16)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Build the bill's PivotTable and chart in LibreOffice.")
    parser.add_argument("input", type=Path, help="the workbook chart.md section 1 wrote")
    parser.add_argument("output", type=Path, help="the .xlsx to write, a name not yet taken")
    parser.add_argument("--timekeeper", type=timekeeper, action="append", required=True,
                        metavar="NAME=#RRGGBB", help="a timekeeper and their bar colour; repeat for each")
    parser.add_argument("--sheet", default=DATA_SHEET, help="the data sheet's name")
    parser.add_argument("--title", default="This Bill", help="the chart title")
    parser.add_argument("--axis-title", default="Billable Hours", help="the Y axis title")
    return parser.parse_args(argv)


def check_paths(source, output):
    """Refuse before LibreOffice starts: chart.md section 1 says never overwrite."""
    if not source.is_file():
        raise Refused(f"no workbook at {source}")
    if output.suffix.lower() != ".xlsx":
        raise Refused(f"the output must end in .xlsx: {output}")
    for path in (output, output.with_suffix(".pdf")):
        if path.exists():
            raise Refused(f"{path} already exists; choose another output name")


def nice_step(peak):
    """The smallest step of 1, 2 or 5 times a power of ten that spans peak in MAX_START_BANDS."""
    for exponent in itertools.count(-1):
        for multiple in (1, 2, 5):
            step = multiple * 10 ** exponent
            if math.ceil(peak / step - EPSILON) <= MAX_START_BANDS:
                return step


def widest_low_run(day_peaks, ceiling):
    """(first, last) index of the longest run of days at or under ceiling; None if no day is."""
    best = None
    start = None
    for index, peak in enumerate(day_peaks + [math.inf]):
        if peak <= ceiling:
            start = index if start is None else start
        elif start is not None:
            if best is None or index - start > best[1] - best[0] + 1:
                best = (start, index - 1)
            start = None
    return best


def scale_and_gap(day_peaks, block_width):
    """Return (step, bands, first, last) for the Y axis and the gap holding the title and legend.

    The title takes the top band and the legend the next (chart.md, "Positioning the chart title
    and legend"), so a day is low when its tallest bar stops below those two. The axis grows a band
    at a time until a run of low days is as wide as the title and legend block.
    """
    peak = max(day_peaks)
    if peak <= 0:
        raise Refused("the data has no hours to chart")
    needed = min(block_width, PLOT_WIDTH)
    step = nice_step(peak)
    bands = math.ceil(peak / step - EPSILON)
    while True:
        run = widest_low_run(day_peaks, (bands - 2) * step + EPSILON)
        if run and (run[1] - run[0] + 1) * PLOT_WIDTH / len(day_peaks) >= needed:
            return step, bands, run[0], run[1]
        bands += 1


def struct(type_name, **fields):
    value = uno.createUnoStruct(type_name)
    for name, field in fields.items():
        setattr(value, name, field)
    return value


def prop(name, value):
    return struct("com.sun.star.beans.PropertyValue", Name=name, Value=value)


def solid_fill():
    return uno.Enum("com.sun.star.drawing.FillStyle", "SOLID")


def insert_pivot(doc, sheet_name):
    """Add the pivot sheet at the front and return it, its output range and the source's row count."""
    sheets = doc.Sheets
    if not sheets.hasByName(sheet_name):
        raise Refused(f"the workbook has no sheet named {sheet_name!r}")
    if sheets.hasByName(PIVOT_SHEET):
        raise Refused(f"the workbook already has a {PIVOT_SHEET!r} sheet; build from the workbook without it")
    data = sheets.getByName(sheet_name)
    headers = [data.getCellByPosition(column, 0).getString() for column in range(len(DATA_HEADERS))]
    if headers != DATA_HEADERS:
        raise Refused(f"columns A to C of {sheet_name!r} must be headed {DATA_HEADERS}, found {headers}")
    cursor = data.createCursor()
    cursor.gotoEndOfUsedArea(False)
    last_row = cursor.RangeAddress.EndRow
    if last_row < 1:
        raise Refused(f"{sheet_name!r} has no rows under its headers")

    sheets.insertNewByName(PIVOT_SHEET, 0)
    pivot_sheet = sheets.getByName(PIVOT_SHEET)
    tables = pivot_sheet.getDataPilotTables()
    descriptor = tables.createDataPilotDescriptor()
    descriptor.setSourceRange(data.getCellRangeByPosition(0, 0, len(DATA_HEADERS) - 1, last_row).RangeAddress)
    orientation = lambda name: uno.Enum("com.sun.star.sheet.DataPilotFieldOrientation", name)
    fields = descriptor.getDataPilotFields()
    fields.getByIndex(0).Orientation = orientation("ROW")
    fields.getByIndex(1).Orientation = orientation("COLUMN")
    hours = fields.getByIndex(2)
    hours.Orientation = orientation("DATA")
    hours.Function = uno.Enum("com.sun.star.sheet.GeneralFunction", "SUM")
    descriptor.ShowFilterButton = False
    tables.insertNewByName(PIVOT_NAME, struct("com.sun.star.table.CellAddress", Sheet=0, Column=0, Row=0), descriptor)
    return pivot_sheet, tables.getByName(PIVOT_NAME).getOutputRange(), last_row


def format_days(doc, cells):
    locale = uno.createUnoStruct("com.sun.star.lang.Locale")
    key = doc.NumberFormats.queryKey(DAY_FORMAT, locale, False)
    cells.NumberFormat = key if key >= 0 else doc.NumberFormats.addNew(DAY_FORMAT, locale)


def add_chart(pivot_sheet, labels_range, names, colours, day_peaks, title, axis_title):
    """Add the one chart. A chart is never removed and re-added: that leaves two in the saved file."""
    rectangle = struct("com.sun.star.awt.Rectangle", X=CHART_X, Y=(labels_range.EndRow + 3) * ROW_HEIGHT,
                       Width=CHART_WIDTH, Height=CHART_HEIGHT)
    charts = pivot_sheet.getCharts()
    charts.addNewByName(CHART_NAME, rectangle, (labels_range,), True, True)
    chart = charts.getByName(CHART_NAME).getEmbeddedObject()
    chart.setDiagram(chart.createInstance("com.sun.star.chart.BarDiagram"))
    diagram = chart.getDiagram()
    diagram.Vertical = False  # False gives upright columns
    chart.HasMainTitle = True
    chart.getTitle().String = title
    diagram.HasYAxisTitle = True
    diagram.getYAxisTitle().String = axis_title
    chart.HasLegend = True

    # A date axis makes the bars hair-thin and spreads the chart over two pages.
    x_axis = chart.getFirstDiagram().getCoordinateSystems()[0].getAxisByDimension(0, 0)
    scale = x_axis.getScaleData()
    scale.AxisType = 2  # com.sun.star.chart2.AxisType.CATEGORY
    scale.AutoDateAxis = False
    x_axis.setScaleData(scale)

    title_width = len(title) * TITLE_CHAR_WIDTH
    legend_width = sum(len(name) * LEGEND_CHAR_WIDTH + LEGEND_ENTRY_WIDTH for name in names)
    step, bands, first, last = scale_and_gap(day_peaks, max(title_width, legend_width))
    y_axis = diagram.getYAxis()
    y_axis.AutoMin = False
    y_axis.Min = 0.0
    y_axis.AutoMax = False
    y_axis.Max = float(bands * step)
    y_axis.AutoStepMain = False
    y_axis.StepMain = float(step)

    wall = diagram.getWall()
    wall.FillStyle = solid_fill()
    wall.FillColor = 0xFFFFFF
    diagram.setDiagramPositionExcludingAxes(
        struct("com.sun.star.awt.Rectangle", X=PLOT_X, Y=PLOT_Y, Width=PLOT_WIDTH, Height=PLOT_HEIGHT))

    centre = PLOT_X + (first + last + 1) / 2 * PLOT_WIDTH / len(day_peaks)
    band = PLOT_HEIGHT / bands
    chart.getTitle().Position = struct("com.sun.star.awt.Point", X=int(centre - title_width / 2),
                                       Y=int(PLOT_Y + band * 0.5 - TITLE_HALF_HEIGHT))
    legend = chart.getLegend()
    legend.Expansion = uno.Enum("com.sun.star.chart.ChartLegendExpansion", "WIDE")
    legend.Position = struct("com.sun.star.awt.Point", X=int(centre - legend_width / 2),
                             Y=int(PLOT_Y + band * 1.5 - LEGEND_HALF_HEIGHT))

    for index, name in enumerate(names):
        series = diagram.getDataRowProperties(index)
        series.FillStyle = solid_fill()  # setting Color instead silently does nothing
        series.FillColor = colours[name]


def build(doc, args):
    """Build the pivot and chart in the open document. Return (rows, days, total hours)."""
    colours = dict(args.timekeeper)
    pivot_sheet, output, last_row = insert_pivot(doc, args.sheet)
    cell = pivot_sheet.getCellByPosition
    left, right = output.StartColumn, output.EndColumn  # the rightmost column holds each day's total
    header_row = next((row for row in range(output.StartRow, output.EndRow + 1)
                       if any(cell(column, row).getString() in colours for column in range(left, right + 1))), None)
    if header_row is None:
        raise Refused("no --timekeeper name appears in the data's User column")
    series_columns = range(left + 1, right)
    last_day_row = output.EndRow - 1  # the bottom row holds the grand total
    names = [cell(column, header_row).getString() for column in series_columns]
    unnamed = [name for name in names if name not in colours]
    if unnamed:
        raise Refused(f"no --timekeeper colour for {unnamed}")

    format_days(doc, pivot_sheet.getCellRangeByPosition(left, header_row + 1, left, last_day_row))
    day_peaks = [max(cell(column, row).getValue() for column in series_columns)
                 for row in range(header_row + 1, last_day_row + 1)]
    labels_range = struct("com.sun.star.table.CellRangeAddress", Sheet=0, StartColumn=left, EndColumn=series_columns[-1],
                          StartRow=header_row, EndRow=last_day_row)
    add_chart(pivot_sheet, labels_range, names, colours, day_peaks, args.title, args.axis_title)
    return last_row, len(day_peaks), cell(right, output.EndRow).getValue()


def free_port():
    with socket.socket() as probe:
        probe.bind(("localhost", 0))
        return probe.getsockname()[1]


def connect(port, office):
    """The desktop of the LibreOffice this script started. Its only process control is on that child."""
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    url = f"uno:socket,host=localhost,port={port};urp;StarOffice.ComponentContext"
    for _ in range(CONNECT_SECONDS):
        try:
            context = resolver.resolve(url)
        except Exception:  # NoConnectException until LibreOffice is listening; importing its class is not needed
            if office.poll() is not None:
                raise Refused(f"soffice exited with code {office.returncode} before accepting a connection")
            time.sleep(1)
        else:
            return context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
    raise Refused(f"soffice did not accept a connection within {CONNECT_SECONDS} seconds")


def run(args, soffice):
    """One LibreOffice session: open, build, save once, close. Return (rows, days, total hours)."""
    port = free_port()
    office = subprocess.Popen([soffice, "--headless", "--invisible", "--norestore",
                               f"--accept=socket,host=localhost,port={port};urp;"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    desktop = None
    try:
        desktop = connect(port, office)
        doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(str(args.input.resolve())), "_blank", 0,
                                           (prop("Hidden", True),))
        if doc is None:
            raise Refused(f"LibreOffice could not open {args.input}; a crashed run can leave a lock file "
                          f"beside it named .~lock.{args.input.name}# (see uno-gotchas.md)")
        try:
            result = build(doc, args)
            doc.storeToURL(uno.systemPathToFileUrl(str(args.output.resolve())),
                           (prop("FilterName", "Calc MS Excel 2007 XML"),))
            doc.storeToURL(uno.systemPathToFileUrl(str(args.output.with_suffix(".pdf").resolve())),
                           (prop("FilterName", "calc_pdf_Export"),))
        finally:
            doc.close(True)
        return result
    finally:
        if desktop is not None:
            try:
                desktop.terminate()
            except Exception:  # the bridge drops as LibreOffice quits, which is the wanted result
                pass
        try:
            office.wait(timeout=30)
        except subprocess.TimeoutExpired:
            office.kill()


def main(argv=None):
    args = parse_args(argv)
    try:
        check_paths(args.input, args.output)
        soffice = shutil.which("soffice")
        if uno is None or soffice is None:
            raise Refused("this host needs both soffice and the Python uno module")
        rows, days, hours = run(args, soffice)
    except Refused as reason:
        print(f"refused: {reason}", file=sys.stderr)
        return 1
    print(f"saved {args.output} and {args.output.with_suffix('.pdf').name}: {rows} rows, {days} days, {hours:.2f} hours")
    return 0


if __name__ == "__main__":
    sys.exit(main())
