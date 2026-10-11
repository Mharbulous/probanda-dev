"""Regression locks for the Westlaw-first research fix, commons side.

CanLII-first research has recurred repeatedly (see
`docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md`). The litigation
side pins research-agent and the doctrine in
`.claude/skills/legal-research/tests/test_westlaw_first.py`; this file pins the
same fix on law-librarian, which no litigation file may name. Reading the
litigation hook from here is the sanctioned dependency direction
(legal-commons -> litigation).
"""
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
LAW_LIBRARIAN = REPO_ROOT / "source" / "probanda" / "agents" / "law-librarian.md"
HOOK = REPO_ROOT / ".claude" / "skills" / "legal-research" / "hooks" / "block-main-session-canlii.py"

CANLII_TOOL_RE = re.compile(r"^mcp__(?:.+__)?plugin_probanda_canlii__(.+)$")
LOCAL = "mcp__plugin_probanda_canlii__"
BRIDGED = "mcp__remote-devices__plugin_probanda_canlii__"
CITATOR_ALLOW_LIST = {"get_case_citator", "get_case_citator_tease", "configure_status"}

SHIM_RULE = (
    "**CanLII has no decision text. Its API returns index metadata and citator links only. "
    "Do not call CanLII to find, read, or check the content of any decision. If you need a "
    "decision that is not on disk, stop and return `needs_download: [citations]`. The caller "
    "downloads it from Westlaw and re-invokes you once, with `Re-invocation: yes` in the spawn "
    "prompt. On that re-invocation, never return `needs_download`: offer the decision as "
    "research instead.**"
)


def split_frontmatter(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    close = lines.index("---", 1)
    return lines[1:close], "\n".join(lines[close + 1:])


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


def run_hook(tool_name, **extra):
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"tool_name": tool_name, "tool_input": {}, **extra}),
        capture_output=True, text=True, encoding="utf-8",
    )


class LawLibrarianWestlawFirstTests(unittest.TestCase):
    def test_canlii_grant_is_the_citator_allow_list_under_both_names(self):
        tools = granted_tools(LAW_LIBRARIAN)
        canlii = {m.group(1) for m in map(CANLII_TOOL_RE.match, tools) if m}
        self.assertEqual(canlii, CITATOR_ALLOW_LIST)
        for name in CITATOR_ALLOW_LIST:
            self.assertIn(LOCAL + name, tools)
            self.assertIn(BRIDGED + name, tools)

    def test_shim_states_the_rule_before_the_protocol_fetch(self):
        _, body = split_frontmatter(LAW_LIBRARIAN)
        rule_at = body.find(SHIM_RULE)
        self.assertNotEqual(rule_at, -1, "shim rule missing or reworded")
        self.assertLess(rule_at, body.find("Your protocol is"))
        self.assertLess(rule_at, body.find("shared/legal-audit-protocol.md"))

    def test_in_agent_hook_blocks_search_and_keeps_the_citator(self):
        agent = {"agent_id": "a1", "agent_type": "probanda:law-librarian"}
        for prefix in (LOCAL, BRIDGED):
            with self.subTest(prefix=prefix):
                blocked = run_hook(prefix + "search", **agent)
                self.assertEqual(blocked.returncode, 2, blocked.stderr)
                self.assertIn("needs_download", blocked.stderr)
                allowed = run_hook(prefix + "get_case_citator", **agent)
                self.assertEqual(allowed.returncode, 0, allowed.stderr)


if __name__ == "__main__":
    unittest.main()
