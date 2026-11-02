"""Pins the memo-reviewer loop: the audit opens Step 4 with the scope test and ends an incomplete
memo's Conclusion with the open-issues paragraph; memo-reviewer is a read-only Opus agent that
returns strict JSON and ships in researcher; and the gate reviews every memo after the held-job
rule and before it persists, sends back required research and working-matter identifiers, never
edits the memo, and invites no further memo.

Run: python .claude/skills/legal-research/tests/test_memo_reviewer.py
"""

import json
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
SKILLS = REPO / ".claude" / "skills"
AGENT = REPO / "source" / "researcher" / "agents" / "memo-reviewer.md"


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def between(text, start, end):
    begin = text.index(start)
    return text[begin:text.index(end, begin)]


class ScopeTestTest(unittest.TestCase):
    def test_step_four_opens_with_the_scope_test(self):
        step_four = flat(between(read("shared", "legal-audit-protocol.md"), "### Step 4", "### Step 5"))
        self.assertTrue(step_four.startswith("### Step 4 — Disclosure gate **The scope test.** Research is required "
                                             "only if the Issue, as framed, cannot be answered without it."))
        self.assertIn("Never call it required and never say more research is needed on it.", step_four)
        self.assertIn("A spawn prompt's `Review:` line is memo-reviewer's verdict on your last memo", step_four)

    def test_no_closed_gate_and_no_sub_issues_left(self):
        paths = list((SKILLS / "shared").rglob("*.md")) + [
            SKILLS / "legal-research" / "SKILL.md", SKILLS / "legal-research" / "references" / "research-board.md",
            AGENT]
        for path in paths:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("More research is needed before I can give", text, path.name)
            self.assertNotIn("### Sub-issue", text, path.name)
        research = [SKILLS / "shared" / name for name in ("legal-research.md", "legal-audit-protocol.md",
                                                         "research-memo-template.md", "job-planning.md")] + paths[-3:]
        for path in research:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("closed gate", text, path.name)
            self.assertNotIn("internal checklist", text, path.name)
            self.assertNotIn("every sub-issue", text, path.name)

    def test_review_line_forbids_retrieval_and_a_rewrite_reruns_nothing(self):
        step_four = flat(between(read("shared", "legal-audit-protocol.md"), "### Step 4", "### Step 5"))
        self.assertIn("cut each `out_of_scope` and `identifiers` passage from the memo, and rewrite each `findings` "
                      "item as one finding or cut the item.", step_four)
        self.assertIn("With any `Review:` but `none`, return no `needs_download` or `needs_note_up`.", step_four)
        self.assertIn("A `Review:` with no `required` item asks only for a rewrite: rewrite the memo from the sources "
                      "already held, without re-running the audit.", step_four)
        self.assertNotIn("tiers not run: none", step_four)

    def test_memo_is_generic_throughout(self):
        protocol = flat(read("shared", "legal-audit-protocol.md"))
        self.assertIn("In every format the memo is generic and has no Facts section.", protocol)
        self.assertIn("No part of the memo holds a party name, date, amount, matter number, document name or fact "
                      "pattern of the working matter.", protocol)

    def test_template_confidence_and_conclusion(self):
        template = flat(read("shared", "research-memo-template.md"))
        self.assertIn('Confidence: "<one line: for the Issue,', template)
        self.assertIn('/ "INCOMPLETE: <the research named>"', template)
        self.assertNotIn("per issue", template)
        self.assertIn("A Conclusion is one paragraph answering the Issue, followed, only where research is required "
                      "(`shared/legal-audit-protocol.md` Step 4), by the open-issues paragraph", template)


