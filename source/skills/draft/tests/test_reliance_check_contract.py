"""The reliance check: the scrivener's data block, /draft's per-fact fan-out,
source-tracer's reliance mode and matter-data's write-back agree."""
import re
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO = SKILL_ROOT.parents[2]
REFS = SKILL_ROOT / "references"
CHECK = REFS / "reliance-check.md"
TRACER = REPO / "source" / "litigator" / "agents" / "source-tracer.md"
SCRIVENER = REPO / "source" / "lawyer" / "agents" / "scrivener.md"
MATTER_DATA = REPO / "source" / "skills" / "matter-data"
APPLY = MATTER_DATA / "operations" / "reliance-verify.md"


def read(path):
    return path.read_text(encoding="utf-8")


class DataBlock(unittest.TestCase):
    def test_scrivener_returns_one_entry_per_fact_with_its_fact_id(self):
        agent = read(SCRIVENER)
        self.assertIn('"fact_id": <the fact_id from facts, or null>', agent)
        self.assertIn('"clause"', agent)
        self.assertIn('"locators"', agent)
        self.assertIn("A case-data fact you read but the text does not state gets no entry.", agent)

    def test_block_carries_no_extractor_model_or_effort(self):
        for path in (SCRIVENER, CHECK, TRACER):
            with self.subTest(file=path.name):
                self.assertNotRegex(read(path), r"extractor_model|extracted_by|\"model\"|\"effort\"")


class FanOut(unittest.TestCase):
    def test_one_named_agent_per_entry_or_group_never_a_fork(self):
        check = read(CHECK)
        self.assertIn("Spawn the `litigator:source-tracer` agent once per entry or group", check)
        self.assertIn("never as a fork", check)
        self.assertIn("**Group shared passages.**", check)

    def test_every_dispatch_opens_with_the_same_prefix(self):
        check = read(CHECK)
        prompt = re.search(r"```\n(mode: reliance\n.*?)```", check, re.S).group(1)
        self.assertTrue(prompt.startswith("mode: reliance\nparagraph:\n"))
        self.assertLess(prompt.index("paragraph:"), prompt.index("entries:"))
        self.assertIn("then, once it returns, the rest in one message", check)

    def test_excerpts_not_whole_sources(self):
        check = read(CHECK)
        self.assertIn("## 2. Excerpts, never whole sources", check)
        self.assertIn('"before"', check)
        self.assertIn('"after"', check)
        tracer = read(TRACER)
        self.assertIn("in this mode the excerpts are the source. Never open a source file", tracer)

    def test_sonnet_high_then_one_opus_recheck(self):
        check = read(CHECK)
        self.assertIn("`model: sonnet` and `effort: high`", check)
        self.assertIn("**One re-check.**", check)
        self.assertIn("It never sees the first result.", check)
        self.assertRegex(read(TRACER), r"(?m)^model: opus$")

    def test_use_check_runs_on_every_use_and_is_never_saved(self):
        check = read(CHECK)
        self.assertIn("Answer (ii).** Never written, never a job.", check)
        self.assertIn("does not hold the paragraph back", check)
        self.assertIn("a fact checked once is not checked again", read(APPLY))
        tracer = read(TRACER)
        self.assertIn("**Answer (ii), the use**, always.", tracer)

    def test_manual_trigger(self):
        check = read(CHECK)
        self.assertIn("**Manual trigger.**", check)
        procedure = read(REFS / "procedure.md")
        self.assertIn("<!-- atom id=draft.ref.reliance-check", procedure)
        self.assertIn("`references/reliance-check.md`", procedure)

    def test_letters_run_the_check_before_source_trace(self):
        letters = read(REFS / "letters.md")
        self.assertIn("run `references/reliance-check.md` on the text first", letters)


class ReliancemodeContract(unittest.TestCase):
    def test_answers_and_verdicts(self):
        tracer = read(TRACER)
        self.assertIn("## 6. Reliance mode", tracer)
        for token in ('"extraction"', '"use"', '"confidence"', "confirmed | corrected | unresolved",
                      "faithful | distorts | unsupported", "Propose no wording"):
            with self.subTest(token=token):
                self.assertIn(token, tracer)

    def test_write_back_lives_in_matter_data_only(self):
        self.assertIn("operations/reliance-verify.md", read(MATTER_DATA / "SKILL.md"))
        self.assertIn("`/matter-data` reliance-verify, Steps 2 and 3", read(CHECK))
        self.assertNotIn("litigator", read(APPLY))


if __name__ == "__main__":
    unittest.main()
