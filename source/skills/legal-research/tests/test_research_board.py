"""Pins board mode: several research jobs on one board, ordered by the research triage agent's
blocker graph and worked under one token per job, at most three held, with the blockers' memos
passed forward word for word and every rewording shown to the practitioner before it lands.

Run: python -m pytest source/skills/legal-research/tests/test_research_board.py -q
"""

import json
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
SKILLS = REPO / "source" / "skills"
INSTRUCTION = ("Here are the memos that will provide some background context for your research. Repeat the "
               "propositions and excerpts from the previous memo only if they are necessary context for "
               "explaining your own research memo, but make sure that you go beyond that information and dig "
               "deeper into the legal issue posed by your particular question.")


def read(*parts):
    return (SKILLS.joinpath(*parts)).read_text(encoding="utf-8")


class ResearchBoardTest(unittest.TestCase):
    def test_gate_points_to_board_mode(self):
        self.assertIn("read `references/research-board.md` and follow it", read("legal-research", "SKILL.md"))

    def test_jobs_held_one_token_each_three_at_most(self):
        board = read("legal-research", "references", "research-board.md")
        self.assertIn("Hold at most three research jobs at once.", board)
        self.assertIn("under its own token, minted for that job by `drafting_forms__bootstrap`", board)
        self.assertIn("never another job's", board)

    def test_retrieval_limits_and_no_waves(self):
        board = read("legal-research", "references", "research-board.md")
        self.assertIn("One Chrome-mode `law-getter` run (deep-research or citation) at a time across every job.", board)
        self.assertIn("`citation-checker` never runs beside a Chrome-mode `law-getter` run", board)
        self.assertIn("Nothing waits for a column to finish.", board)

    def test_memos_passed_forward_verbatim(self):
        shared = read("shared", "legal-research.md")
        self.assertIn("Background memos: <path>[; <path>] / none\n" + INSTRUCTION + "\n", shared)
        self.assertIn("`Background memos:` the saved memos of every job that blocked this one",
                      read("legal-research", "references", "research-board.md"))

    def test_rewording_review_order(self):
        board = read("legal-research", "references", "research-board.md")
        review = board[board.index("## The rewording review"):]
        order = ["The original question in full, in a code block.", "The earlier memo as a file card",
                 "The proposed question in full, in a code block.", "The reasons, each tied to a highlighted passage",
                 "One plain question: approve it, change it, or keep the original."]
        positions = [review.index(item) for item in order]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("Never apply a rewording without the practitioner's approval.", review)

    def test_triage_agent_is_read_only_opus_and_placed(self):
        agent = (REPO / "source" / "researcher" / "agents" / "research-triage.md").read_text(encoding="utf-8")
        front = agent.split("---")[1]
        self.assertIn("model: opus", front)
        self.assertIn("tools:\n  - Read\nskills: []", front)
        for kind in ('"kind": "hard"', "**hard** blocker", "**soft** blocker"):
            self.assertIn(kind, agent)
        self.assertIn("You state no law.", agent)
        assignment = json.loads((REPO / "source" / "assignment.json").read_text(encoding="utf-8"))
        self.assertIn("research-triage", assignment["plugins"]["researcher"]["agents"])

    def test_board_writes_are_drafting_datas(self):
        stock = read("drafting-data", "references", "jobs-stock.md")
        self.assertIn("## 3m. Research board writes", stock)
        self.assertIn("None of them is outlining", stock)
        self.assertIn("| §3m research board premise job |", read("drafting-data", "references", "jobs-create.md"))
        self.assertIn("`references/jobs-stock.md` §3m", read("drafting-data", "SKILL.md"))


if __name__ == "__main__":
    unittest.main()
