import re
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO = SKILL_ROOT.parents[2]
SKILL = SKILL_ROOT / "SKILL.md"
REFS = SKILL_ROOT / "references"
STAGE = REFS / "source-trace.md"
HABITS = REPO / ".claude" / "skills" / "shared" / "scrivener" / "references" / "core.md"
AGENT = REPO / "source" / "litigator" / "agents" / "source-tracer.md"

HABIT_IDS = (
    "adopted_characterization",
    "embellished_source",
    "recharacterized_statement",
    "relayed_report",
    "contradicted_record",
    "unanswered_characterization",
)

VERDICTS = ("verified", "attribute", "trace_needed", "cut", "accepted")

# Every letter, email, memo and reply route passes the stage before delivery.
ROUTES = (
    REFS / "letters.md",
    REFS / "reply.md",
    REFS / "procedure.md",
)


class SourceTraceContractTests(unittest.TestCase):
    def test_catalogue_names_every_habit(self):
        habits = HABITS.read_text(encoding="utf-8")
        for habit in HABIT_IDS:
            with self.subTest(habit=habit):
                self.assertIn(f"`{habit}`", habits)

    def test_stage_and_agent_share_the_verdicts(self):
        stage = STAGE.read_text(encoding="utf-8")
        agent = AGENT.read_text(encoding="utf-8")
        for verdict in VERDICTS:
            with self.subTest(verdict=verdict):
                self.assertIn(f"`{verdict}`", stage)
                self.assertIn(f"`{verdict}`", agent)

    def test_every_route_cites_the_stage(self):
        for route in ROUTES:
            with self.subTest(route=route.name):
                self.assertIn("references/source-trace.md", route.read_text(encoding="utf-8"))

    def test_skill_bans_delivery_before_review(self):
        skill = SKILL.read_text(encoding="utf-8")
        self.assertIn("<!-- atom id=draft.ban.20 ops=always -->", skill)
        self.assertIn("20. Never present a letter, email or memo mockup", skill)

    def test_description_catches_the_missed_requests(self):
        skill = SKILL.read_text(encoding="utf-8")
        description = skill.split("---")[1]
        for token in ("supplement", "report to a client", "reply to correspondence"):
            with self.subTest(token=token):
                self.assertIn(token, description)

    def test_reviewer_reads_only(self):
        front = AGENT.read_text(encoding="utf-8").split("---")[1]
        tools = re.findall(r"^\s+- (\S+)", front, re.M)
        self.assertIn("Read", tools)
        for tool in tools:
            with self.subTest(tool=tool):
                self.assertNotRegex(tool, r"^(Write|Edit|MultiEdit|Bash|PowerShell|Agent)$|save|write|execute|upsert")

    def test_reviewer_reads_the_matter_folder_itself_and_nothing_stages_for_it(self):
        agent = AGENT.read_text(encoding="utf-8")
        tools = re.findall(r"^\s+- (\S+)", agent.split("---")[1], re.M)
        for prefix in ("mcp__plugin_lawyer_data__", "mcp__remote-devices__plugin_lawyer_data__"):
            self.assertIn(f"{prefix}research_filing__matter_folder", tools)
        self.assertIn("the PC paths in the matter folder", agent)
        self.assertNotIn("device_stage_files", agent)
        self.assertNotIn("device_stage_files", STAGE.read_text(encoding="utf-8"))

    def test_reviewer_takes_a_guidance_item_memo_as_source(self):
        agent = AGENT.read_text(encoding="utf-8")
        self.assertIn("the item's memo is its source", agent)
        self.assertIn("each sentence of that paragraph is an assertion", agent)
        tools = re.findall(r"^\s+- (\S+)", agent.split("---")[1], re.M)
        for prefix in ("mcp__plugin_lawyer_data__", "mcp__remote-devices__plugin_lawyer_data__"):
            self.assertIn(f"{prefix}knowledge__read", tools)

    def test_brief_carries_the_note_and_the_full_mail_folder(self):
        stage = STAGE.read_text(encoding="utf-8")
        agent = AGENT.read_text(encoding="utf-8")
        for field in ("`environment_notes`", "`mail_folder`"):
            with self.subTest(field=field):
                self.assertIn(field, stage)
                self.assertIn(field, agent)
        self.assertIn("mail-folder operation", stage)

    def test_reviewer_reads_exported_mail_and_it_settles_no_negative(self):
        agent = AGENT.read_text(encoding="utf-8")
        self.assertIn("`.eml` and `.msg`", agent)
        self.assertIn("settles no negative", agent)

    def test_unreachable_negative_goes_to_the_practitioner_without_a_new_verdict(self):
        agent = AGENT.read_text(encoding="utf-8")
        self.assertIn("Only the practitioner can confirm", agent)
        self.assertIn("Run no other search", agent)
        self.assertIn("verified | attribute | trace_needed | cut | accepted", agent)

    def test_reviewer_never_takes_the_drafter_word(self):
        agent = AGENT.read_text(encoding="utf-8")
        self.assertIn("Read every source yourself", agent)
        self.assertIn("Never state law", agent)


if __name__ == "__main__":
    unittest.main()
