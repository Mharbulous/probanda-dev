"""Pins the case brief: a structured Writing of eight parts with one source for its shape, written
by research-agent, checked by brief-reviewer, never of the working matter's own litigation, requested
only when the practitioner asks, and kept apart from research jobs and from the decision's own text.

Plan: docs/Plans/2026-11-01_legal-research-board-and-case-briefs.md

Run: python -m pytest source/skills/legal-research/tests/test_case_brief.py -q
"""

import json
import re
import sqlite3
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
REPO = SKILLS.parents[1]
TYPE = SKILLS / "legal-research" / "references" / "CAN" / "BC" / "_NoVenue" / "Documents" / "case-brief.md"
PARTS = ["Case", "Facts", "Procedural history", "Issues", "Holding", "Ratio decidendi", "Obiter dicta", "Disposition"]
SLOTS = ["case", "facts", "procedural-history", "issues", "holding", "ratio", "obiter", "disposition"]
TITLE = "Brief the case: "


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


class Shape(unittest.TestCase):
    def test_type_file_has_the_eight_parts_in_order(self):
        text = TYPE.read_text(encoding="utf-8")
        layout = json.loads(text[text.index("```json") + 7 : text.index("\n```", text.index("```json"))])
        self.assertEqual([p["heading"] for p in layout["parts"]], PARTS)
        self.assertEqual([p["source"] for p in layout["parts"]], [f"slot:{s}" for s in SLOTS])
        self.assertEqual(layout["parts"][0]["paragraph_numbering"], "none")
        self.assertTrue(all(p["paragraph_numbering"] == "continue" for p in layout["parts"][1:]))
        self.assertIn("shared/case-brief-template.md", text)

    def test_template_table_matches_the_type_file(self):
        template = read("shared", "case-brief-template.md")
        at = -1
        for part, slot in zip(PARTS, SLOTS):
            found = template.index(f"| {part} | `{slot}` |")
            self.assertGreater(found, at)
            at = found

    def test_kind_is_internal(self):
        kinds = json.loads(read("legal-research", "references", "CAN", "BC", "_NoVenue", "Documents", "kinds.json"))["kinds"]
        row = next(k for k in kinds if k["file"] == "case-brief")
        self.assertEqual(row["recipient"], "internal")
        self.assertEqual(row["aliases"], [{"name": "case_brief"}])

    def test_server_knows_the_kind_has_no_board(self):
        query = (REPO / "source" / "lawyer" / "mcp" / "src" / "submission" / "forms" / "query.ts").read_text(encoding="utf-8")
        self.assertIn('"case_brief"', query)


class Definition(unittest.TestCase):
    def test_never_of_the_matters_own_litigation(self):
        template = flat(read("shared", "case-brief-template.md"))
        self.assertIn("A decision in the working matter's own proceedings is never briefed", template)
        skill = flat(read("case-brief", "SKILL.md"))
        self.assertIn("Refuse the matter's own litigation", skill)
        self.assertIn("Never for a decision in the matter's own litigation", skill)
        reviewer = flat((REPO / "source" / "researcher" / "agents" / "brief-reviewer.md").read_text(encoding="utf-8"))
        self.assertIn('set `own_litigation` to true and stop', reviewer)
        self.assertIn("Skip a decision in the matter's own litigation", flat(read("drafting-data", "references", "jobs-stock.md")))

    def test_names_nothing_of_the_working_matter(self):
        self.assertIn("It names nothing of the working matter", read("shared", "case-brief-template.md"))
        self.assertIn("nothing of the working matter's facts", read("case-brief", "SKILL.md"))

    def test_says_it_is_not_noted_up(self):
        self.assertIn("`Not noted up by this brief.`", read("shared", "case-brief-template.md"))


