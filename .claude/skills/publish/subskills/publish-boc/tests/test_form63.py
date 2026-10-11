from __future__ import annotations

import copy
import json
import re
import subprocess
import sys
import tempfile
import zipfile
import unittest
from decimal import Decimal
from pathlib import Path

from lxml import etree

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

import form63  # noqa: E402

FIXTURE = SKILL_ROOT / "tests" / "fixtures" / "form63_golden.md"
FILL_FORM63_PY = SKILL_ROOT / "scripts" / "fill_form63.py"

# The prescribed costs-row description: no parenthetical, no context input.
COSTS_DESCRIPTION = "To enter judgment under Rule 3-8"

SAMPLE_CTX = {
    "court_file_number": "S-290003",
    "registry": "Vancouver",
    "plaintiffs": ["HARBOURLINE REAL ESTATE SERVICES INC."],
    "defendants": ["MEI LIN TAN", "WEN LI HAO"],
    "party_claiming_costs": "the Plaintiff, Harbourline Real Estate Services Inc.",
    "amount_involved": "27700.00",
    "amount_involved_basis": "principal debt pleaded in the NOCC; interest excluded",
    "additional_costs_6_5": None,
    "disbursements": [
        {
            "description": "Court filing fees (CSO) -- Court File No. S-290003",
            "amount": "136.00",
        },
        {
            "description": (
                "LTSA title search fees incurred locating alternative "
                "addresses of Defendants"
            ),
            "amount": "26.74",
        },
        {
            "description": "Process server fees (West Coast Title Search Ltd.)",
            "amount": "629.95",
        },
    ],
    "disbursement_taxes": None,
    "date": None,
}


class GoldenFixtureTest(unittest.TestCase):
    def test_sample_context_matches_golden_fixture(self) -> None:
        expected = FIXTURE.read_text(encoding="utf-8")
        actual = form63.render(copy.deepcopy(SAMPLE_CTX))
        self.assertEqual(actual, expected)


class Schedule1BandTest(unittest.TestCase):
    def test_boundaries(self) -> None:
        cases = [
            ("0", "160"),
            ("4999.99", "160"),
            ("5000", "240"),
            ("14999.99", "240"),
            ("15000", "320"),
            ("24999.99", "320"),
            ("25000", "400"),
            ("34999.99", "400"),
            ("35000", "480"),
            ("44999.99", "480"),
            ("45000", "560"),
            ("54999.99", "560"),
            ("55000", "620"),
            ("64999.99", "620"),
            ("65000", "680"),
            ("1000000", "680"),
        ]
        for amount, expected in cases:
            with self.subTest(amount=amount):
                self.assertEqual(
                    form63.schedule_1_costs(Decimal(amount)), Decimal(expected)
                )

    def test_no_amount_involved(self) -> None:
        self.assertEqual(form63.schedule_1_costs(None), Decimal("320"))


