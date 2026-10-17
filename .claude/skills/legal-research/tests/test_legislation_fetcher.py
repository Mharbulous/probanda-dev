"""Regression locks for the legislation-fetcher wiring.

`/legal-research` downloads statute, regulation and bylaw text through the
`legislation-fetcher` agent, which fetches from the official publisher with
`sources__fetch` and files the fetched bytes with `research_filing__file_fetched`.
Each test pins one piece of that wiring: the agent's grant and lane, the gate's
spawn field and duty, the coverage segment, and the agent roster in the plugin notes.
"""
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = SKILL_ROOT.parent
REPO_ROOT = SKILLS_ROOT.parents[1]
SHARED = SKILLS_ROOT / "shared"
AGENTS = REPO_ROOT / "source" / "researcher" / "agents"
PRACTICE_AGENTS = REPO_ROOT / "source" / "practice" / "agents"
FETCHER = AGENTS / "legislation-fetcher.md"
PLAYBOOK = SKILL_ROOT / "references" / "legislation-fetcher-playbook.md"

LOCAL = "mcp__plugin_practice_data__"
BRIDGED = "mcp__remote-devices__plugin_practice_data__"
GRANTED = (
    "skill_source__read",
    "sources__fetch",
    "knowledge__read",
    "knowledge__list",
    "knowledge__write",
    "research_filing__list_law_folder",
    "research_filing__file_fetched",
)
NOT_GRANTED = ("save_answer", "file_download", "append_manifest", "canlii")
SPAWN_FIELD = (
    "Legislation: <citation>: filed <path>, current to <marker>, currency <value> / "
    "already on disk <path>, currency <value> / not retrieved: <reason>, currency <value>"
)
COVERAGE = "CanLII: noted up / no key | Legislation: retrieved n, on disk n / not run: <reason>"
COVERAGE_FILES = ("research-priority.md", "legal-audit-protocol.md", "legal-audit-scoped.md")
TOUCHED = (
    FETCHER,
    PLAYBOOK,
    SKILL_ROOT / "SKILL.md",
    SHARED / "legal-research.md",
    SHARED / "research-priority.md",
    SHARED / "legal-audit-protocol.md",
    SHARED / "legal-audit-scoped.md",
    SHARED / "statute-currency.md",
    SHARED / "knowledge-tree.md",
    AGENTS / "research-paralegal.md",
    PRACTICE_AGENTS / "localize-helper.md",
)


def read(path):
    return path.read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def split_frontmatter(path):
    lines = read(path).splitlines()
    close = lines.index("---", 1)
    return lines[1:close], lines[close + 1:]


def granted_tools(path):
    frontmatter, _ = split_frontmatter(path)
    tools, in_tools = set(), False
    for line in frontmatter:
        stripped = line.strip()
        if stripped.startswith("tools:"):
            in_tools = True
            continue
        if in_tools:
            if stripped.startswith("- "):
                tools.add(stripped[2:].strip())
            elif stripped:
                break
    return tools


class AgentTests(unittest.TestCase):
    def test_grants_the_seven_tools_under_both_names_and_nothing_else(self):
        tools = granted_tools(FETCHER)
        expected = {prefix + name for name in GRANTED for prefix in (LOCAL, BRIDGED)}
        self.assertEqual(tools, expected)
        self.assertNotIn("Read", tools)
        for tool in tools:
            for name in NOT_GRANTED:
                with self.subTest(tool=tool, name=name):
                    self.assertNotIn(name, tool)

    def test_lane_line_follows_the_h1(self):
        _, body = split_frontmatter(FETCHER)
        lines = [line for line in body if line.strip()]
        self.assertTrue(lines[0].startswith("# "), lines[0])
        self.assertTrue(lines[1].startswith("**Lane:**"), lines[1])

    def test_agent_loads_its_playbook(self):
        self.assertTrue(PLAYBOOK.is_file())
        self.assertIn("legal-research/references/legislation-fetcher-playbook.md", read(FETCHER))

    def test_both_allowlisted_agents_grant_sources_fetch_under_both_names(self):
        for folder, name in ((PRACTICE_AGENTS, "localize-helper.md"), (AGENTS, "legislation-fetcher.md")):
            tools = granted_tools(folder / name)
            for prefix in (LOCAL, BRIDGED):
                with self.subTest(agent=name, prefix=prefix):
                    self.assertIn(prefix + "sources__fetch", tools)