class Who(unittest.TestCase):
    def test_research_agent_writes_it_from_the_template(self):
        protocol = flat(read("shared", "legal-audit-protocol.md"))
        self.assertIn("For `mode: case_brief`, fetch `shared/case-brief-template.md` and `case-brief/agents/brief.md`", protocol)
        self.assertIn("mode: case_brief", read("case-brief", "SKILL.md"))

    def test_reviewer_is_assigned_read_only_and_runs_before_the_save(self):
        assignment = json.loads((REPO / "source" / "assignment.json").read_text(encoding="utf-8"))
        self.assertIn("brief-reviewer", json.dumps(assignment["plugins"]["researcher"]["agents"]))
        front = (REPO / "source" / "researcher" / "agents" / "brief-reviewer.md").read_text(encoding="utf-8").split("---")[1]
        for tool in ("Read", "Write", "Edit", "Bash", "drafting_data"):
            self.assertNotIn(tool, front.split("tools:")[1])
        skill = read("case-brief", "SKILL.md")
        self.assertLess(skill.index("researcher:brief-reviewer"), skill.index("**Save it**"))
        self.assertIn("Save only after `brief-reviewer` returns `complete`", read("shared", "case-brief-template.md"))

    def test_model_invocable_so_work_can_hand_it_a_job(self):
        self.assertNotIn("disable-model-invocation", read("case-brief", "SKILL.md"))
        self.assertIn(f"| A case brief, its title opening `{TITLE}` | `/case-brief` |", read("work", "SKILL.md"))


class Jobs(unittest.TestCase):
    def test_requests_are_only_the_practitioners(self):
        stock = read("drafting-data", "references", "jobs-stock.md")
        section = stock[stock.index("## 3n. Case brief jobs") :]
        self.assertIn("**Requests are made only when the practitioner asks.**", section)
        self.assertIn(f"`{TITLE}<style of cause>, <citation>`", section)
        self.assertIn("under guard `authority_brief`", section)
        self.assertIn("('authorities', <the case's id>)", section)

    def test_server_holds_the_guard_and_the_fixed_text(self):
        forms = REPO / "source" / "lawyer" / "mcp" / "src" / "submission" / "forms"
        self.assertIn('BRIEF_JOB_PREFIX = "Brief the case: "', (forms / "brief-job.ts").read_text(encoding="utf-8"))
        self.assertIn("title.startsWith(BRIEF_JOB_PREFIX)", (forms / "take-job.ts").read_text(encoding="utf-8"))
        self.assertIn('"authority_brief"', (forms / "create-job.ts").read_text(encoding="utf-8"))

    def test_brief_jobs_are_no_research_jobs(self):
        self.assertIn("A case brief job, its title opening `Brief the case: `, is none", read("legal-research", "references", "research-board.md"))

    def test_completion_checks_a_brief_not_an_issue(self):
        self.assertIn("A case brief job has no Issue heading to compare", read("draft", "references", "job-session.md"))


class Reading(unittest.TestCase):
    """Both agents read the text the caller extracts, and a scanned page, through the narrow tool, on any host."""

    def test_the_caller_extracts_the_decision_for_both_agents(self):
        skill = flat(read("case-brief", "SKILL.md"))
        self.assertIn("Call `research_filing__law_folder_text` with the matter root, the file's folder as `destination_dir` and its name as `file`", skill)
        self.assertIn("Decision text: <the text_path, or none>", read("case-brief", "SKILL.md"))
        self.assertIn("with the same `Matter root:`, `Decision:` and `Decision text:` lines", skill)
        self.assertIn("A `Decision text:` path is the decision's text", read("case-brief", "agents", "brief.md"))

    def test_nothing_is_staged_and_no_manifest_passes(self):
        for text in (read("case-brief", "SKILL.md"), read("case-brief", "agents", "brief.md")):
            for gone in ("device_stage_files", "pdf_pages__images", "manifest"):
                self.assertNotIn(gone, text)
        for agent in ("brief-reviewer", "research-agent"):
            text = (REPO / "source" / "researcher" / "agents" / f"{agent}.md").read_text(encoding="utf-8")
            self.assertNotIn("Page manifest", text, agent)

    def test_a_scanned_page_is_read_only_from_its_images(self):
        self.assertIn("each scanned page only from its images", read("case-brief", "SKILL.md"))
        self.assertIn("Read a page given as images only from those images", read("case-brief", "agents", "brief.md"))

    def test_the_reviewer_reads_only_through_the_narrow_tool_and_only_the_decision(self):
        reviewer = flat((REPO / "source" / "researcher" / "agents" / "brief-reviewer.md").read_text(encoding="utf-8"))
        self.assertIn("A `Decision text:` path is its text: read that file", reviewer)
        self.assertIn("Read a page given as images only from those images", reviewer)
        self.assertIn("You never list a folder or open any other file", reviewer)

    def test_the_search_for_the_decision_reaches_subfolders(self):
        skill = flat(read("case-brief", "SKILL.md"))
        self.assertIn("Look through `6. LAW` and every folder under it", skill)
        self.assertIn("`device_list_dir`", skill)
        self.assertNotIn("List the matter's `6. LAW` folder with `research_filing__list_law_folder`", skill)


