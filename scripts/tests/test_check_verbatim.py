#!/usr/bin/env python3
"""
check_verbatim: a plan, red test or issue body that holds a sentence of the
suggestion verbatim fails, and a paraphrase passes.

Run: python -m pytest -q scripts/tests/test_check_verbatim.py

The suggestion below is invented for this test.
"""

import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_verbatim", os.path.join(SCRIPTS, "check_verbatim.py"))
check_verbatim = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_verbatim)

RECORD = {
    "suggestion_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
    "title": "Make the weekly summary easier to scan",
    "body": "The weekly summary arrives as one long paragraph. I lose my place every time I read it on the phone.",
    "comment": "Please keep the totals at the bottom where they are now.",
    "item_list": [
        {"item": 1, "text": "Put each matter's total on its own line with the hours first", "status": "undecided"},
        {"item": 2, "text": "Bold the week's grand total", "status": "undecided"},
    ],
    "context_lines": [{"kind": "constraint", "text": "Do not add colours or icons to the summary page."}],
    "items": [{"pain": "The structured pain point from an older row says this in its own words", "changes": []}],
}

PARAPHRASE = """## Agent Brief

Suggestion 0f8fad5b-d9cb-469f-a165-70867728950e. The pain: the summary is one block of text, hard to follow on a
small screen. Item 1 splits it into one line per matter, hours leading. Item 2 emphasises the overall figure.
Constraint: no new colour or iconography. Recommendation for item 2: decline, Already works as asked.
"""


class SentencesTest(unittest.TestCase):
    def test_sentence_split_and_minimum_length(self):
        got = check_verbatim.sentences("One two three four five six. Short one!\n- seven eight nine ten eleven twelve; x")
        self.assertEqual(got, [["one", "two", "three", "four", "five", "six"],
                               ["seven", "eight", "nine", "ten", "eleven", "twelve"]])

    def test_normalisation(self):
        self.assertEqual(check_verbatim.words("Don’t  LOSE\tmy—place"), ["don't", "lose", "my", "place"])

    def test_record_fields_cover_every_submitted_part(self):
        labels = [label for label, _ in check_verbatim.record_fields(RECORD)]
        self.assertEqual(labels, [
            "suggestion 0f8fad5b title", "suggestion 0f8fad5b pain point", "suggestion 0f8fad5b comment",
            "suggestion 0f8fad5b item 1", "suggestion 0f8fad5b item 2", "suggestion 0f8fad5b context line 1",
            "suggestion 0f8fad5b structured items, string 1",
        ])


class CheckTest(unittest.TestCase):
    def found(self, text):
        return check_verbatim.check(check_verbatim.record_fields(RECORD), [("brief.md", text)])

    def test_a_paraphrase_passes(self):
        self.assertEqual(self.found(PARAPHRASE), [])

    def test_a_verbatim_sentence_of_each_part_fails(self):
        cases = {
            "pain point": "Context: I lose my place every time I read it on the phone.",
            "item 1": "Step 1: put each matter's total on its own line with the hours first.",
            "comment": "The practitioner wrote: please keep the totals at the bottom where they are now",
            "context line 1": "Constraint - do not add colours or icons to the summary page.",
            "title": "### Make the weekly summary easier to scan",
            "structured items": "the structured pain point from an older row says this in its own words",
        }
        for part, text in cases.items():
            with self.subTest(part=part):
                found = self.found(PARAPHRASE + text)
                self.assertEqual(len(found), 1, found)
                self.assertIn(part, found[0][2])

    def test_case_whitespace_line_breaks_quotes_and_markdown_do_not_hide_it(self):
        text = PARAPHRASE + '\n> "The **weekly** summary\n> arrives as one long `paragraph`"\n'
        found = self.found(text)
        self.assertEqual([(f[1], f[2], f[3]) for f in found], [(7, "suggestion 0f8fad5b pain point", 1)])

    def test_typographic_marks_do_not_hide_it(self):
        found = self.found("put each matter’s total on its own line — with the hours first")
        self.assertEqual(len(found), 1)

    def test_a_short_sentence_and_a_partial_quote_pass(self):
        self.assertEqual(self.found("Bold the week's grand total. I lose my place every time."), [])

    def test_a_red_test_file_is_checked_like_any_other(self):
        red = 'test("each matter has its own line", () => {\n  // put each matter\'s total on its own line with the hours first\n});\n'
        self.assertEqual([f[1] for f in self.found(red)], [2])


class CliTest(unittest.TestCase):
    def run_cli(self, files, record=RECORD):
        with tempfile.TemporaryDirectory() as tmp:
            rec = Path(tmp) / "record.json"
            rec.write_text(json.dumps(record), encoding="utf-8")
            paths = []
            for name, text in files.items():
                (Path(tmp) / name).write_text(text, encoding="utf-8")
                paths.append(str(Path(tmp) / name))
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                code = check_verbatim.main(["--suggestion", str(rec), *paths])
            return code, out.getvalue(), err.getvalue()

    def test_exit_codes_and_no_echo(self):
        code, out, _ = self.run_cli({"plan.md": PARAPHRASE})
        self.assertEqual(code, 0)
        code, out, _ = self.run_cli({"plan.md": PARAPHRASE, "issue.md": "Do not add colours or icons to the summary page"})
        self.assertEqual(code, 1)
        self.assertIn("issue.md:1: holds sentence 1 of suggestion 0f8fad5b context line 1 verbatim", out)
        self.assertNotIn("colours", out, "the match is located, never printed")
        self.assertNotIn("plan.md", out)

    def test_a_list_reply_with_several_suggestions(self):
        other = {**RECORD, "suggestion_id": "1e8fad5b-d9cb-469f-a165-70867728950e", "title": "A second invented suggestion title here"}
        code, out, _ = self.run_cli({"issue.md": "a second invented suggestion title here"}, {"suggestions": [RECORD, other]})
        self.assertEqual(code, 1)
        self.assertIn("suggestion 1e8fad5b title", out)

    def test_bad_arguments(self):
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(check_verbatim.main(["plan.md"]), 2)
            self.assertEqual(check_verbatim.main(["--suggestion", "/nonexistent/record.json", "plan.md"]), 2)
            self.assertEqual(check_verbatim.main(["--bogus", "x", "plan.md"]), 2)


if __name__ == "__main__":
    unittest.main()
