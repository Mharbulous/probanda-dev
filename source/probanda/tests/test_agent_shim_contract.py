"""Pins law-librarian (legal-commons) and research-agent (litigation) as twin shims.

Both agents are thin bootstrap shims over `shared/legal-audit-protocol.md` (decision
2026-07-20, reaffirmed 2026-08-12 -- see
`planning/1. Design/2026-08-12_audit-agents-and-commons-holdings-check-design.md`).
This is the commons-side test reading a litigation-side file: the sanctioned
dependency direction (legal-commons -> litigation), never the reverse.

Stdlib-only line parsing -- both agent files use block-list YAML frontmatter, no
external YAML package, per repo rule.
"""

from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
LAW_LIBRARIAN_PATH = REPO_ROOT / "source" / "probanda" / "agents" / "law-librarian.md"
RESEARCH_LAWYER_PATH = REPO_ROOT / "source" / "probanda" / "agents" / "research-agent.md"

WRITE_TOOL_PATTERN = re.compile(
    r"legal_commons__(push|merge_authority|amend_|link_|unlink_|configure_"
    r"|record_treatment|stamp_verified)"
)

POOL_READ_TOOLS = {
    "mcp__plugin_probanda_commons__legal_commons__browse",
    "mcp__plugin_probanda_commons__legal_commons__find_candidates",
    "mcp__plugin_probanda_commons__legal_commons__lookup_by_citation",
    "mcp__plugin_probanda_commons__legal_commons__resolve_by_id",
    "mcp__plugin_probanda_commons__legal_commons__treatment_chain",
}

# A Cowork Project session reaches plugin servers through the desktop bridge, which
# renames every tool `mcp__remote-devices__<name>`. An allowlist entry that matches no
# live tool is dropped silently, so each MCP grant must be declared under both names
# (#492).
BRIDGE_PREFIX = "mcp__remote-devices__"


def _bridged(tool):
    return BRIDGE_PREFIX + tool[len("mcp__") :]