class Scratch(unittest.TestCase):
    def test_the_spawn_prompt_gives_write_scratch_its_matter_root(self):
        prompt = read("case-brief", "SKILL.md")
        self.assertIn("   Matter root: <", prompt[prompt.index("mode: case_brief") : prompt.index("Review: <brief-reviewer's")])
        self.assertIn("with the spawn prompt's `Matter root:` as `matter_root`", flat(read("shared", "case-brief-template.md")))


class Dispatch(unittest.TestCase):
    def test_case_brief_reads_neither_the_scoped_file_nor_the_protocols_boundaries(self):
        protocol = flat(read("shared", "legal-audit-protocol.md"))
        brief_at = protocol.index("**Case brief dispatch.**")
        self.assertLess(brief_at, protocol.index("You write nothing except"))
        self.assertLess(brief_at, protocol.index("**Scoped dispatch.**"))
        self.assertIn("never this file, its Hard boundaries or `shared/legal-audit-scoped.md`", protocol)
        self.assertIn("names any other `mode:`, or `report:`, fetch `shared/legal-audit-scoped.md`", protocol)
        self.assertIn("never for `mode: case_brief`", flat(read("shared", "legal-audit-scoped.md")))
        self.assertIn("The scratch copy is your one write", read("case-brief", "agents", "brief.md"))


class NoneIsNoItem(unittest.TestCase):
    def test_none_needs_no_pinpoint_row_or_passage(self):
        template = flat(read("shared", "case-brief-template.md"))
        self.assertIn("`None.`, which is no item of law", template)
        self.assertIn("item but a `None.` has this form", template)
        self.assertIn("item `n` but a `None.`, `INSERT", template)
        self.assertIn("a `None.` written as it is", template)
        reviewer = flat((REPO / "source" / "researcher" / "agents" / "brief-reviewer.md").read_text(encoding="utf-8"))
        self.assertIn("A `None.` is no item of law", reviewer)


class Presenting(unittest.TestCase):
    def test_a_review_that_failed_is_said_in_plain_words(self):
        skill = flat(read("case-brief", "SKILL.md"))
        self.assertIn("say in plain words that the brief could not be checked", skill)
        self.assertNotIn("relay it verbatim", skill)

    def test_the_page_is_named_only_when_it_exists(self):
        template = flat(read("shared", "case-brief-template.md"))
        self.assertIn('Once the file is saved, `drafting_forms__render` again with the same Writing, `documents: ["Work_board"]` and `draft_dir`', template)
        self.assertLess(template.index("`research_filing__save_answer` with that document's"), template.index("**Page.**"))
        skill = flat(read("case-brief", "SKILL.md"))
        self.assertIn("When it returned none, the matter holds nothing but research results", skill)
        self.assertIn("once the matter has a filing, a letter or other work besides its research", skill)
        self.assertNotIn("once the matter has a Writing", skill)

    def test_a_failed_write_is_said_in_plain_words_too(self):
        skill = flat(read("case-brief", "SKILL.md"))
        self.assertIn("A return with no `Brief scratch:` line saves nothing", skill)
        self.assertEqual(skill.count("Never pass on the return's text"), 2)

    def test_the_return_lines_agree(self):
        template = read("shared", "case-brief-template.md")
        self.assertIn("Divergence: <one line, only when", template)
        self.assertIn("When it can write nothing, it returns instead the one line that file gives", template)
        brief = read("case-brief", "agents", "brief.md")
        self.assertIn("Name a divergence in the `Divergence:` line of your return", brief)
        self.assertIn("You never return `needs_download`", brief)
        self.assertIn("held a `Divergence:` line", read("case-brief", "SKILL.md"))


