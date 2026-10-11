"""Regression lock for the research answer's shape: a Memorandum of Law, with internal notes.

The practitioner decided on 2026-10-05 that the audit agent writes the memo itself, with
a fixed five-field header and a CREAC body (IRAC or CRAC only when asked), and that its
internal notes (coverage line, confidence table, flags and offers) go to a scratchpad
through `research_filing__write_scratch`, never into the saved memo. Inventory and
note-up dispatches keep their own shapes.
"""
import unittest
from pathlib import Path


SHARED = Path(__file__).resolve().parents[2] / "shared"
HEADER = ["---", "Document: MEMORANDUM OF LAW", "From:", "To:", "Date:", "Re:", "---"]
CREAC = "`## Conclusion`, `## Rule`, `## Explanation`, `## Application`, `## Conclusion`"
BRIEF_BLOCK = """```
<criterion> — FOUND / GAP
  authority: <full citation>, <pinpoint>     (omit if GAP)
  source: case data / commons / 6. LAW <path>
  good law: noted up <date, source> / NOT NOTED UP
  confidence: <one line — what would change this>
```"""


def read(name):
    return (SHARED / name).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def between(text, start, end):
    begin = text.index(start)
    return text[begin:text.index(end, begin)]


def step_six():
    return between(read("legal-audit-protocol.md"), "### Step 6", "## Fallback ladder")


class ProtocolStepSixTests(unittest.TestCase):
    def test_memo_opens_with_the_five_field_header(self):
        lines = [line.strip() for line in step_six().splitlines()]
        start = lines.index("Document: MEMORANDUM OF LAW") - 1
        found = lines[start:start + len(HEADER)]
        self.assertEqual(len(found), len(HEADER))
        for expected, line in zip(HEADER, found):
            self.assertTrue(line.startswith(expected), f"{line!r} should start with {expected!r}")

    def test_body_is_creac_in_order(self):
        self.assertIn(CREAC, flat(step_six()))

    def test_irac_and_crac_only_after_memo_template(self):
        text = step_six()
        template = text.index("Memo template:")
        for word in ("IRAC", "CRAC"):
            self.assertIn(word, text)
            self.assertGreater(text.index(word), template, f"{word} is named before `Memo template:`")

    def test_application_uses_only_the_spawn_facts_and_defers_to_apply_to_facts(self):
        application = between(flat(step_six()), "Application compares", "Mixed coverage")
        self.assertIn("`Facts:`", application)
        self.assertIn("`/apply-to-facts`", application)
        self.assertIn("reaches no conclusion about the matter", application)

    def test_internal_notes_come_before_the_memo(self):
        text = step_six()
        self.assertLess(text.index("# Internal research notes"), text.index("Document: MEMORANDUM OF LAW"))
        self.assertIn("research_filing__write_scratch", text)

    def test_agent_saves_the_memo_to_scratch_and_names_the_path(self):
        text = flat(step_six())
        self.assertIn("also save the memo, from its `---` line to its last line and nothing else", text)
        self.assertIn("`<File stem> memo.md`", text)
        self.assertIn("`Memo scratch: <the path the tool returned>` between the notes and the memo's `---` line", text)
        self.assertIn("If the tool refuses, leave that line out", text)

    def test_memo_carries_no_confidence_table(self):
        self.assertIn("No coverage line and no confidence table anywhere in the memo", flat(step_six()))


class ScopedDispatchTests(unittest.TestCase):
    def test_step_six_is_opinion_mode_only(self):
        fields = flat(between(read("legal-audit-scoped.md"), "## The dispatch fields", "## Hard boundaries"))
        self.assertIn("Step 6", fields)
        self.assertIn("apply to opinion mode only", fields)
        self.assertIn("stay read-only", fields)

    def test_report_brief_template_block_is_unchanged(self):
        self.assertIn(BRIEF_BLOCK, read("legal-audit-scoped.md"))


class GateDoctrineTests(unittest.TestCase):
    def test_spawn_template_carries_the_memo_fields(self):
        template = between(read("legal-research.md"), "**Spawn the agent from this template.**",
                           "**A `needs_download` or hand-off-packet return")
        for field in ("Asked by:", "Date:", "Memo template:", "File stem:"):
            self.assertIn("\n" + field, template)

    def test_persist_step_one_saves_the_memo_and_not_the_confidence_summary(self):
        step_one = between(flat(read("legal-research.md")), "1. Save it verbatim", "2. For every court decision")
        self.assertIn("`<File stem>.md`", step_one)
        self.assertIn("research_filing__save_answer", step_one)
        self.assertNotIn("confidence summary", step_one)

    def test_persist_step_one_files_the_scratch_memo_and_types_text_only_without_one(self):
        step_one = between(flat(read("legal-research.md")), "1. Save it verbatim", "2. For every court decision")
        self.assertIn("When the return has a `Memo scratch:` line, pass that path as `from_scratch` and no `text`", step_one)
        self.assertIn("Only when the return has no such line, pass the memo as `text`", step_one)


if __name__ == "__main__":
    unittest.main()