class TotalsTest(unittest.TestCase):
    def test_costs_total_with_6_5(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["additional_costs_6_5"] = "100.00"
        fig = form63.compute(ctx)
        self.assertEqual(fig["costs_total"], Decimal("500"))  # 400 + 100

    def test_costs_total_without_6_5(self) -> None:
        fig = form63.compute(copy.deepcopy(SAMPLE_CTX))
        self.assertEqual(fig["costs_total"], Decimal("400"))
        self.assertIsNone(fig["additional_costs"])

    def test_disbursement_total_with_taxes(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["disbursement_taxes"] = "10.00"
        fig = form63.compute(ctx)
        self.assertEqual(fig["disbursement_total"], Decimal("802.69"))  # 792.69 + 10.00

    def test_disbursement_total_without_taxes(self) -> None:
        fig = form63.compute(copy.deepcopy(SAMPLE_CTX))
        self.assertEqual(fig["disbursement_total"], Decimal("792.69"))
        self.assertIsNone(fig["disbursement_taxes"])

    def test_decimal_formatting_rounds_and_adds_separator(self) -> None:
        self.assertEqual(form63._fmt_money(Decimal("1234.5")), "$1,234.50")


class ValidationTest(unittest.TestCase):
    def test_missing_plaintiffs_raises(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["plaintiffs"] = []
        with self.assertRaises(ValueError):
            form63.render(ctx)

    def test_missing_defendants_raises(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["defendants"] = []
        with self.assertRaises(ValueError):
            form63.render(ctx)

    def test_missing_party_claiming_costs_raises(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        del ctx["party_claiming_costs"]
        with self.assertRaises(ValueError):
            form63.render(ctx)

    def test_missing_court_file_number_raises(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        del ctx["court_file_number"]
        with self.assertRaises(ValueError):
            form63.render(ctx)

    def test_missing_registry_raises(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        del ctx["registry"]
        with self.assertRaises(ValueError):
            form63.render(ctx)

    def test_amount_and_no_amount_conflict_raises(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["no_amount_involved"] = True
        with self.assertRaises(ValueError):
            form63.render(ctx)

    def test_missing_amount_without_no_amount_flag_raises(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["amount_involved"] = None
        with self.assertRaises(ValueError):
            form63.render(ctx)

    def test_float_amount_rejected(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["amount_involved"] = 27700.00
        with self.assertRaises(ValueError):
            form63.render(ctx)

    def test_negative_amount_rejected(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["amount_involved"] = "-1.00"
        with self.assertRaises(ValueError):
            form63.render(ctx)

    def test_no_amount_involved_renders(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["amount_involved"] = None
        ctx["no_amount_involved"] = True
        out = form63.render(ctx)
        self.assertIn("no amount involved", out)
        self.assertIn("**$320.00**", out)


class PluralizationTest(unittest.TestCase):
    def test_single_plaintiff_is_singular(self) -> None:
        out = form63.render(copy.deepcopy(SAMPLE_CTX))
        self.assertIn("*Plaintiff*", out)
        self.assertNotIn("*Plaintiffs*", out)

    def test_two_defendants_is_plural(self) -> None:
        out = form63.render(copy.deepcopy(SAMPLE_CTX))
        self.assertIn("*Defendants*", out)

    def test_three_party_join_uses_commas_and_and(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["defendants"] = ["A", "B", "C"]
        out = form63.render(ctx)
        self.assertIn("A, B and C", out)


class NoLeakTest(unittest.TestCase):
    def test_no_context_keys_or_stray_brackets_leak(self) -> None:
        out = form63.render(copy.deepcopy(SAMPLE_CTX))
        for key in SAMPLE_CTX:
            self.assertNotIn(key, out)
        # Only escaped brackets survive: the date placeholder and the Rule 22-3 note.
        unescaped = out.replace("\\[", "").replace("\\]", "")
        self.assertNotIn("[", unescaped)
        self.assertNotIn("]", unescaped)

    def test_allowed_and_total_allowed_always_dotted(self) -> None:
        ctx = copy.deepcopy(SAMPLE_CTX)
        ctx["additional_costs_6_5"] = "999.00"
        ctx["disbursement_taxes"] = "50.00"
        out = form63.render(ctx)
        self.assertIn("**TOTAL ALLOWED**", out)
        self.assertIn("**$..............**", out)


class CostsDescriptionTest(unittest.TestCase):
    def test_description_is_the_prescribed_literal_whatever_the_context(self) -> None:
        no_amount = copy.deepcopy(SAMPLE_CTX)
        no_amount["amount_involved"] = None
        no_amount["no_amount_involved"] = True
        with_6_5 = copy.deepcopy(SAMPLE_CTX)
        with_6_5["additional_costs_6_5"] = "100.00"
        with_taxes = copy.deepcopy(SAMPLE_CTX)
        with_taxes["disbursement_taxes"] = "10.00"
        cases = {
            "golden": SAMPLE_CTX,
            "no amount involved": no_amount,
            "additional costs under 6 (5)": with_6_5,
            "disbursement taxes": with_taxes,
        }
        for name, ctx in cases.items():
            with self.subTest(name):
                fig = form63.compute(copy.deepcopy(ctx))
                self.assertEqual(fig["costs_description"], COSTS_DESCRIPTION)
                self.assertNotIn(
                    "Response to Civil Claim", form63.render(copy.deepcopy(ctx))
                )


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# Figures the golden markdown carries. The .docx must show the same ones.
SCHEDULE_1_COSTS = "$400.00"
COSTS_TOTAL = "$400.00"
DISBURSEMENT_AMOUNTS = ["$136.00", "$26.74", "$629.95"]
DISBURSEMENT_TOTAL = "$792.69"


def docx_rows(path: Path) -> list[list[str]]:
    """Every table row in a .docx, as a list of stripped cell strings."""
    with zipfile.ZipFile(path) as z:
        root = etree.fromstring(z.read("word/document.xml"))
    return [
        [
            "".join(t.text or "" for t in tc.iter(W + "t")).strip()
            for tc in tr.findall(W + "tc")
        ]
        for tr in root.iter(W + "tr")
    ]


def docx_text(path: Path) -> str:
    """Every <w:t> in a .docx, joined -- paragraphs outside tables included."""
    with zipfile.ZipFile(path) as z:
        root = etree.fromstring(z.read("word/document.xml"))
    return " ".join(t.text or "" for t in root.iter(W + "t"))


class CliDocxTest(unittest.TestCase):
    def fill(self, tmp_path: Path, ctx: dict = SAMPLE_CTX) -> Path:
        ctx_path = tmp_path / "ctx.json"
        ctx_path.write_text(json.dumps(ctx), encoding="utf-8")
        out_path = tmp_path / "f.md"
        result = subprocess.run(
            [
                sys.executable,
                str(FILL_FORM63_PY),
                "--context",
                str(ctx_path),
                "--out",
                str(out_path),
                "--docx-dir",
                str(tmp_path),
                "--out-name",
                "f",
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return tmp_path / "f.docx"

    def test_docx_flag_writes_docx_beside_md(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            docx_path = self.fill(Path(tmp))
            self.assertTrue(docx_path.exists())
            self.assertGreater(docx_path.stat().st_size, 0)

    def test_docx_figures_match_the_golden_markdown(self) -> None:
        golden = FIXTURE.read_text(encoding="utf-8")
        dotted = form63._DOTTED
        with tempfile.TemporaryDirectory() as tmp:
            rows = docx_rows(self.fill(Path(tmp)))

        costs_rows = [r for r in rows if r and r[0].startswith("To enter judgment")]
        self.assertEqual(len(costs_rows), 1)
        self.assertEqual(costs_rows[0][1], SCHEDULE_1_COSTS)

        totals = [r[1] for r in rows if r and r[0] == "Total:"]
        self.assertEqual(totals, [COSTS_TOTAL, DISBURSEMENT_TOTAL])

        for description, amount in zip(
            (d["description"] for d in SAMPLE_CTX["disbursements"]),
            DISBURSEMENT_AMOUNTS,
        ):
            self.assertIn([description, amount, dotted], rows)

        # The same figures are the ones the golden markdown carries.
        for figure in [SCHEDULE_1_COSTS, DISBURSEMENT_TOTAL, *DISBURSEMENT_AMOUNTS]:
            self.assertIn(figure, golden)

    def test_docx_costs_description_is_the_prescribed_literal(self) -> None:
        no_amount = copy.deepcopy(SAMPLE_CTX)
        no_amount["amount_involved"] = None
        no_amount["no_amount_involved"] = True
        for name, ctx in (("golden", SAMPLE_CTX), ("no amount involved", no_amount)):
            with self.subTest(name), tempfile.TemporaryDirectory() as tmp:
                docx_path = self.fill(Path(tmp), ctx)
                rows = docx_rows(docx_path)
                costs_rows = [r for r in rows if r and r[0].startswith("To enter judgment")]
                self.assertEqual([r[0] for r in costs_rows], [COSTS_DESCRIPTION])
                self.assertNotIn("Response to Civil Claim", docx_text(docx_path))

    def test_docx_carries_no_residual_placeholder(self) -> None:
        """No bracket token survives a fill but the form's own prescribed two.

        The Rule 22-3 note and the registrar's date are bracketed in the
        prescribed form itself, so they are face text, not placeholders left
        unfilled. Asserted in document order.

        Checked over the whole document rather than a named prefix list: a
        placeholder in a body paragraph, or one whose name nobody thought to
        list, is exactly the kind this test exists to catch. The shared
        verifier now reads the same OOXML, so this is a second pair of eyes on
        Form 63 specifically, not the only check covering the narrow columns.
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = docx_text(self.fill(Path(tmp)))
        self.assertEqual(
            re.findall(r"\[[^\]]*\]", text),
            [
                "[Rule 22-3 of the Supreme Court Civil Rules applies to all forms.]",
                "[dd/mmm/yyyy]",
            ],
        )


if __name__ == "__main__":
    unittest.main()