class Finding(unittest.TestCase):
    def test_a_note_up_record_is_not_the_decision(self):
        self.assertIn("`memo` or `note-up` cites the decision and is not its text", read("case-brief", "SKILL.md"))

    def test_tools_take_host_paths_not_mounted_ones(self):
        self.assertIn("A mounted path is only for looking", read("case-brief", "SKILL.md"))

    def test_a_refusal_to_extract_stops_the_brief(self):
        self.assertIn("or a refusal such as an HTML page with no text file beside it, means the decision cannot be read", read("case-brief", "SKILL.md"))


class Saving(unittest.TestCase):
    def test_a_stem_is_cleaned_to_a_file_name(self):
        self.assertIn("It is a file name, so each", flat(read("shared", "case-brief-template.md")))

    def test_an_incomplete_save_is_repaired_not_filed_from_scratch(self):
        self.assertIn("A save refused `brief_incomplete` is a script that missed a slot", flat(read("shared", "case-brief-template.md")))

    def test_a_saved_brief_is_looked_for_through_the_whole_law_tree(self):
        template = flat(read("shared", "case-brief-template.md"))
        self.assertIn("with no board, look through `6. LAW` and every folder under it by `case-brief/SKILL.md` step 3's route", template)
        self.assertNotIn("or `research_filing__list_law_folder` with no board", template)

    def test_a_re_brief_saves_beside_the_brief_it_reuses(self):
        self.assertIn("numbered only within one folder, so its `destination_dir` is the folder holding that brief", flat(read("shared", "case-brief-template.md")))

    def test_a_re_brief_of_a_sent_or_retired_writing_leaves_it_alone(self):
        self.assertIn("When that title's only Writing has `filed_on` or `retired_on` set, leave it and its statements as they are", flat(read("shared", "case-brief-template.md")))

    def test_the_spawn_prompt_defers_the_stem_to_the_template(self):
        self.assertIn('File stem: <the stem the template\'s "Saving it" chooses', read("case-brief", "SKILL.md"))


class NotTheDecision(unittest.TestCase):
    def test_a_brief_is_not_taken_for_the_decision(self):
        self.assertIn("`*case brief*`", read("drafting-data", "references", "locate-authority.md"))
        self.assertIn("never the decision: never ingest one", flat(read("shared", "legal-research.md")))
        self.assertIn("Never ingest a brief", read("shared", "case-brief-template.md"))
        self.assertIn("A file named `case brief`", read("case-brief", "SKILL.md"))

    def test_a_note_up_is_skipped_when_locating_an_authority(self):
        self.assertIn("`*case brief*`, `*note-up*` or `*memo*`", read("drafting-data", "references", "locate-authority.md"))


class Guard(unittest.TestCase):
    def test_the_guard_is_described_by_the_case_not_one_authority(self):
        self.assertIn("scoped to any authority of the same case anywhere in the proceeding", read("drafting-data", "references", "jobs-stock.md"))
        schema = (REPO / "source" / "lawyer" / "mcp" / "src" / "schema" / "submission-data.ts").read_text(encoding="utf-8")
        self.assertIn("is scoped to any authority of the same case", schema)
        self.assertNotIn("scoped to the one authority in scope", schema)
        self.assertIn("so parallel citations fold", read("drafting-data", "references", "jobs-stock.md"))


RESEARCH = "'research_memo', 'research_memo_irac', 'research_memo_creac', 'case_brief'"