class AgentContractTest(unittest.TestCase):
    def setUp(self):
        self.agent = AGENT.read_text(encoding="utf-8")
        self.front = self.agent.split("---")[1]

    def test_frontmatter(self):
        self.assertIn("name: memo-reviewer", self.front)
        self.assertIn("model: opus", self.front)
        # No Read: the body reads only through skill_source__read. No preloaded skill: the
        # legal-research front door stops any agent without the Agent tool.
        self.assertIn("tools:\n  - mcp__plugin_lawyer_data__skill_source__read\n"
                      "  - mcp__remote-devices__plugin_lawyer_data__skill_source__read\nskills: []\n", self.front)
        self.assertNotIn("  - Read\n", self.front)

    def test_reviews_the_numbered_items_and_names_each_by_number(self):
        body = flat(self.agent)
        self.assertIn("its prose sections and its numbered items, each one proposition or finding", body)
        self.assertIn("quote words from a numbered item as `¶<n>: <its words>`", body)

    def test_review_rules(self):
        body = flat(self.agent)
        self.assertIn("Research already run is never `required`", body)
        self.assertIn("in one of the tier forms of Step 4's `gap:` line", body)
        self.assertIn("Yes, and the memo itself raises it: an `out_of_scope` item, quoting the memo's words.", body)
        self.assertIn("Yes, and only a `gap:` line or a Step 5 offer raises it: nothing.", body)
        self.assertIn("The verdict is `send_back` when `required`, `out_of_scope`, `identifiers` or `findings` holds "
                      "anything", body)
        self.assertIn("Quote each Application item that holds more than one finding, or that is neither a finding of "
                      "fact nor the law applied to the facts by that item's court", body)

    def test_a_label_style_issue_is_sent_back(self):
        # A job's Issue copied from a label-style title ("Limitation period for the claim") holds
        # no question, so it fails rule A. Step 1 tests the Issue, whatever its source, as an
        # `identifiers` item, which the verdict rule turns into `send_back`; nothing exempts the
        # Job question's text from step 3 either.
        body = flat(self.agent)
        self.assertIn("1. Test the memo's Issue by the template's rules A to D, whatever its source: an Issue that "
                      "fails one is an `identifiers` item, `Issue: <its words>`.", body)
        self.assertNotIn("Never flag text equal to", body)
        template = flat(read("shared", "research-memo-template.md"))
        self.assertIn("**A.** holds one question;", template)
        self.assertIn("the Issue is that question verbatim if it meets rules A to D. If not, return no memo but one "
                      "rewording proposal", template)

    def test_body_is_procedure_and_contract(self):
        for key in ('"verdict"', '"required"', '"out_of_scope"', '"identifiers"', '"findings"'):
            self.assertIn(key, self.agent)
        self.assertIn("`shared/legal-audit-protocol.md`", self.agent)
        self.assertIn("`shared/research-memo-template.md`", self.agent)
        self.assertIn("halt and return `rules unavailable: <the error>`", self.agent)
        self.assertIn("You state no law.", self.agent)
        self.assertIn("You write nothing.", self.agent)
        self.assertNotIn("canlii", self.agent.lower())

    def test_ships_in_researcher(self):
        assignment = json.loads((REPO / "source" / "assignment.json").read_text(encoding="utf-8"))
        self.assertIn("memo-reviewer", assignment["plugins"]["researcher"]["agents"])


