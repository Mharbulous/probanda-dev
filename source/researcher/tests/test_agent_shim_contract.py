"""Pins research-agent's tool grant, lane and description.

research-agent is a thin bootstrap shim over `shared/legal-audit-protocol.md`.

Stdlib-only line parsing -- the agent file uses block-list YAML frontmatter, no
external YAML package, per repo rule.
"""

from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
RESEARCH_LAWYER_PATH = REPO_ROOT / "source" / "researcher" / "agents" / "research-agent.md"

WRITE_TOOL_PATTERN = re.compile(
    r"legal_commons__(push|merge_authority|amend_|link_|unlink_|configure_"
    r"|record_treatment)"
)

POOL_READ_TOOLS = {
    "mcp__plugin_researcher_commons__legal_commons__browse",
    "mcp__plugin_researcher_commons__legal_commons__find_candidates",
    "mcp__plugin_researcher_commons__legal_commons__lookup_by_citation",
    "mcp__plugin_researcher_commons__legal_commons__resolve_by_id",
    "mcp__plugin_researcher_commons__legal_commons__search",
    "mcp__plugin_researcher_commons__legal_commons__treatment_chain",
}

# A Cowork Project session reaches plugin servers through the desktop bridge, which
# renames every tool `mcp__remote-devices__<name>`. An allowlist entry that matches no
# live tool is dropped silently, so each MCP grant must be declared under both names
# (#492).
BRIDGE_PREFIX = "mcp__remote-devices__"


def _bridged(tool):
    return BRIDGE_PREFIX + tool[len("mcp__") :]

# Sentences the `description:` field must keep verbatim: skills route to the agent by
# them, and nothing else pins them.
DESCRIPTION_CLAUSES = [
    "Audits the legal-commons pool, the matter's 6. LAW folders and case database, "
    "and citation-checker's note-up records before speaking, and gates disclosure "
    "behind a confidence summary.",
    "Every statement of law carries a pinpoint citation; anything uncited is offered "
    "as research, never asserted.",
    "Also takes `mode: inventory` / `report: brief` (a holdings check over named "
    "criteria), which states no law, and `mode: case_brief` (one decision's brief, "
    "from that decision alone, for /case-brief) and `mode: citing_read` (one citing "
    "decision at the pages that cite an authority).",
    "Never browses: external research goes to /legal-research and law-getter.",
    "Not for procedural mechanics, deadline arithmetic, or restating a party's own "
    "pleaded positions.",
]


def _split_frontmatter(path):
    """Return (frontmatter_lines, body_lines) for a `---`-delimited agent file."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        raise AssertionError(f"{path} does not open with a `---` frontmatter marker")
    close_index = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            close_index = index
            break
    if close_index is None:
        raise AssertionError(f"{path} frontmatter is never closed with `---`")
    return lines[1:close_index], lines[close_index + 1 :]


def _parse_tools(frontmatter_lines):
    """Extract the `tools:` block-list value as a set of tool names."""
    tools = set()
    in_tools_block = False
    for line in frontmatter_lines:
        stripped = line.strip()
        if stripped.startswith("tools:"):
            in_tools_block = True
            continue
        if in_tools_block:
            if stripped.startswith("- "):
                tools.add(stripped[2:].strip())
                continue
            if stripped and not stripped.startswith("-"):
                break
    return tools


def _parse_description(frontmatter_lines):
    """Join the folded `description: >` block-scalar value into one string."""
    collected = []
    in_description = False
    for line in frontmatter_lines:
        if not in_description:
            if line.strip().startswith("description:"):
                in_description = True
            continue
        if line.startswith("  ") or not line.strip():
            stripped = line.strip()
            if stripped:
                collected.append(stripped)
            continue
        break
    return " ".join(collected)


class AgentShimContractTests(unittest.TestCase):
    def setUp(self):
        self.frontmatter, self.body = _split_frontmatter(RESEARCH_LAWYER_PATH)
        self.tools = _parse_tools(self.frontmatter)

    def test_grant_holds_the_six_pool_read_tools_under_both_names(self):
        self.assertTrue(self.tools, "research-agent tools: block parsed empty")
        commons = {tool for tool in self.tools if "_commons__" in tool}
        self.assertEqual(commons, POOL_READ_TOOLS | {_bridged(tool) for tool in POOL_READ_TOOLS})

    def test_every_mcp_grant_is_declared_under_its_bridged_name_too(self):
        plain = {tool for tool in self.tools if tool.startswith("mcp__plugin_")}
        bridged = {tool for tool in self.tools if tool.startswith(BRIDGE_PREFIX)}
        self.assertTrue(plain, "research-agent grants no plugin MCP tool")
        self.assertEqual(
            bridged,
            {_bridged(tool) for tool in plain},
            "research-agent bridged grant does not mirror its plain MCP grant",
        )

    def test_no_commons_write_tool_in_the_grant(self):
        for tool in self.tools:
            self.assertIsNone(
                WRITE_TOOL_PATTERN.search(tool),
                f"research-agent grants a commons write tool: {tool}",
            )

    def test_write_tool_pattern_matches_every_commons_write_tool(self):
        # The pattern is the only thing standing between a new pool write tool and
        # a silent grant to a read-only audit agent, and it is a hand-maintained
        # regex: a tool it does not match passes the guard above vacuously. Pin
        # the whole write surface here, currency writes included.
        for tool in (
            "mcp__plugin_researcher_commons__legal_commons__push",
            "mcp__plugin_researcher_commons__legal_commons__record_treatment",
            "mcp__plugin_researcher_commons__legal_commons__amend_authority",
            "mcp__plugin_researcher_commons__legal_commons__amend_authority_edge",
            "mcp__plugin_researcher_commons__legal_commons__link_authority",
            "mcp__plugin_researcher_commons__legal_commons__unlink_authority",
            "mcp__plugin_researcher_commons__legal_commons__merge_authority",
        ):
            self.assertIsNotNone(
                WRITE_TOOL_PATTERN.search(tool), f"{tool} is not recognized as a write tool"
            )

        for tool in sorted(POOL_READ_TOOLS):
            self.assertIsNone(
                WRITE_TOOL_PATTERN.search(tool), f"{tool} is a read tool, not a write tool"
            )

    def test_body_declares_the_law_audit_lane(self):
        self.assertTrue(
            any(line.strip().startswith("**Lane:** law-audit") for line in self.body),
            "research-agent body does not declare **Lane:** law-audit",
        )

    def test_description_keeps_its_clauses(self):
        description = _parse_description(self.frontmatter).casefold()
        self.assertTrue(description, "research-agent description parsed empty")
        for clause in DESCRIPTION_CLAUSES:
            self.assertIn(
                clause.casefold(),
                description,
                f"research-agent description is missing clause: {clause!r}",
            )


if __name__ == "__main__":
    unittest.main()
