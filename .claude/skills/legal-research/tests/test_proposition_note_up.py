"""Regression lock: a proposition-level note-up is asked for by paragraph number and is tracked work.

Spec 2026-10-31 case-level note-up and DRAFT memo status, §12 criterion 4: "Note up the
propositions in paragraphs N and M" writes one job naming exactly those paragraphs through
/drafting-data §3k, one step per paragraph keyed to its stored item, and an authority the memo
relies on produces no `kind: note-up` offer.
"""
import unittest
from pathlib import Path


SKILLS = Path(__file__).resolve().parents[2]


def read(path):
    return (SKILLS / path).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def between(text, start, end):
    begin = text.index(start)
    return text[begin:text.index(end, begin)]


class PropositionNoteUpTests(unittest.TestCase):
    def test_front_door_routes_the_request_to_the_gate_section(self):
        self.assertIn('follow `shared/legal-research.md`, "Proposition-level note-up"',
                      flat(read("legal-research/SKILL.md")))

    def test_gate_section_names_the_paragraphs_and_hands_the_job_to_3k(self):
        section = between(flat(read("shared/legal-research.md")), "**Proposition-level note-up.**",
                          "**Statute currency.**")
        self.assertIn("name exactly those paragraphs", section)
        self.assertIn('§3k, "A research memo\'s paragraphs"', section)
        self.assertIn("without it, run the steps here and say no job was written", section)
        self.assertIn("only once every item citing it has a proposition-level note-up", section)
        self.assertIn("Note up paragraphs: <the saved memo's path>: <n>[, <n>] / none",
                      read("shared/legal-research.md"))

    def test_3k_writes_one_step_per_paragraph_keyed_to_its_item(self):
        note_up = read("drafting-data/references/jobs-create.md").split("## 3k. The note-up job", 1)[1]
        rule = flat(between(note_up, "**A research memo's paragraphs.**", "**Working and closing it.**"))
        self.assertIn("`Note up the propositions in paragraphs <n>, <m>`", rule)
        self.assertIn("One step per paragraph, `Note up at proposition level: paragraph <n>, <citation>`", rule)
        self.assertIn("`('statements_of_law', <the id its line ends with>)`", rule)
        self.assertIn("No `ticket_proposals` row.", rule)

    def test_a_relied_on_authority_gets_no_note_up_offer(self):
        step_five = flat(between(read("shared/legal-audit-protocol.md"), "### Step 5", "### Step 6"))
        self.assertIn("An authority the memo relies on gets no note-up offer", step_five)
        self.assertIn("noting up an authority the memo does not rely on", step_five)
        self.assertNotIn("only through a citator's list of citing cases", step_five)

    def test_the_agent_updates_the_named_paragraphs_in_place(self):
        step_two = flat(between(read("shared/legal-audit-protocol.md"), "For every authority you intend to rely on",
                                "### Step 3"))
        self.assertIn("each paragraph the spawn prompt's `Note up paragraphs:` names", step_two)
        self.assertIn("keep its items and their numbers", step_two)
        self.assertIn("update Validity, the `Audit:` line, the CanLII segment and Status", step_two)

    def test_the_read_is_capped_and_run_by_the_gate(self):
        section = between(flat(read("shared/legal-research.md")), "**Proposition-level note-up.**",
                          "**Statute currency.**")
        self.assertIn("choose at most 5 citing decisions", section)
        self.assertIn("no more than 3 at once per authority", section)
        self.assertNotIn("every citing decision", section)
        scoped = flat(between(read("shared/legal-audit-scoped.md"), "## `mode: citing_read`", "## Hard boundaries"))
        self.assertIn("one instance per decision or 20 pages", scoped)
        self.assertIn("each with the page after it", scoped)
        self.assertIn("never that the decision does not cite the authority", scoped)
        step_two = flat(between(read("shared/legal-audit-protocol.md"), "For every authority you intend to rely on",
                                "### Step 3"))
        self.assertNotIn("every citing decision", step_two)

    def test_the_record_is_capped_and_says_so(self):
        keycite = flat(read("shared/citation-checker/keycite-canada.md"))
        self.assertNotIn("Record every row", keycite)
        self.assertIn("Record at most 5 rows", keycite)
        self.assertIn("`not recorded: <the control> would not apply`, never as `none`", keycite)
        self.assertIn("A note-up never decides which labels are negative", keycite)
        record = read("shared/citation-checker/note-up.md")
        self.assertIn("Not recorded: cap 5, newest first", record)
        self.assertIn("Not recorded: cap 5, newest by neutral citation", record)
        self.assertNotIn("<citation> | <title> | <date>", record)