class GateLoopTest(unittest.TestCase):
    def setUp(self):
        self.text = read("shared", "legal-research.md")
        self.rule = flat(between(self.text, "**memo-reviewer checks every memo before it is saved.**",
                                 "Persist in this order."))

    def test_loop_sits_after_the_held_job_rule_and_before_persisting(self):
        held = self.text.index("**On a held job, an open tier is not an answer.**")
        review = self.text.index("**memo-reviewer checks every memo before it is saved.**")
        self.assertLess(held, review)
        self.assertLess(review, self.text.index("Persist in this order."))

    def test_send_backs_and_the_bound(self):
        self.assertIn("Spawn `researcher:memo-reviewer` on every return that carries a memo", self.rule)
        self.assertIn("It reviews one question at most three times.", self.rule)
        self.assertIn("re-invoke the agent with `Review:` the reviewer's JSON", self.rule)
        self.assertIn("`send_back` with `identifiers` or `out_of_scope` items: to rewrite the memo without them.",
                      self.rule)
        self.assertIn("`send_back` with `findings` items: to rewrite each as one finding, or cut the item.", self.rule)
        self.assertIn("When the third review accepts nothing, re-invoke the agent once with it to write the memo "
                      "`INCOMPLETE`, naming what that review still asks, and save that return.", self.rule)
        held = flat(between(self.text, "**On a held job, an open tier is not an answer.**",
                            "**memo-reviewer checks every memo before it is saved.**"))
        self.assertIn("re-invoke the same agent with `Re-invocation: yes` and `Review:`", held)

    def test_every_save_follows_an_accepting_review(self):
        self.assertIn("Save a return only once a review accepts it: `complete`, or a "
                      "`send_back` whose only items are `required` research this session cannot run, each named in "
                      "the memo's open-issues paragraph.", self.rule)
        self.assertIn("Only the memo the loop ends on is persisted; earlier returns stay in the scratchpad.", self.rule)
        self.assertNotIn("without another review", self.rule)

    def test_a_return_that_is_not_the_json_saves_nothing(self):
        self.assertIn("A return that is not its JSON object (`verdict`, `required`, `out_of_scope`, `identifiers`, "
                      "`findings`), `rules unavailable` included, saves nothing: stop and relay it verbatim.", self.rule)
        for key in ("`verdict`", "`required`", "`out_of_scope`", "`identifiers`", "`findings`"):
            self.assertIn(key, self.rule)

    def test_approval_drops_out_of_scope_and_never_edits(self):
        self.assertIn("Never edit the memo yourself: it is saved verbatim.", self.rule)
        self.assertNotIn("further memo", self.rule)
        self.assertNotIn("memo-reviewer `out_of_scope` question", self.text)
        self.assertIn("a `matter-data:` flag or an offer, read the open loose threads", flat(self.text))
        self.assertIn("An offer of research the scope test found not required is sorted like any other, so off the "
                      "application it is dropped.", flat(self.text))

    def test_no_board_relays_only_the_answer(self):
        no_board = flat(between(self.text, "When no board resolves,", "**Statute currency.**"))
        self.assertIn("When no board resolves, capture nothing and relay the same.", no_board)
        self.assertNotIn("out_of_scope", no_board)

    def test_re_invocation_is_yes_on_every_re_invocation(self):
        self.assertIn("`Re-invocation` is `no` on the first spawn and `yes` on every re-invocation below: `yes: review`\n"
                      "when no paralegal ran for it.", self.text)
        self.assertIn("/ yes: review\nReview: <memo-reviewer's last JSON, verbatim> / none\n", self.text)

    def test_a_question_holds_one_question_and_is_reworded_first(self):
        rule = flat(between(self.text, "**A research question holds one question.**", "**A new question is"))
        self.assertIn("names nothing of the working matter", rule)
        self.assertIn("in one proposal, quoting it, propose one rewording narrowed to a single question", rule)

    def test_multi_issue_filing_is_gone(self):
        self.assertNotIn("spanning more than one issue", self.text)
        self.assertNotIn("spans issues", read("legal-research", "SKILL.md"))

    def test_front_door_and_board_point_to_the_loop(self):
        front_door = flat(read("legal-research", "SKILL.md"))
        self.assertIn("`researcher:memo-reviewer`", front_door)
        self.assertIn("at most three reviews", front_door)
        board = flat(read("legal-research", "references", "research-board.md"))
        self.assertIn("Once memo-reviewer's loop on it has ended", board)
        self.assertIn("complete the job only by `/draft`'s job-session Complete step, which refuses an "
                      "`INCOMPLETE` memo", board)
        self.assertIn("the scope check asks nothing but the rewording proposal", board)
        self.assertIn("After a new question is written as a job, spawn `researcher:research-triage` again", board)


if __name__ == "__main__":
    unittest.main()
