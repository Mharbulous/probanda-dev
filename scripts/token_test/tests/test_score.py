#!/usr/bin/env python3
"""
score: names score component by component, comparison files carry gold and output, and the
summary prices each correct name and fact.

Run: python -m pytest -q scripts/token_test/tests
"""

import csv
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
_spec = importlib.util.spec_from_file_location("score", HERE / "score.py")
score = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(score)


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


class SplitNameTest(unittest.TestCase):
    def test_full_name(self):
        self.assertEqual(score.split_name("2023-01-31 RCPT Alexei re tenant rights $288.88.pdf"),
                         {"date": "2023-01-31", "code": "RCPT", "parties": "Alexei", "flag": "re",
                          "subject": "tenant rights", "amount": "$288.88"})

    def test_combined_flags_and_status(self):
        parts = score.split_name("2020-10-29 LT SmithJ re srv NOCC Smith v. Jones FILED")
        self.assertEqual((parts["flag"], parts["subject"], parts["amount"]),
                         ("re srv", "NOCC Smith v. Jones FILED", ""))

    def test_amount_before_status(self):
        self.assertEqual(score.split_name("2021-01-01 INV ACME re fees $1,200 signed")["amount"], "$1,200")


class NamesTest(unittest.TestCase):
    def test_component_marks(self):
        marks = score.score_name("2023-01-31 RCPT Alexei re tenant rights.pdf", "Accounting/Receipts",
                                 "2023-01-30 RCPT Alexei re Tenant  rights.pdf", "accounting\\receipts\\")
        self.assertEqual(marks["date"], 0)
        self.assertEqual((marks["subject"], marks["folder"], marks["code"]), (1, 1, 1))
        self.assertEqual(marks["correct"], 0)

    def test_names_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            write_csv(tmp / "key.csv", [{"doc": "D001", "name": "2023-01-31 LT SmithJ re costs", "folder": "Corr"}])
            write_csv(tmp / "prop.csv", [{"tag": "E2-haiku_p1-D001-1", "name": "2023-01-31 LT SmithJ re costs",
                                          "folder": "Corr"},
                                         {"tag": "E2-sonnet_p1-D001-1", "name": "2023-01-31 EM SmithJ re costs",
                                          "folder": "Corr"}])
            rows = score.names(tmp / "key.csv", tmp / "prop.csv", tmp / "out.csv")
            self.assertEqual([r["correct"] for r in rows], [1, 0])
            write_csv(tmp / "prop.csv", [{"tag": "E2-x-D099-1", "name": "n", "folder": "f"}])
            with self.assertRaises(ValueError):
                score.names(tmp / "key.csv", tmp / "prop.csv", tmp / "out.csv")


class FactsAndSummaryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.tmp_path = Path(self.tmp.name)
        for d in ("gold", "runs", "marks"):
            (t / d).mkdir()
        (t / "gold" / "D001.json").write_text(json.dumps(["The lease began 1 May 2020.", "Rent was $900."]))
        (t / "runs" / "E3-a-D001-1.json").write_text(json.dumps({"facts": [{"text": "Rent was $900."}]}))
        (t / "runs" / "E3-a-D002-1.json").write_text(json.dumps({"facts": []}))  # no gold: skipped
        write_csv(t / "ledger.csv", [
            {"tag": "E3-a-D001-1", "experiment": "E3", "cell": "a", "doc": "D001", "rep": "1", "cost_usd": "0.30"},
            {"tag": "E3-a-D002-1", "experiment": "E3", "cell": "a", "doc": "D002", "rep": "1", "cost_usd": "0.10"},
            {"tag": "E2-h-D001-1", "experiment": "E2", "cell": "h", "doc": "D001", "rep": "1", "cost_usd": "0.02"},
            {"tag": "", "experiment": "", "cell": "", "doc": "", "rep": "", "cost_usd": "9"},
        ])
        write_csv(t / "names.csv", [{"tag": "E2-h-D001-1", "correct": "1"}])

    def tearDown(self):
        self.tmp.cleanup()

    def test_compare_writes_gold_and_output(self):
        t = self.tmp_path
        written = score.compare(t / "gold", t / "runs", t / "cmp")
        self.assertEqual([p.name for p in written], ["E3-a-D001-1.md"])
        text = written[0].read_text(encoding="utf-8")
        self.assertIn("1. The lease began 1 May 2020.", text)
        self.assertIn('"text": "Rent was $900."', text)

    def test_summary_prices_correct_results(self):
        t = self.tmp_path
        (t / "marks" / "E3-a-D001-1.json").write_text(json.dumps(
            {"gold": [{"n": 1, "mark": "missing"}, {"n": 2, "mark": "found"}], "extra": []}))
        rows = {r["experiment"]: r for r in score.summary(t / "ledger.csv", t / "sum.csv", t / "names.csv",
                                                          t / "marks", t / "gold")}
        self.assertEqual(set(rows), {"E2", "E3"})
        self.assertEqual(rows["E2"]["cost_per_correct_name"], 0.02)
        e3 = rows["E3"]
        self.assertEqual((e3["runs"], e3["fact_runs"], e3["gold_facts"], e3["facts_found"]), (2, 1, 2, 1))
        self.assertAlmostEqual(e3["cost_per_correct_fact"], 0.30)
        self.assertEqual(e3["cost_per_correct_name"], "")

    def test_marks_must_cover_every_gold_fact(self):
        t = self.tmp_path
        (t / "marks" / "E3-a-D001-1.json").write_text(json.dumps({"gold": [{"n": 1, "mark": "found"}]}))
        with self.assertRaises(ValueError):
            score.summary(t / "ledger.csv", t / "sum.csv", None, t / "marks", t / "gold")


if __name__ == "__main__":
    unittest.main()