class GateTests(unittest.TestCase):
    def test_spawn_template_carries_the_legislation_field(self):
        text = read(SHARED / "legal-research.md")
        template = text[text.index("**Spawn the agent from this template.**"):
                        text.index("**A `needs_download` or hand-off-packet return")]
        self.assertIn(SPAWN_FIELD, template)
        self.assertIn("Legislation text is on disk at the paths above", template)

    def test_coverage_line_ends_with_the_legislation_segment(self):
        for name in COVERAGE_FILES:
            with self.subTest(name=name):
                self.assertIn(COVERAGE, read(SHARED / name))

    def test_front_door_names_the_agent_and_the_allow_host_ask(self):
        text = read(SKILL_ROOT / "SKILL.md")
        self.assertIn("legislation-fetcher", text)
        self.assertIn("allow_host", text)

    def test_after_the_answer_ingests_filed_legislation(self):
        text = read(SHARED / "legal-research.md")
        rule = flat(text[text.index("**After the answer, the caller persists it.**"):
                         text.index("**Statute currency.**")])
        step_three = rule[rule.index("3. Run `/ingest`"):]
        self.assertIn("each legislation file `legislation-fetcher` filed in this run", step_three)


class AcceptanceFollowUpTests(unittest.TestCase):
    """Locks from the 2026-10-05 L8443 acceptance run of 9ef4150 and 0cb0234."""

    CLOSE = "The line ends with the Legislation segment"
    FILE_NUMBER = "file number, such as `1234.L####`"
    NEVER_NAME = "never its style of cause or a party's name"

    def test_coverage_line_closes_with_the_legislation_segment(self):
        for name in COVERAGE_FILES:
            with self.subTest(name=name):
                text = flat(read(SHARED / name))
                self.assertIn(self.CLOSE, text)
                self.assertIn("with nothing after it", text)

    def test_gate_passes_the_matter_as_a_file_number(self):
        duty = flat(read(SHARED / "legal-research.md"))
        duty = duty[duty.index("4. **Legislation text, before the audit.**"):]
        self.assertIn("`matter` the live matter's " + self.FILE_NUMBER + ", " + self.NEVER_NAME, duty)

    def test_fetcher_refuses_a_matter_with_a_space(self):
        text = flat(read(PLAYBOOK))
        self.assertIn("- `matter`: the live matter's " + self.FILE_NUMBER + ", " + self.NEVER_NAME, text)
        self.assertIn("when `matter` contains a space, return `stopped`, reason `invalid_dispatch`", text)

    def test_overlay_header_records_the_matter_by_file_number(self):
        text = flat(read(SHARED / "knowledge-tree.md"))
        self.assertIn("a matter is recorded by its " + self.FILE_NUMBER + ", " + self.NEVER_NAME, text)
        self.assertIn("stamps that matter's own number (`L####`), never the caller's string", text)
        self.assertIn("refused with `matter_unknown`", text)

    def test_fetcher_stops_on_an_unknown_matter(self):
        text = flat(read(PLAYBOOK))
        self.assertIn("When `knowledge__write` refuses with `matter_unknown`, return `stopped`, reason `matter_unknown`.", text)

    def test_localize_passes_the_matter_as_a_file_number(self):
        for path in (SKILLS_ROOT / "localize" / "SKILL.md",
                     SKILLS_ROOT / "localize" / "references" / "playbook.md"):
            with self.subTest(path=path.name):
                text = flat(read(path))
                self.assertIn("matter's " + self.FILE_NUMBER, text)
                self.assertIn(self.NEVER_NAME, text)

class NotesTests(unittest.TestCase):
    def test_no_touched_file_uses_a_federal_folder_alias(self):
        for path in TOUCHED:
            with self.subTest(path=path.name):
                self.assertNotIn("_federal", read(path))


if __name__ == "__main__":
    unittest.main()
