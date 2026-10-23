"""Locks for the commons read-only guard.

The guard script denies whatever reaches it, so the matcher in plugin.json is
the whole of its selectivity. A matcher that misses a write tool, or that names
the wrong plugin or server, lets the write through without any error. These
tests pin the matcher to the server's own tool list under both tool-name forms.
"""
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


PLUGIN_DIR = Path(__file__).resolve().parents[1]
PLUGIN_JSON = PLUGIN_DIR / "plugin.json"
HOOK = PLUGIN_DIR / "hooks" / "commons-read-only.py"
BUNDLE = PLUGIN_DIR / "commons-mcp" / "dist" / "legal-commons-mcp.js"
HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/hooks/commons-read-only.py"

SERVER = "plugin_researcher_commons__"
LOCAL = "mcp__" + SERVER
BRIDGED = "mcp__remote-devices__" + SERVER

WRITE = {
    "push", "amend_authority", "amend_authority_edge", "amend_criterion_text",
    "amend_principle_text", "link_authority", "unlink_authority", "merge_authority",
    "record_treatment", "rule_period_push",
    "rule_period_record_verification", "rule_period_retire",
}
READ = {
    "browse", "search", "find_candidates", "lookup_by_citation", "resolve_by_id", "treatment_chain",
    "rule_period_find", "configure_status",
}
TROUBLESHOOT = {"search", "record", "confirm_fix", "configure_credential", "configure_status"}
SUGGESTION_BOX = {"submit", "configure_credential", "configure_status"}


def registered_matcher():
    manifest = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))
    entries = [
        entry for entry in manifest["hooks"]["PreToolUse"]
        if any(HOOK_ARG in h.get("args", []) for h in entry["hooks"])
    ]
    assert len(entries) == 1, f"expected one commons-read-only entry, found {len(entries)}"
    return entries[0]["matcher"]


def matcher_gaps(matcher):
    """Every way the matcher fails to cover exactly the write tools."""
    pattern = re.compile(matcher)
    gaps = []
    for prefix in (LOCAL, BRIDGED):
        for tool in sorted(WRITE):
            if not pattern.fullmatch(prefix + "legal_commons__" + tool):
                gaps.append(f"write tool not matched: {prefix}legal_commons__{tool}")
        for tool in sorted(READ):
            if pattern.search(prefix + "legal_commons__" + tool):
                gaps.append(f"read tool matched: {prefix}legal_commons__{tool}")
        for tool in sorted(TROUBLESHOOT):
            if pattern.search(prefix + "troubleshoot__" + tool):
                gaps.append(f"troubleshoot tool matched: {prefix}troubleshoot__{tool}")
        for tool in sorted(SUGGESTION_BOX):
            if pattern.search(prefix + "suggestion_box__" + tool):
                gaps.append(f"suggestion box tool matched: {prefix}suggestion_box__{tool}")
    return gaps


class CommonsReadOnlyGuardTests(unittest.TestCase):
    def test_every_pool_tool_is_classified(self):
        # A tool added to the server fails here until it is put in WRITE or READ.
        served = set(re.findall(r"legal_commons__([a-z_]+)", BUNDLE.read_text(encoding="utf-8")))
        self.assertEqual(served, WRITE | READ)
        self.assertFalse(WRITE & READ)

    def test_matcher_names_exactly_the_write_tools(self):
        alternation = re.search(r"legal_commons__\(([^)]*)\)$", registered_matcher())
        self.assertIsNotNone(alternation, "matcher no longer ends in the write-tool alternation")
        self.assertEqual(set(alternation.group(1).split("|")), WRITE)

    def test_matcher_covers_the_write_tools_under_both_names_and_nothing_else(self):
        self.assertEqual(matcher_gaps(registered_matcher()), [])

    def test_matcher_ignores_other_servers(self):
        pattern = re.compile(registered_matcher())
        for name in ("mcp__plugin_other_commons__legal_commons__push",
                     LOCAL.replace("commons__", "data__") + "legal_commons__push",
                     "mcp__plugin_practice_data__matter_data__query", "Read"):
            with self.subTest(name=name):
                self.assertIsNone(pattern.fullmatch(name))

    def test_a_broken_matcher_is_reported(self):
        good = registered_matcher()
        for broken in (good.replace("|record_treatment", ""),
                       good.replace(SERVER, "plugin_renamed_commons__"),
                       good.replace("(push|", "(push|browse|")):
            with self.subTest(broken=broken):
                self.assertNotEqual(broken, good)
                self.assertTrue(matcher_gaps(broken))

    def test_guard_denies_what_reaches_it(self):
        self.assertTrue(HOOK.is_file())
        result = subprocess.run(
            [sys.executable, str(HOOK)],
            input=json.dumps({"tool_name": LOCAL + "legal_commons__push", "tool_input": {}}),
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        decision = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(decision["hookEventName"], "PreToolUse")
        self.assertEqual(decision["permissionDecision"], "deny")


if __name__ == "__main__":
    unittest.main()