AGENTS = SKILLS.parents[1] / "source" / "researcher" / "agents"


def granted_tools(path):
    front = path.read_text(encoding="utf-8").split("---")[1]
    return [line.strip()[2:] for line in front.split("tools:")[1].split("skills:")[0].splitlines()
            if line.strip().startswith("- ")]


class CitatorFactsAreReturnedNotFiledTests(unittest.TestCase):
    """Plan 2026-11-06: citation-checker returns its citator lines, nothing citator-made is saved,
    and a case brief's Ratio item carries its own per-principle Treatment block."""

    def test_the_playbook_files_nothing(self):
        playbook = read("shared/citation-checker/note-up.md")
        self.assertNotIn("save_answer", playbook)
        self.assertNotIn("# Note-up record", playbook)
        self.assertNotIn("**Pool record.**", playbook)
        self.assertNotIn("treatment_chain", playbook)
        self.assertNotIn("Export:", playbook)
        self.assertIn("## The return", playbook)
        self.assertIn('"retrieved": "YYYY-MM-DD"', playbook)
        self.assertNotIn('"filename"', playbook)
        self.assertNotIn("## 6. Export", read("shared/citation-checker/keycite-canada.md"))

    def test_the_agent_can_neither_save_nor_read_the_pool(self):
        tools = granted_tools(AGENTS / "citation-checker.md")
        self.assertEqual([t for t in tools if "save_answer" in t or "legal_commons__" in t
                          or "list_law_folder" in t], [])
        self.assertIn("mcp__plugin_lawyer_data__research_filing__append_manifest", tools)
        self.assertIn("mcp__remote-devices__plugin_lawyer_data__research_filing__append_manifest", tools)
        self.assertNotIn("record path", read_agent("citation-checker.md"))

    def test_the_gate_carries_the_lines_not_a_path(self):
        gate = read("shared/legal-research.md")
        self.assertIn("Note-up: <citation>: <citation-checker's lines for it>", gate)
        self.assertNotIn("record <path>", gate)
        self.assertNotIn("note-up record", gate)

    def test_the_citing_decision_choice_skips_mentions(self):
        section = between(flat(read("shared/legal-research.md")), "**Proposition-level note-up.**",
                          "**Statute currency.**")
        self.assertIn("Treatment label is neither `Mentioned` nor `Referred to`", section)
        self.assertIn("only when KeyCite did not run", section)
        self.assertIn("`/case-brief` step 6 with `Note up items:`", section)

    def test_a_citing_read_is_for_the_pinpoint(self):
        scoped = flat(between(read("shared/legal-audit-scoped.md"), "## `mode: citing_read`", "## Hard boundaries"))
        self.assertIn("`Pinpoint:` its pinpoint in the authority", scoped)
        self.assertIn("`cited for another point`", scoped)

    def test_the_template_defines_the_treatment_block(self):
        template = flat(read("shared/case-brief-template.md"))
        self.assertIn("### A Treatment block", read("shared/case-brief-template.md"))
        self.assertIn("Treatment, noted up <YYYY-MM-DD>: <verdict>", template)
        for verdict in ("`no citing decision engaged it`", "`followed or applied`",
                        "`distinguished, limited or doubted`", "`not followed or overruled`"):
            self.assertIn(verdict, template)
        self.assertIn("**A note-up** replaces the item's block, and changes nothing else", template)
        self.assertIn('never as "good law" generally', template)
        self.assertNotIn("never whether it is still good law", template)
        self.assertIn("**`Not read`** is a count, never a list", template)

    def test_the_brief_agent_and_skill_carry_the_note_up(self):
        self.assertIn("## Noting up an item", read("case-brief/agents/brief.md"))
        skill = read("case-brief/SKILL.md")
        for line in ("Note up items: <", "Brief: <the saved brief's host path", "Citator: <", "Citing reads: <"):
            self.assertIn(line, skill)
        self.assertIn("`Citing decisions:`", skill)

    def test_the_reviewer_checks_treatment(self):
        reviewer = read_agent("brief-reviewer.md")
        self.assertIn('"treatment": [', reviewer)
        self.assertIn("6. For each Treatment block", reviewer)
        self.assertIn("the paths on `Citing decisions:`", reviewer)


def read_agent(name):
    return (AGENTS / name).read_text(encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
