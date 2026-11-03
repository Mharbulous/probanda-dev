"""collect_disbursements.py on invented receipts: one receipt, however many names it is saved under."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import collect_disbursements  # noqa: E402


class Collect(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        (self.dir / "fee.pdf").write_bytes(b"receipt one")
        (self.dir / "fee copy.pdf").write_bytes(b"receipt one")
        (self.dir / "courier.pdf").write_bytes(b"receipt two")

    def run_it(self, receipts):
        (self.dir / "r.json").write_text(json.dumps(receipts), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            code = collect_disbursements.main(["--receipts", str(self.dir / "r.json"), "--out", str(self.dir / "o.json")])
        return code, json.loads((self.dir / "o.json").read_text(encoding="utf-8"))

    def receipt(self, name, amount="10.00", taxable=False):
        return {"path": str(self.dir / name), "description": f"Invented {name}", "amount": amount, "taxable": taxable}

    def test_one_receipt_saved_under_two_names_is_one_line(self):
        code, out = self.run_it([self.receipt("fee.pdf"), self.receipt("fee copy.pdf"), self.receipt("courier.pdf", "5.50", True)])
        self.assertEqual(code, 0)
        self.assertEqual(len(out["lines"]), 2)
        self.assertEqual(out["subtotal"], "15.50")
        self.assertEqual(out["taxable_subtotal"], "5.50")
        self.assertEqual(out["duplicates"], [{"path": str(self.dir / "fee copy.pdf"), "same_as": str(self.dir / "fee.pdf")}])
        self.assertEqual(out["lines"][0]["line_kind"], "disbursement")
        self.assertEqual(len(out["lines"][0]["receipt_hash"]), 64)

    def test_one_receipt_at_two_amounts_stops(self):
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stderr(io.StringIO()):
            self.run_it([self.receipt("fee.pdf"), self.receipt("fee copy.pdf", "11.00")])
        self.assertEqual(caught.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