# Sentences the two `description:` fields must keep verbatim even though the fields
# differ overall (law-librarian's description also covers pool routing/consolidation).
# Unlike the body and tool grant, nothing else pins these -- an edit to one file's
# wording here previously could drift silently. See law-librarian-decision memory.
SHARED_DESCRIPTION_CLAUSES = [
    "Notes up every authority relied on, compares each authority's facts to the "
    "situation asked about, and gates disclosure behind a confidence summary.",
    "Every statement of law carries a pinpoint citation; anything uncited is offered "
    "as research, never asserted.",
    "Also takes a scoped `mode: inventory` / `report: brief` dispatch — a cheap "
    "holdings check over named criteria that states no law.",
    "Hands external research off to /legal-research (westlaw-query-optimizer) + "
    "research-paralegal — never browses itself.",
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


def _normalize_body(body_lines, heading):
    """Drop the leading blank lines and normalize the `# <heading>` line."""
    normalized = []
    seen_heading = False
    for line in body_lines:
        if not seen_heading and line.strip() == f"# {heading}":
            normalized.append("# AGENT")
            seen_heading = True
            continue
        normalized.append(line)
    if not seen_heading:
        raise AssertionError(f"no `# {heading}` heading found in body")
    return normalized


class AgentShimContractTests(unittest.TestCase):
    def setUp(self):
        self.law_librarian_frontmatter, self.law_librarian_body = _split_frontmatter(
            LAW_LIBRARIAN_PATH
        )
        self.research_lawyer_frontmatter, self.research_lawyer_body = _split_frontmatter(
            RESEARCH_LAWYER_PATH
        )

    def test_bodies_are_identical_after_normalizing_the_heading(self):
        law_librarian_normalized = _normalize_body(self.law_librarian_body, "law-librarian")
        research_lawyer_normalized = _normalize_body(
            self.research_lawyer_body, "research-agent"
        )
        self.assertEqual(law_librarian_normalized, research_lawyer_normalized)

    def test_law_librarian_grant_is_research_lawyer_plus_the_five_pool_tools_under_both_names(self):
        law_librarian_tools = _parse_tools(self.law_librarian_frontmatter)
        research_lawyer_tools = _parse_tools(self.research_lawyer_frontmatter)

        self.assertTrue(research_lawyer_tools, "research-agent tools: block parsed empty")
        self.assertTrue(law_librarian_tools, "law-librarian tools: block parsed empty")

        extra = law_librarian_tools - research_lawyer_tools
        missing = research_lawyer_tools - law_librarian_tools

        self.assertEqual(missing, set(), "law-librarian is missing a research-agent tool")
        self.assertEqual(extra, POOL_READ_TOOLS | {_bridged(tool) for tool in POOL_READ_TOOLS})

    def test_every_mcp_grant_is_declared_under_its_bridged_name_too(self):
        for path, frontmatter in (
            (LAW_LIBRARIAN_PATH, self.law_librarian_frontmatter),
            (RESEARCH_LAWYER_PATH, self.research_lawyer_frontmatter),
        ):
            tools = _parse_tools(frontmatter)
            plain = {tool for tool in tools if tool.startswith("mcp__plugin_")}
            bridged = {tool for tool in tools if tool.startswith(BRIDGE_PREFIX)}
            self.assertTrue(plain, f"{path} grants no plugin MCP tool")
            self.assertEqual(
                bridged,
                {_bridged(tool) for tool in plain},
                f"{path} bridged grant does not mirror its plain MCP grant",
            )

    def test_no_commons_write_tool_in_either_grant(self):
        for path, frontmatter in (
            (LAW_LIBRARIAN_PATH, self.law_librarian_frontmatter),
            (RESEARCH_LAWYER_PATH, self.research_lawyer_frontmatter),
        ):
            for tool in _parse_tools(frontmatter):
                self.assertIsNone(
                    WRITE_TOOL_PATTERN.search(tool),
                    f"{path} grants a commons write tool: {tool}",
                )

    def test_write_tool_pattern_matches_every_commons_write_tool(self):
        # The pattern is the only thing standing between a new pool write tool and
        # a silent grant to a read-only audit agent, and it is a hand-maintained
        # regex: a tool it does not match passes the guard above vacuously. Pin
        # the whole write surface here, currency writes included.
        for tool in (
            "mcp__plugin_probanda_commons__legal_commons__push",
            "mcp__plugin_probanda_commons__legal_commons__record_treatment",
            "mcp__plugin_probanda_commons__legal_commons__stamp_verified",
            "mcp__plugin_probanda_commons__legal_commons__amend_authority",
            "mcp__plugin_probanda_commons__legal_commons__amend_authority_edge",
            "mcp__plugin_probanda_commons__legal_commons__link_authority",
            "mcp__plugin_probanda_commons__legal_commons__unlink_authority",
            "mcp__plugin_probanda_commons__legal_commons__merge_authority",
            "mcp__plugin_probanda_commons__legal_commons__configure_credential",
        ):
            self.assertIsNotNone(
                WRITE_TOOL_PATTERN.search(tool), f"{tool} is not recognized as a write tool"
            )

        for tool in sorted(POOL_READ_TOOLS):
            self.assertIsNone(
                WRITE_TOOL_PATTERN.search(tool), f"{tool} is a read tool, not a write tool"
            )

    def test_both_bodies_declare_the_law_audit_lane(self):
        for path, body in (
            (LAW_LIBRARIAN_PATH, self.law_librarian_body),
            (RESEARCH_LAWYER_PATH, self.research_lawyer_body),
        ):
            self.assertTrue(
                any(line.strip().startswith("**Lane:** law-audit") for line in body),
                f"{path} body does not declare **Lane:** law-audit",
            )

    def test_descriptions_share_the_common_clauses(self):
        # Case-insensitive: each description leads into these clauses from different
        # prior sentences, so one may capitalize the clause's first word as a new
        # sentence while the other continues it lowercase mid-sentence. That's a
        # sentence-boundary artifact, not the wording drift this test guards against.
        law_librarian_description = _parse_description(self.law_librarian_frontmatter).casefold()
        research_lawyer_description = _parse_description(
            self.research_lawyer_frontmatter
        ).casefold()

        self.assertTrue(law_librarian_description, "law-librarian description parsed empty")
        self.assertTrue(research_lawyer_description, "research-agent description parsed empty")

        for clause in SHARED_DESCRIPTION_CLAUSES:
            folded_clause = clause.casefold()
            self.assertIn(
                folded_clause,
                law_librarian_description,
                f"law-librarian description is missing shared clause: {clause!r}",
            )
            self.assertIn(
                folded_clause,
                research_lawyer_description,
                f"research-agent description is missing shared clause: {clause!r}",
            )


if __name__ == "__main__":
    unittest.main()
