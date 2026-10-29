"""Regression lock for the research answer's shape: a Memorandum of Law, with internal notes.

The practitioner decided on 2026-10-05 that the audit agent writes the memo itself, and
that its internal notes (coverage line, confidence table, flags and offers) go to a
scratchpad through `research_filing__write_scratch`, never into the saved memo. On
2026-10-15 the header and body skeletons moved to `shared/research-memo-template.md`, with
a fuller header and a CRAC body (IRAC or CREAC only when asked), and the agent returns
`Confidence:`, `Notes scratch:` and `Memo scratch:` lines instead of the memo's text.
Inventory and note-up dispatches keep their own shapes.
"""
import unittest
from pathlib import Path


SHARED = Path(__file__).resolve().parents[2] / "shared"
HEADER = ["---", "Document: MEMORANDUM OF LAW", "From:", "Date:", "Re:", "Format:", "Confidence:", "---"]
ICRA = "```\n## Issue\n## Conclusion\n## Rule\n## Application\n```"
IRAC = "```\n## Issue\n## Rule\n## Application\n## Conclusion\n```"
CREAC = "```\n## Issue\n## Conclusion\n## Rule\n## Explanation\n## Application\n## Conclusion\n```"
BRIEF_BLOCK = """```
<criterion> — FOUND / GAP
  authority: <full citation>, <pinpoint>     (omit if GAP)
  source: case data / commons / 6. LAW <path>
  note-up: <date, source> / NOT NOTED UP
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
    def test_memo_opens_with_the_template_header(self):
        self.assertIn("Fetch `shared/research-memo-template.md`", flat(step_six()))
        lines = [line.strip() for line in read("research-memo-template.md").splitlines()]
        start = lines.index("Document: MEMORANDUM OF LAW") - 1
        found = lines[start:start + len(HEADER)]
        self.assertEqual(len(found), len(HEADER))
        for expected, line in zip(HEADER, found):
            self.assertTrue(line.startswith(expected), f"{line!r} should start with {expected!r}")

    def test_header_names_no_matter_practitioner_or_privilege(self):
        template = read("research-memo-template.md")
        header = template[template.index("Document: MEMORANDUM OF LAW"):template.index("\n---", template.index("Format:"))]
        for key in ("Matter:", "To:", "Privilege:"):
            self.assertNotIn("\n" + key, "\n" + header)

    def test_body_is_icra_in_order(self):
        template = read("research-memo-template.md")
        self.assertIn("**ICRA**, the default:\n\n" + ICRA, template)
        self.assertNotIn("CRAC", template)
        self.assertIn(IRAC, template)
        self.assertIn(CREAC, template)

    def test_body_closes_with_one_sources_section_in_order(self):
        template = read("research-memo-template.md")
        order = [template.index(h) for h in ("## Sources\n\n### Statutes\n", "### Case authority\n",
                                             "### Secondary sources\n")]
        self.assertEqual(order, sorted(order))
        self.assertNotIn("Authorities", template)
        self.assertNotIn("Question presented", template)

    def test_issue_conclusion_rule_and_application_forms(self):
        template = flat(read("research-memo-template.md"))
        for text in ("The Issue is the question, as one bold sentence.",
                     "A Conclusion is one paragraph answering the Issue,",
                     "Conclusion. It cites in parentheses and has no block quote.",
                     "The Rule opens with the rule itself.",
                     "The Application is prose paragraphs, never bullets."):
            self.assertIn(text, template)

    def test_irac_and_creac_only_when_asked(self):
        self.assertIn("The body uses ICRA unless the spawn prompt's `Memo template:` names IRAC or CREAC.",
                      flat(step_six()))
        template = read("research-memo-template.md")
        for word in ("IRAC", "CREAC"):
            self.assertIn(f"**{word}**, only when the spawn prompt's `Memo template:` names it:", template)

    def test_memo_states_nothing_of_the_working_matter(self):
        rules = between(flat(step_six()), "In every format the memo is generic and has no Facts section.",
                        "The Conclusion answers as Step 4 says")
        self.assertIn("The spawn prompt's `Facts:`, `Matter:`, `Asked by:` and `Origin:` only choose authorities "
                      "and route the work: the memo never states, summarises or alludes to them.", rules)
        self.assertIn("No part of the memo holds a party name, date, amount, matter number, document name or fact pattern",
                      rules)
        self.assertIn("Application describes only the facts of the cited authorities.", rules)
        self.assertNotIn("matter's own facts", flat(step_six()))

    def test_internal_notes_come_before_the_memo(self):
        text = step_six()
        self.assertLess(text.index("# Internal research notes"), text.index("Document: MEMORANDUM OF LAW"))
        self.assertIn("research_filing__write_scratch", text)

    def test_agent_saves_the_memo_to_scratch_and_names_the_path(self):
        text = flat(step_six())
        self.assertIn("also save the memo, from its `---` line to its last line and nothing else", text)
        self.assertIn("`<File stem> memo.md`", text)
        self.assertIn("Memo scratch: <the path the tool returned for the memo>", text)
        self.assertIn("If the tool refuses either save, leave that file's line out, give its refusal code, "
                      "and return that section in full in its place: the notes before the memo, "
                      "and the memo from its `---` line to its end.", text)

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

    def test_a_note_up_is_never_labelled_good_law(self):
        for name in ("legal-audit-protocol.md", "legal-audit-scoped.md"):
            self.assertNotIn("good law: noted up", read(name))
            self.assertIn("verified memo named with its date", flat(read(name)))


class ConfidenceTableTests(unittest.TestCase):
    def test_validity_and_reliability_name_their_basis(self):
        step_three = flat(between(read("legal-audit-protocol.md"), "### Step 3", "### Step 4"))
        self.assertIn("| Validity (treatment it rests on) | Reliability (citator run) |", step_three)
        self.assertEqual(step_three.count('Never a bare "Yes"'), 2)
        self.assertIn("unverified pool record", step_three)
        self.assertIn("the number of citing cases, and how many of them were read", step_three)


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