class NoBoardOfItsOwn(unittest.TestCase):
    """The board-choosing reads the skill gives, run against a matter that has research Writings."""

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript(read("drafting-data", "references", "schema.sql"))
        self.db.executescript(
            """
            INSERT INTO proceedings (id, matter_reference) VALUES (1, 'M'), (2, 'M'), (3, 'M'), (4, 'M');
            INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on) VALUES (3, 1, NULL, 'c', 'reply', '2026-10-01');
            -- 1: a memo beside a letter. 2: live and retired memos only. 3: nothing. 4: only a retired brief.
            INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES
              (3, 1, 'research_memo', 'Memo', 0), (7, 1, 'letter', 'Letter', 0),
              (20, 2, 'research_memo', 'Retired memo', 0), (21, 2, 'case_brief', 'Brief', 0),
              (40, 4, 'case_brief', 'Retired brief', 0);
            INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on) VALUES (1, 1, 3, 'a', 'reply', '2026-10-01'), (2, 1, 7, 'b', 'reply', '2026-10-01');
            UPDATE filings SET retired_on = '2026-10-01', retirement_reason = 'other' WHERE id IN (20, 40);
            """
        )
        self.checklists = read("drafting-data", "references", "filing-checklists.md")

    def block_after(self, heading):
        return re.search(r"```sql\n(.*?)```", self.checklists[self.checklists.index(heading):], re.S).group(1)

    def test_the_boards_read_offers_no_research_writing_and_keeps_a_memo_only_proceedings_board(self):
        writings, proceedings = [s for s in self.block_after("**The matter's boards.**").split(";") if s.strip()]
        self.assertEqual([r[0] for r in self.db.execute(writings)], [7])
        self.assertEqual([(r[0], r[3]) for r in self.db.execute(proceedings)], [(2, 21), (3, None), (4, None)])

    def test_a_writings_board_reads_rows_naming_a_research_writing_as_the_proceedings(self):
        read_rows = self.block_after("**Read a board's attachments**")
        self.assertEqual([r[0] for r in self.db.execute(read_rows)], [1, 2, 3])

    def test_the_guard_sentence_keeps_a_memo_only_proceedings_board(self):
        self.assertIn("One holding only research memos or case briefs still has", self.checklists)
        self.assertNotIn("a proceeding with any Writing, live or retired, has no board of its own", self.checklists)

    def test_a_thread_on_a_research_writing_goes_on_the_proceeding(self):
        run = read("drafting-data", "references", "jobs-run.md")
        self.assertIn("A retired Writing has no Work Board page, and neither has a research memo or case brief", run)
        select = re.search(r"that board, `(SELECT .*?)`, the file's stored path", run).group(1)
        self.assertEqual(self.db.execute(select, ("a",)).fetchall(), [(1, None)])
        self.assertEqual(self.db.execute(select, ("b",)).fetchall(), [(1, 7)])

    def test_the_picker_offers_none_as_a_board(self):
        self.assertIn("A research memo or case brief is no card, live or retired", read("draft", "references", "filing-picker.md"))

    def test_the_lists_name_every_kind_the_server_treats_as_research(self):
        query = (REPO / "source" / "lawyer" / "mcp" / "src" / "submission" / "forms" / "query.ts").read_text(encoding="utf-8")
        self.assertIn(RESEARCH.replace("'", '"'), query)
        self.assertIn(RESEARCH, self.checklists)


class SavedBriefLookup(unittest.TestCase):
    def test_step_six_looks_for_a_saved_brief(self):
        self.assertIn("after looking for the case's saved briefs", read("case-brief", "SKILL.md"))

    def test_a_refusal_is_relayed_in_plain_words(self):
        self.assertIn("say in your relay, in plain words, what was refused", flat(read("shared", "case-brief-template.md")))


class PointerToThePlan(unittest.TestCase):
    def test_the_old_spec_points_to_the_plan_and_the_plan_is_built(self):
        spec = (REPO / "docs" / "Specs" / "2026-10-31_legal-memos-board.md").read_text(encoding="utf-8")
        self.assertIn("docs/Plans/2026-11-01_legal-research-board-and-case-briefs.md", spec)
        plan = (REPO / "docs" / "Plans" / "2026-11-01_legal-research-board-and-case-briefs.md").read_text(encoding="utf-8")
        self.assertTrue(plan.split("\n")[2].startswith("Status: released"))


if __name__ == "__main__":
    unittest.main()
