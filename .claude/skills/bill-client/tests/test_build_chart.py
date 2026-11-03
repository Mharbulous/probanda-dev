"""build_chart.py on invented data. Arguments, refusals and axis derivation run anywhere; the build needs soffice and uno."""
import contextlib
import datetime
import hashlib
import importlib.util
import io
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "references"))
import build_chart  # noqa: E402

SCRIPT = Path(build_chart.__file__)
TIMEKEEPERS = ["--timekeeper", "Lee Lawyer=#112233", "--timekeeper", "Sam Assistant=#aabbcc"]
# Fixed wording in the script that reads like a name but is not one.
NOT_NAMES = {"This Bill", "Billable Hours", "Time Tracking", "Pivot Chart"}
BUILD_NEEDS = [need for need, present in (("uno", build_chart.uno), ("soffice", shutil.which("soffice")),
                                          ("openpyxl", importlib.util.find_spec("openpyxl"))) if not present]


def quietly(function, *args):
    with contextlib.redirect_stderr(io.StringIO()) as stderr:
        return function(*args), stderr.getvalue()


class Arguments(unittest.TestCase):
    def test_defaults(self):
        args = build_chart.parse_args(["in.xlsx", "out.xlsx", *TIMEKEEPERS])
        self.assertEqual(args.sheet, "Time Tracking Report - decimal")
        self.assertEqual(args.title, "This Bill")
        self.assertEqual(args.axis_title, "Billable Hours")
        self.assertEqual(args.timekeeper, [("Lee Lawyer", 0x112233), ("Sam Assistant", 0xAABBCC)])

    def test_every_parameter_can_be_set(self):
        args = build_chart.parse_args(["in.xlsx", "out.xlsx", "--timekeeper", "A=000001", "--sheet", "S",
                                       "--title", "T", "--axis-title", "H"])
        self.assertEqual((args.sheet, args.title, args.axis_title), ("S", "T", "H"))

    def test_a_timekeeper_is_required_and_has_no_default(self):
        with self.assertRaises(SystemExit) as caught:
            quietly(build_chart.parse_args, ["in.xlsx", "out.xlsx"])
        self.assertEqual(caught.exception.code, 2)

    def test_a_bad_colour_is_refused(self):
        for bad in ("Lee Lawyer", "Lee Lawyer=#12345", "Lee Lawyer=red", "=#112233"):
            with self.subTest(bad), self.assertRaises(SystemExit):
                quietly(build_chart.parse_args, ["in.xlsx", "out.xlsx", "--timekeeper", bad])


