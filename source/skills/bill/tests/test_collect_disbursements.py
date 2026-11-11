"""collect_disbursements.py on invented receipts and sheets: each fee once, however many files state it."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import collect_disbursements  # noqa: E402
import cso_pdf  # noqa: E402

SHEET = [
    "Court Services Online Submission Sheet",
    "Transaction Package ID: 9000001",
    "Date Submitted: 2031-03-04",
    "Document Summary",
    ["Document", "Status", "Filing", "Urgent", "Fee", "Fee Collected"],
    ["Invented Pleading", "Submitted", "Not Processed", "N", "$ 25.00"],
    ["Invented Affidavit", "Submitted", "Processed", "N", "$ 0.00"],
    ["Total", "$ 25.00"],
    "Transaction Summary",
    ["Package Submission Fee Payment", "$ 7.00"],
]
PACKAGE_RECEIPT = ["Receipt", "Transaction Package ID: 9000001", "Date: 2031-03-04", "Package Submission Fee Payment $ 7.00", "Total: $ 7.00"]
FILING_RECEIPT = ["Receipt", "Transaction Package ID: 9000001", "Date: 2031-03-05", "Document Filing Fee $ 25.00", "Total: $ 25.00"]


def write_pdf(path, rows):
    doc = pymupdf.open()
    page = doc.new_page()
    for number, row in enumerate(rows):
        cells = [row] if isinstance(row, str) else row
        for column, cell in enumerate(cells):
            page.insert_text((40 + column * 90, 40 + number * 20), cell, fontsize=9)
    doc.save(path)
    doc.close()


def write_scan(path, hidden_text):
    pixmap = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 60, 80), False)
    pixmap.set_rect(pixmap.irect, (200,))
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(page.rect, pixmap=pixmap)
    page.insert_text((40, 40), hidden_text, fontsize=9, render_mode=3)
    doc.save(path)
    doc.close()


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.folder = self.dir / "matter"
        self.folder.mkdir()

    def run_cli(self, *argv):
        with contextlib.redirect_stdout(io.StringIO()):
            code = collect_disbursements.main([*argv, "--out", str(self.dir / "o.json")])
        self.assertEqual(code, 0)
        return json.loads((self.dir / "o.json").read_text(encoding="utf-8"))

    def write_json(self, name, value):
        (self.dir / name).write_text(json.dumps(value), encoding="utf-8")
        return str(self.dir / name)

    def assert_stops(self, *argv):
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stderr(io.StringIO()):
            self.run_cli(*argv)
        self.assertEqual(caught.exception.code, 2)


class Stated(Base):
    def setUp(self):
        super().setUp()
        (self.dir / "fee.pdf").write_bytes(b"receipt one")
        (self.dir / "fee copy.pdf").write_bytes(b"receipt one")
        (self.dir / "courier.pdf").write_bytes(b"receipt two")

    def run_it(self, receipts, *argv):
        return self.run_cli("--receipts", self.write_json("r.json", receipts), *argv)

    def receipt(self, name, amount="10.00", taxable=False):
        return {"path": str(self.dir / name), "description": f"Invented {name}", "amount": amount, "taxable": taxable}

    def test_one_receipt_saved_under_two_names_is_one_line(self):
        out = self.run_it([self.receipt("fee.pdf"), self.receipt("fee copy.pdf"), self.receipt("courier.pdf", "5.50", True)])
        self.assertEqual(len(out["lines"]), 2)
        self.assertEqual(out["subtotal"], "15.50")
        self.assertEqual(out["taxable_subtotal"], "5.50")
        self.assertEqual(out["duplicates"], [{"path": str(self.dir / "fee copy.pdf"), "same_as": str(self.dir / "fee.pdf")}])
        self.assertEqual(out["lines"][0]["line_kind"], "disbursement")
        self.assertEqual(len(out["lines"][0]["receipt_hash"]), 64)
        self.assertEqual(out["lines"][0]["sources"], [str(self.dir / "fee.pdf"), str(self.dir / "fee copy.pdf")])

    def test_one_receipt_at_two_amounts_stops(self):
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stderr(io.StringIO()):
            self.run_it([self.receipt("fee.pdf"), self.receipt("fee copy.pdf", "11.00")])
        self.assertEqual(caught.exception.code, 2)

    def test_a_missing_tax_status_stays_null_and_counts_in_no_taxable_subtotal(self):
        entry = self.receipt("courier.pdf", "5.50")
        del entry["taxable"]
        line = (out := self.run_it([entry]))["lines"][0]
        self.assertIsNone(line["taxable"])
        self.assertIn("tax_status_undecided", line["flags"])
        self.assertFalse(line["confirm"])
        self.assertEqual((out["subtotal"], out["taxable_subtotal"]), ("5.50", "0"))
        self.assertEqual(out["undecided"], [line["line_key"]])

    def test_a_decision_settles_the_tax_status_and_an_unknown_key_stops(self):
        entry = self.receipt("courier.pdf", "5.50")
        del entry["taxable"]
        key = self.run_it([entry])["lines"][0]["line_key"]
        out = self.run_it([entry], "--decisions", self.write_json("d.json", {key: {"taxable": True}}))
        self.assertEqual((out["taxable_subtotal"], out["undecided"], out["lines"][0]["flags"]), ("5.50", [], []))
        self.assert_stops("--receipts", str(self.dir / "r.json"), "--decisions", self.write_json("d2.json", {"disbursement:nothing": {"charged": True}}))


class Sheets(Base):
    def by_kind(self, out):
        return {line["kind"]: line for line in out["lines"]}

    def test_not_processed_fee_and_package_fee_both_return_the_first_flagged(self):
        write_pdf(self.folder / "sheet.pdf", SHEET)
        out = self.run_cli("--cso-dir", str(self.folder))
        self.assertEqual(len(out["lines"]), 2, out["lines"])
        fee, package = self.by_kind(out)["court_filing_fee"], self.by_kind(out)["package_submission_fee"]
        self.assertEqual((fee["amount"], fee["confirm"]), ("25.00", True))
        self.assertEqual(fee["flags"], ["not_processed", "fee_collected_blank", "tax_status_undecided"])
        self.assertIn("Invented Pleading", fee["description"])
        self.assertIn("2031-03-04", fee["description"])
        self.assertEqual((package["amount"], package["confirm"]), ("7.00", False))
        self.assertEqual((out["subtotal"], out["unconfirmed_subtotal"]), ("7.00", "25.00"))
        self.assertEqual(fee["line_key"], f"disbursement:{fee['receipt_hash'][:12]}:1")
        self.assertEqual(package["line_key"], f"disbursement:{fee['receipt_hash'][:12]}:package")
        self.assertEqual(fee["package_id"], "9000001")

    def test_two_receipt_files_with_one_hash_count_once_and_name_both(self):
        write_pdf(self.folder / "receipt.pdf", PACKAGE_RECEIPT)
        (self.folder / "receipt copy.pdf").write_bytes((self.folder / "receipt.pdf").read_bytes())
        out = self.run_cli("--cso-dir", str(self.folder))
        self.assertEqual(len(out["lines"]), 1)
        self.assertEqual(sorted(Path(p).name for p in out["lines"][0]["sources"]), ["receipt copy.pdf", "receipt.pdf"])
        self.assertEqual(len(out["duplicates"]), 1)
        self.assertEqual(out["subtotal"], "7.00")

    def test_a_receipt_and_its_sheets_transaction_summary_are_one_fee(self):
        write_pdf(self.folder / "sheet.pdf", SHEET)
        write_pdf(self.folder / "receipt.pdf", PACKAGE_RECEIPT)
        out = self.run_cli("--cso-dir", str(self.folder))
        self.assertEqual(len(out["lines"]), 2)
        package = self.by_kind(out)["package_submission_fee"]
        self.assertEqual(Path(package["receipt_path"]).name, "receipt.pdf")
        self.assertEqual(Path(package["source_file"]).name, "sheet.pdf")
        self.assertEqual(out["subtotal"], "7.00")

    def test_a_filing_fee_receipt_joins_its_line_and_the_flag_stays(self):
        write_pdf(self.folder / "sheet.pdf", SHEET)
        write_pdf(self.folder / "filing.pdf", FILING_RECEIPT)
        out = self.run_cli("--cso-dir", str(self.folder))
        fee = self.by_kind(out)["court_filing_fee"]
        self.assertEqual(len(out["lines"]), 2)
        self.assertEqual(Path(fee["receipt_path"]).name, "filing.pdf")
        self.assertTrue(fee["confirm"])

    def test_a_receipt_matching_no_line_on_its_sheet_is_flagged_not_counted(self):
        write_pdf(self.folder / "sheet.pdf", SHEET)
        write_pdf(self.folder / "other.pdf", ["Receipt", "Package ID: 9000001", "Date: 2031-03-04", "Total: $ 32.00"])
        out = self.run_cli("--cso-dir", str(self.folder))
        odd = [line for line in out["lines"] if line["amount"] == "32.00"][0]
        self.assertIn("matches_no_sheet_line", odd["flags"])
        self.assertEqual((odd["confirm"], out["subtotal"]), (True, "7.00"))

    def test_a_second_receipt_for_one_package_and_amount_is_flagged(self):
        write_pdf(self.folder / "a.pdf", PACKAGE_RECEIPT)
        write_pdf(self.folder / "b.pdf", [*PACKAGE_RECEIPT, "Printed again"])
        out = self.run_cli("--cso-dir", str(self.folder))
        self.assertEqual(sum(line["confirm"] for line in out["lines"]), 1)
        self.assertEqual(out["subtotal"], "7.00")

    def test_two_sheets_for_one_package(self):
        write_pdf(self.folder / "a.pdf", SHEET)
        write_pdf(self.folder / "b.pdf", [*SHEET, "Printed again"])
        out = self.run_cli("--cso-dir", str(self.folder))
        self.assertEqual((len(out["lines"]), len(out["duplicates"])), (2, 1))
        write_pdf(self.folder / "c.pdf", [row if row != ["Package Submission Fee Payment", "$ 7.00"] else ["Package Submission Fee Payment", "$ 9.00"] for row in SHEET])
        self.assert_stops("--cso-dir", str(self.folder))

    def test_tax_status_comes_from_the_settings_passed_in(self):
        write_pdf(self.folder / "sheet.pdf", SHEET)
        settings = self.write_json("s.json", {"disbursement_tax": {"package_submission_fee": True, "court_filing_fee": False}})
        out = self.run_cli("--cso-dir", str(self.folder), "--billing-settings", settings)
        self.assertEqual(self.by_kind(out)["package_submission_fee"]["taxable"], True)
        self.assertEqual(self.by_kind(out)["court_filing_fee"]["taxable"], False)
        self.assertEqual(out["taxable_subtotal"], "7.00")

    def test_the_practitioner_decides_a_flagged_line(self):
        write_pdf(self.folder / "sheet.pdf", SHEET)
        key = self.by_kind(self.run_cli("--cso-dir", str(self.folder)))["court_filing_fee"]["line_key"]
        out = self.run_cli("--cso-dir", str(self.folder), "--decisions", self.write_json("d.json", {key: {"charged": True, "taxable": False}}))
        self.assertEqual((out["subtotal"], out["unconfirmed_subtotal"]), ("32.00", "0"))
        out = self.run_cli("--cso-dir", str(self.folder), "--decisions", self.write_json("d.json", {key: {"charged": False}}))
        self.assertEqual((out["subtotal"], len(out["lines"]), out["not_charged"][0]["line_key"]), ("7.00", 1, key))

    def test_a_scanned_file_is_routed_never_read_from_its_text_layer(self):
        write_scan(self.folder / "scan.pdf", "Document Summary Invented Pleading Not Processed $ 99.00")
        out = self.run_cli("--cso-dir", str(self.folder))
        self.assertEqual(out["lines"], [])
        self.assertEqual([(Path(s["path"]).name, s["pages"]) for s in out["needs_scanned_route"]], [("scan.pdf", [1])])

    def test_fees_read_from_a_scan_come_back_as_stated_lines(self):
        scan = self.folder / "scan.pdf"
        write_scan(scan, "Invented layer")
        stated = [{"path": str(scan), "description": "Court filing fee: Invented Pleading", "amount": "25.00", "line": 1, "package_id": "9000001",
                   "kind": "court_filing_fee", "flags": ["not_processed"]},
                  {"path": str(scan), "description": "Package fee", "amount": "7.00", "line": "package", "package_id": "9000001", "kind": "package_submission_fee"}]
        write_pdf(self.folder / "receipt.pdf", PACKAGE_RECEIPT)
        out = self.run_cli("--receipts", self.write_json("r.json", stated), "--cso-dir", str(self.folder))
        self.assertEqual(out["needs_scanned_route"], [])
        self.assertEqual(len(out["lines"]), 2)
        self.assertEqual((out["subtotal"], out["unconfirmed_subtotal"]), ("7.00", "25.00"))

    def test_a_file_it_cannot_read_as_a_fee_is_reported(self):
        write_pdf(self.folder / "cso notice.pdf", ["Court Services Online", "A layout never seen"])
        write_pdf(self.folder / "cheque.pdf", ["Invented cheque", "Pay to the order of", "Total: $ 40.00"])
        (self.folder / "broken.pdf").write_bytes(b"not a pdf")
        out = self.run_cli("--cso-dir", str(self.folder))
        self.assertEqual(out["lines"], [])
        self.assertEqual(sorted(Path(u["path"]).name for u in out["unread"]), ["broken.pdf", "cso notice.pdf"])
        self.assertEqual([Path(p).name for p in out["other_files"]], ["cheque.pdf"])

    def test_a_sheet_with_no_package_fee_is_reported_and_its_fee_listed(self):
        write_pdf(self.folder / "sheet.pdf", SHEET[:-2])
        out = self.run_cli("--cso-dir", str(self.folder))
        self.assertEqual([line["amount"] for line in out["lines"]], ["25.00"])
        self.assertEqual([Path(u["path"]).name for u in out["unread"]], ["sheet.pdf"])

    def test_a_scan_and_a_digital_sheet_for_one_package_are_one_set_of_fees(self):
        write_scan(self.folder / "scan.pdf", "Invented layer")
        write_pdf(self.folder / "sheet.pdf", SHEET)
        stated = [{"path": str(self.folder / "scan.pdf"), "description": "Fee", "amount": "25.00", "line": 1, "package_id": "9000001", "flags": ["not_processed"]},
                  {"path": str(self.folder / "scan.pdf"), "description": "Package fee", "amount": "7.00", "line": "package", "package_id": "9000001"}]
        out = self.run_cli("--receipts", self.write_json("r.json", stated), "--cso-dir", str(self.folder))
        self.assertEqual(len(out["lines"]), 2)
        self.assertEqual(Path(out["duplicates"][0]["path"]).name, "sheet.pdf")

    def test_the_scanned_page_test(self):
        pixmap = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 60, 80), False)
        pixmap.set_rect(pixmap.irect, (200,))
        doc = pymupdf.open()
        bare = doc.new_page()  # a picture and no words
        bare.insert_image(bare.rect, pixmap=pixmap)
        worded = doc.new_page()  # a full-page background under visible words
        worded.insert_image(worded.rect, pixmap=pixmap)
        for n in range(30):
            worded.insert_text((40, 40 + n * 20), "Invented words across the page " * 3, fontsize=9)
        doc.new_page().insert_text((40, 40), "Invented words and no picture", fontsize=9)
        self.assertEqual([cso_pdf.is_scanned(page) for page in doc], [True, False, False])
        doc.close()

    def test_date_forms(self):
        for text in ("2031-03-04", "2031/03/04", "March 4, 2031", "Mar. 4, 2031", "04-Mar-2031", "4 March 2031"):
            self.assertEqual(cso_pdf.date_in(f"Filed {text}."), "2031-03-04", text)
        self.assertIsNone(cso_pdf.date_in("No date here"))

    def test_a_missing_folder_stops(self):
        self.assert_stops("--cso-dir", str(self.dir / "absent"))

    def test_lines_outside_the_period_are_set_aside_and_undated_lines_stay_flagged(self):
        write_pdf(self.folder / "sheet.pdf", SHEET)
        write_pdf(self.folder / "undated.pdf", ["Receipt", "Package ID: 9000002", "Total: $ 7.00"])
        out = self.run_cli("--cso-dir", str(self.folder), "--from", "2031-04-01", "--to", "2031-04-30")
        self.assertEqual(len(out["outside_period"]), 2)
        self.assertEqual([line["package_id"] for line in out["lines"]], ["9000002"])
        self.assertIn("no_filing_date", out["lines"][0]["flags"])


if __name__ == "__main__":
    unittest.main()
