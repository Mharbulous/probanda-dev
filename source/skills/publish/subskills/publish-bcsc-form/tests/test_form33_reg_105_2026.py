"""Form 33 as substituted by B.C. Reg. 105/2026, and the 10-page limit advisory.

The template's response line names the notice by its date, its Rule 8-1(10)(b)(iv) hearing-date
paragraph is replaced by the emitter's sentence or removed on "Nil.", and a form over 10 pages
(the NOT FINAL cover not counted) gets an advisory, never a block.

Run: python -m pytest .claude/skills/publish/subskills/publish-bcsc-form/tests/test_form33_reg_105_2026.py -q
"""

import sys
import unittest
import zipfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from lxml import etree  # noqa: E402

from fill_ooxml import WN, _para_text  # noqa: E402
from fill_subs_form33 import HEARING_DATE_TEMPLATE, build_subs_form33  # noqa: E402
from fill_text import substitute_form33_position_sentences, substitute_text  # noqa: E402
from steps.shared.render import page_limit_advisories  # noqa: E402

TEMPLATE = SCRIPTS.parent / "templates" / "form-33.dotx"
AGREE = "The application respondent(s) agree to the applicant's hearing date of March 3, 2027."


def filled(ctx):
    body = etree.fromstring(zipfile.ZipFile(TEMPLATE).read("word/document.xml"))
    subs = build_subs_form33(ctx)
    substitute_form33_position_sentences(body, subs)
    substitute_text(body, subs)
    return [_para_text(p) for p in body.iter(WN("p"))]


class Form33Template(unittest.TestCase):
    def test_the_template_names_the_notice_by_its_date_and_holds_the_hearing_date_line(self):
        texts = filled({})
        self.assertIn("THIS IS A RESPONSE TO the notice of application of  dated .", texts)
        self.assertIn(HEARING_DATE_TEMPLATE, texts, "a Generate fill keeps the template's prompt")
        response = next(i for i, t in enumerate(texts) if t.startswith("THIS IS A RESPONSE TO"))
        self.assertEqual(texts[response + 1], HEARING_DATE_TEMPLATE)
        self.assertTrue(texts[response + 2].startswith("The application respondent(s) estimate(s)"))

    def test_the_notice_date_fills_only_the_response_line(self):
        texts = filled({"notice_dated": "August 1, 2026", "hearing_date": AGREE})
        self.assertIn("THIS IS A RESPONSE TO the notice of application of  dated August 1, 2026.", texts)
        self.assertTrue(any(t.endswith("made [date].") for t in texts), "Part 6's affidavit date stays a prompt")

    def test_the_hearing_date_sentence_replaces_the_prompt(self):
        texts = filled({"notice_dated": "August 1, 2026", "hearing_date": AGREE})
        self.assertIn(AGREE, texts)
        self.assertNotIn(HEARING_DATE_TEMPLATE, texts)

    def test_nil_removes_the_hearing_date_paragraph(self):
        texts = filled({"notice_dated": "August 1, 2026", "hearing_date": "Nil."})
        self.assertFalse(any("hearing date" in t for t in texts))


class PageLimit(unittest.TestCase):
    def test_ten_pages_with_or_without_the_cover_is_within_the_limit(self):
        self.assertEqual(page_limit_advisories("Form 33", "Rule 8-1(10)", 10, False), [])
        self.assertEqual(page_limit_advisories("Form 33", "Rule 8-1(10)", 11, True), [])

    def test_over_ten_pages_is_an_advisory_that_does_not_count_the_cover(self):
        [advisory] = page_limit_advisories("Form 32", "Rule 8-1(4)", 12, True)
        self.assertIn("Form 32 runs to 11 pages", advisory)
        self.assertIn("Rule 8-1(4)", advisory)


if __name__ == "__main__":
    unittest.main()