class Refusals(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.source = self.dir / "in.xlsx"
        self.source.write_bytes(b"not read before the checks")

    def run_main(self, output):
        return quietly(build_chart.main, [str(self.source), str(output), *TIMEKEEPERS])

    def test_an_existing_output_is_refused_and_left_alone(self):
        output = self.dir / "out.xlsx"
        output.write_bytes(b"earlier")
        code, message = self.run_main(output)
        self.assertEqual(code, 1)
        self.assertIn("already exists", message)
        self.assertEqual(output.read_bytes(), b"earlier")

    def test_an_existing_pdf_is_refused_and_left_alone(self):
        pdf = self.dir / "out.pdf"
        pdf.write_bytes(b"earlier")
        code, message = self.run_main(self.dir / "out.xlsx")
        self.assertEqual(code, 1)
        self.assertIn("already exists", message)
        self.assertEqual(pdf.read_bytes(), b"earlier")

    def test_the_input_is_never_the_output(self):
        code, message = self.run_main(self.source)
        self.assertEqual(code, 1)
        self.assertIn("already exists", message)

    def test_an_output_that_is_not_xlsx_is_refused(self):
        code, message = self.run_main(self.dir / "out.ods")
        self.assertEqual(code, 1)
        self.assertIn(".xlsx", message)

    def test_a_missing_input_is_refused(self):
        self.source.unlink()
        code, message = self.run_main(self.dir / "out.xlsx")
        self.assertEqual(code, 1)
        self.assertIn("no workbook", message)

    @unittest.skipUnless(build_chart.uno is None, "uno is present")
    def test_a_host_without_uno_is_refused_and_nothing_is_written(self):
        code, message = self.run_main(self.dir / "out.xlsx")
        self.assertEqual(code, 1)
        self.assertIn("uno", message)
        self.assertEqual([path.name for path in self.dir.iterdir()], ["in.xlsx"])


class AxisDerivation(unittest.TestCase):
    WIDE = build_chart.PLOT_WIDTH

    def test_the_step_keeps_the_bands_few(self):
        self.assertEqual(build_chart.nice_step(1.7), 0.2)
        self.assertEqual(build_chart.nice_step(0.3), 0.1)
        self.assertEqual(build_chart.nice_step(7.5), 1)
        self.assertEqual(build_chart.nice_step(23), 5)

    def test_a_gap_clear_of_the_top_two_bands_needs_no_more_axis(self):
        # Eight low days leave the axis at the 1.8 the first working chart was set to by hand.
        step, bands, first, last = build_chart.scale_and_gap([1.7, 1.5] + [0.5] * 8, 5000)
        self.assertEqual((step, bands), (0.2, 9))
        self.assertEqual((first, last), (2, 9))

    def test_the_gap_is_the_wider_side_of_a_tall_bar(self):
        days = [0.2, 0.2, 2.0, 0.2, 0.2, 0.2, 0.2, 0.2]
        self.assertEqual(build_chart.scale_and_gap(days, 5000)[2:], (3, 7))

    def test_equal_bars_raise_the_axis_to_leave_room(self):
        step, bands, first, last = build_chart.scale_and_gap([1.0, 1.0, 1.0], 5000)
        self.assertEqual((step, bands, first, last), (0.2, 7, 0, 2))

    def test_a_gap_narrower_than_the_block_raises_the_axis(self):
        # One low day in ten is 1450 wide, too narrow for the 5000 block, so the tall bars must clear it.
        days = [1.0] * 4 + [0.1] + [1.0] * 5
        step, bands, first, last = build_chart.scale_and_gap(days, 5000)
        self.assertEqual((step, bands, first, last), (0.2, 7, 0, 9))

    def test_a_block_wider_than_the_plot_still_ends(self):
        self.assertEqual(build_chart.scale_and_gap([1.0, 1.0], self.WIDE * 3)[2:], (0, 1))

    def test_no_hours_is_refused(self):
        with self.assertRaises(build_chart.Refused):
            build_chart.scale_and_gap([0.0, 0.0], 5000)

    def test_no_low_day_is_no_run(self):
        self.assertIsNone(build_chart.widest_low_run([1.0, 1.0], 0.5))


class NoClientContent(unittest.TestCase):
    def test_the_script_holds_no_two_word_name(self):
        found = set(re.findall(r"\b[A-Z][a-z]+ [A-Z][a-z]+\b", SCRIPT.read_text(encoding="utf-8")))
        self.assertEqual(found - NOT_NAMES, set())

    def test_the_script_is_lf_with_a_shebang(self):
        content = SCRIPT.read_bytes()
        self.assertNotIn(b"\r", content)
        self.assertTrue(content.startswith(b"#!/usr/bin/env python3\n"))


@unittest.skipIf(BUILD_NEEDS, f"this host lacks {', '.join(BUILD_NEEDS)}")
class RealBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import openpyxl
        tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(tmp.cleanup)
        cls.dir = Path(tmp.name)
        cls.source = cls.dir / "fixture.xlsx"
        book = openpyxl.Workbook()
        sheet = book.active
        sheet.title = "Time Tracking Report - decimal"
        sheet.append(["Day", "User", "Time"])
        for day, user, hours in (
                (2, "Lee Lawyer", 1.2), (2, "Sam Assistant", 0.3), (3, "Lee Lawyer", 1.7), (4, "Sam Assistant", 0.2),
                (9, "Lee Lawyer", 0.4), (9, "Lee Lawyer", 0.1), (15, "Sam Assistant", 0.5), (16, "Lee Lawyer", 0.3),
                (17, "Lee Lawyer", 0.2), (22, "Sam Assistant", 0.4), (23, "Lee Lawyer", 0.5), (28, "Lee Lawyer", 0.6)):
            sheet.append([datetime.date(2030, 1, day), user, hours])
        book.save(cls.source)
        cls.source_hash = hashlib.sha256(cls.source.read_bytes()).hexdigest()

        cls.output = cls.dir / "built.xlsx"
        cls.result = cls.script(cls.output, *TIMEKEEPERS, "--title", "Fixture Bill", "--axis-title", "Fixture Hours")
        assert cls.result.returncode == 0, cls.result.stderr
        with zipfile.ZipFile(cls.output) as archive:
            cls.names = archive.namelist()
            cls.chart_xml = "".join(archive.read(name).decode("utf-8") for name in cls.parts(r"xl/charts/chart\d+\.xml"))
            cls.cache_xml = "".join(archive.read(name).decode("utf-8")
                                    for name in cls.parts(r"xl/pivotCache/pivotCacheDefinition\d+\.xml"))

    @classmethod
    def script(cls, output, *options):
        return subprocess.run([sys.executable, str(SCRIPT), str(cls.source), str(output), *options],
                              capture_output=True, text=True, timeout=180)

    @classmethod
    def parts(cls, pattern):
        return [name for name in cls.names if re.fullmatch(pattern, name)]

    def test_one_pivot_table_one_cache_and_one_chart(self):
        self.assertEqual(len(self.parts(r"xl/pivotTables/pivotTable\d+\.xml")), 1)
        self.assertEqual(len(self.parts(r"xl/pivotCache/pivotCacheDefinition\d+\.xml")), 1)
        self.assertEqual(len(self.parts(r"xl/charts/chart\d+\.xml")), 1)

    def test_the_pivot_reads_the_three_columns(self):
        self.assertEqual(re.findall(r'<cacheField name="([^"]+)"', self.cache_xml), ["Day", "User", "Time"])

    def test_the_x_axis_is_categories_not_dates(self):
        self.assertIn("<c:catAx>", self.chart_xml)
        self.assertNotIn("<c:dateAx>", self.chart_xml)

    def test_the_requested_colours_are_in_the_chart(self):
        colours = {value.lower() for value in re.findall(r'srgbClr val="([0-9a-fA-F]{6})"', self.chart_xml)}
        self.assertLessEqual({"112233", "aabbcc"}, colours)

    def test_the_titles_are_the_requested_ones(self):
        self.assertIn("Fixture Bill", self.chart_xml)
        self.assertIn("Fixture Hours", self.chart_xml)

    def test_the_axis_top_is_derived_from_the_data(self):
        self.assertEqual(float(re.search(r'<c:max val="([^"]+)"', self.chart_xml).group(1)), 1.8)

    def test_the_summary_line_ties_to_the_rows(self):
        self.assertIn("12 rows, 10 days, 6.40 hours", self.result.stdout)

    def test_the_pdf_is_written_beside_the_output(self):
        self.assertTrue(self.output.with_suffix(".pdf").read_bytes().startswith(b"%PDF"))

    def test_the_png_is_written_beside_the_output(self):
        self.assertTrue(self.output.with_suffix(".png").read_bytes().startswith(b"\x89PNG"))

    def test_the_input_is_unchanged(self):
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.source_hash)

    def test_a_second_run_refuses_and_leaves_the_output(self):
        before = self.output.read_bytes()
        result = self.script(self.output, *TIMEKEEPERS)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.output.read_bytes(), before)

    def test_a_user_with_no_colour_is_refused_and_nothing_is_written(self):
        output = self.dir / "uncoloured.xlsx"
        result = self.script(output, "--timekeeper", "Lee Lawyer=#112233")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Sam Assistant", result.stderr)
        self.assertFalse(output.exists())
        self.assertFalse(output.with_suffix(".pdf").exists())


if __name__ == "__main__":
    unittest.main()
