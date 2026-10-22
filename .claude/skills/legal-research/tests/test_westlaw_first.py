"""Regression locks for the Westlaw-first research fix.

CanLII-first research has recurred repeatedly: the audit agent went to CanLII,
whose API returns no decision text, and closed its gate with Westlaw never run.
Each test here pins one piece of the fix in
`docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md` (§4, §5.1, §8),
so an edit that undoes it fails the build.
"""
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = SKILL_ROOT.parent
REPO_ROOT = SKILLS_ROOT.parents[1]
SHARED = SKILLS_ROOT / "shared"
SOURCE = REPO_ROOT / "source"
# Every plugin's source folder. The researcher plugin ships these agents and the CanLII server.
PLUGIN_SOURCES = sorted(p.parent for p in SOURCE.glob("*/roster.json"))
LITIGATION = SOURCE / "researcher"
RESEARCH_LAWYER = LITIGATION / "agents" / "research-agent.md"
PARALEGAL_COPIES = (
    LITIGATION / "agents" / "research-paralegal.md",
)
CITATION_CHECKER = LITIGATION / "agents" / "citation-checker.md"
# Every agent that drives the shared Chrome session to reach Westlaw.
CHROME_AGENTS = PARALEGAL_COPIES + (CITATION_CHECKER,)
NOTE_UP_PLAYBOOK = SHARED / "citation-checker" / "note-up.md"
HOOK = SKILL_ROOT / "hooks" / "block-main-session-canlii.py"
CANLII_SRC = LITIGATION / "canlii-mcp" / "src" / "index.ts"
CANLII_DIST = LITIGATION / "canlii-mcp" / "dist" / "canlii-mcp.js"

CANLII_TOOL_RE = re.compile(r"^mcp__(?:.+__)?plugin_researcher_canlii__(.+)$")
LOCAL = "mcp__plugin_researcher_canlii__"
BRIDGED = "mcp__remote-devices__plugin_researcher_canlii__"
LEGISLATION_TOOLS = ("get_legislation_databases", "browse_legislation",
                     "get_legislation_regulation_metadata")
CITATOR_ALLOW_LIST = {"get_case_citator", "get_case_citator_tease", "configure_status"}

SHIM_RULE = (
    "**CanLII has no decision text. Its API returns index metadata and citator links only. "
    "Do not call CanLII to find, read, or check the content of any decision. If you need a "
    "decision that is not on disk, stop and return `needs_download: [citations]`. The caller "
    "downloads it from Westlaw and re-invokes you once, with `Re-invocation: yes` in the spawn "
    "prompt. On that re-invocation, never return `needs_download`: offer the decision as "
    "research instead.**"
)

# Split so this file never carries the phrases it bans.
BANNED_PHRASES = (
    "slow, " + "costly",
    "primary entry point " + "for legal research",
    "Full-text " + "search query",
)
SKIPPED_DIRS = {"node_modules", ".git", "__pycache__", "build"}

COVERAGE_WESTLAW = "Westlaw: run (n decisions, memo Y/N) / not run: <reason>"
REINVOCATION_FIELD = "Re-invocation: no / yes: Westlaw did not return <citations, or none>"
REINVOCATION_EXCEPTION = "return needs_download, unless Re-invocation is yes"
SECOND_PASS_RULE = (
    "When the spawn prompt's `Re-invocation:` field reads `yes`, never return `needs_download`."
)
REINVOCATION_STATUS = "; paralegal: <its status line"
STATUSLESS_YES_RULE = "A `yes` with no paralegal status reads as `no`."
FRONT_DOOR_STATUS = "that dispatch's status line and every citation it did not retrieve"
SKIP_PINPOINT_LINE = (
    "not run: tiers 1–3 held pinpointable text: <file> para <n>[; <file> para <n>]"
)
SKIP_NO_PINPOINT_RULE = "A skip that names no pinpoint is not a skip"
DECLINED = "not run: practitioner declined"
AUDIT_SKIP_CHECK = "**A Westlaw skip is checked, not trusted.**"
NO_TEXT_NOTICE = "No decision text is included in this response or available through this API."


def read(path):
    return path.read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def split_frontmatter(path):
    lines = read(path).splitlines()
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


def plugin_files():
    """Every file the Probanda plugins ship or serve: each plugin's tree, and the
    skill source its skill_source mirror carries (its roster plus shared/)."""
    roots = [*PLUGIN_SOURCES, SHARED]
    for source in PLUGIN_SOURCES:
        roster = json.loads((source / "roster.json").read_text(encoding="utf-8"))
        roots += [SKILLS_ROOT / name for name in roster]
    for root in roots:
        for path in root.rglob("*"):
            if path.is_file() and not SKIPPED_DIRS.intersection(path.relative_to(root).parts):
                yield path
    yield from PARALEGAL_COPIES


class AuditAgentGrantAndShimTests(unittest.TestCase):
    def test_research_lawyer_holds_no_canlii_tool(self):
        # Noting up moved to citation-checker (2026-10-22): the audit agent reads its records.
        tools = granted_tools(RESEARCH_LAWYER)
        self.assertEqual([tool for tool in tools if CANLII_TOOL_RE.match(tool)], [])

    def test_citation_checker_canlii_grant_is_the_citator_allow_list_under_both_names(self):
        tools = granted_tools(CITATION_CHECKER)
        canlii = {m.group(1) for m in map(CANLII_TOOL_RE.match, tools) if m}
        self.assertEqual(canlii, CITATOR_ALLOW_LIST)
        for name in CITATOR_ALLOW_LIST:
            self.assertIn(LOCAL + name, tools)
            self.assertIn(BRIDGED + name, tools)

    def test_research_paralegal_has_no_canlii_grant(self):
        # Its legislation-currency mode (#1163) retired into the canlii
        # legislation_currency tool (2026-10-06); its canlii-only citation mode
        # works through Chrome, never the API.
        for path in PARALEGAL_COPIES:
            tools = granted_tools(path)
            canlii = [tool for tool in tools if CANLII_TOOL_RE.match(tool)]
            self.assertEqual(canlii, [], path.name)

    def test_research_lawyer_shim_states_the_rule_before_the_protocol_fetch(self):
        _, body = split_frontmatter(RESEARCH_LAWYER)
        rule_at = body.find(SHIM_RULE)
        self.assertNotEqual(rule_at, -1, "shim rule missing or reworded")
        self.assertLess(rule_at, body.find("Your protocol is"))
        self.assertLess(rule_at, body.find("shared/legal-audit-protocol.md"))


class DoctrineTests(unittest.TestCase):
    def test_research_priority_makes_westlaw_a_tier_and_canlii_note_up_only(self):
        text = read(SHARED / "research-priority.md")
        self.assertIn("returns no decision text", text)
        lines = text.splitlines()
        tier_rows = [line for line in lines if re.match(r"^\|\s*\d+\s*\|", line)]
        self.assertTrue(any("Westlaw" in row for row in tier_rows), "no Westlaw tier")
        for row in tier_rows:
            self.assertNotIn("CanLII", row, "CanLII is back on the answering ladder")
        note_up = [line for line in lines if line.startswith("| Note-up (citator) only |")]
        self.assertEqual(len(note_up), 1)
        self.assertIn("CanLII", note_up[0])

    def test_coverage_line_requires_a_westlaw_reason(self):
        for name in ("research-priority.md", "legal-audit-protocol.md", "legal-audit-scoped.md"):
            with self.subTest(name=name):
                self.assertIn(COVERAGE_WESTLAW, read(SHARED / name))

    def test_gate_makes_westlaw_a_pre_spawn_duty_and_carves_out_the_hand_off(self):
        text = read(SHARED / "legal-research.md")
        before_spawn = text[text.index("**Before spawning, run what the agent cannot.**"):
                            text.index("**When the gate closes, closed is the answer.**")]
        self.assertIn("Five duties fall", before_spawn)
        self.assertRegex(before_spawn, r"(?m)^3\. \*\*Tier 4, Westlaw")
        self.assertRegex(before_spawn, r"(?m)^4\. \*\*Legislation text")
        self.assertRegex(before_spawn, r"(?m)^5\. \*\*Note-up, before the audit")
        self.assertIn(
            "A `needs_download` or hand-off-packet return is a pipeline step, not a closed gate.",
            flat(before_spawn),
        )

    def test_spawn_template_marks_the_needs_download_re_invocation(self):
        # #1422: without the field the re-invoked agent cannot tell it is on its
        # second pass, returns needs_download again, and the caller relays a closed gate.
        text = read(SHARED / "legal-research.md")
        template = text[text.index("**Spawn the agent from this template.**"):
                        text.index("**A `needs_download` or hand-off-packet return")]
        self.assertIn(REINVOCATION_FIELD, template)
        self.assertIn(REINVOCATION_EXCEPTION, template)
        self.assertIn("`Re-invocation: yes`", flat(text[text.index(
            "**A `needs_download` or hand-off-packet return"):]))
        front_door = flat(read(SKILL_ROOT / "SKILL.md"))
        self.assertIn("`Re-invocation: no`", front_door)
        self.assertIn("`Re-invocation: yes`", front_door)
        self.assertIn(SECOND_PASS_RULE, flat(read(SHARED / "legal-audit-protocol.md")))

    def test_re_invocation_yes_carries_the_paralegal_status(self):
        # #1598: a free-text `yes` let a caller skip the westlaw-first dispatch.
        self.assertIn(REINVOCATION_FIELD + REINVOCATION_STATUS, read(SHARED / "legal-research.md"))
        self.assertIn(STATUSLESS_YES_RULE, flat(read(SHARED / "legal-audit-protocol.md")))
        self.assertIn(FRONT_DOOR_STATUS, flat(read(SKILL_ROOT / "SKILL.md")))

    def test_a_westlaw_skip_names_a_pinpoint_per_issue_and_the_audit_checks_it(self):
        # 2026-10-05 skip-evidence spec: a bare "not run: tiers 1–3 held pinpointable
        # text" left the caller's judgement unauditable.
        text = read(SHARED / "legal-research.md")
        template = text[text.index("**Spawn the agent from this template.**"):
                        text.index("**A `needs_download` or hand-off-packet return")]
        westlaw_lines = [line for line in template.splitlines() if line.startswith("Westlaw:")]
        self.assertEqual(len(westlaw_lines), 1)
        self.assertIn(SKIP_PINPOINT_LINE, westlaw_lines[0])
        self.assertNotRegex(westlaw_lines[0], r"held pinpointable text(?!: <file> para <n>)")
        duty_3 = flat(text[text.index("3. **Tier 4, Westlaw"):text.index("4. **Legislation text")])
        self.assertIn(SKIP_PINPOINT_LINE, duty_3)
        self.assertIn(SKIP_NO_PINPOINT_RULE, duty_3)
        protocol = flat(read(SHARED / "legal-audit-protocol.md"))
        check = protocol[protocol.index(AUDIT_SKIP_CHECK):]
        self.assertLess(protocol.index(AUDIT_SKIP_CHECK), protocol.index("### Step 3"))
        self.assertIn("return a hand-off packet for that issue", check)
        self.assertIn("notes below the coverage line", check)

    def test_a_practitioner_decline_is_a_fixed_reason_and_dispatches_nothing(self):
        # #1654: free text in `Westlaw:` was read as overriding the needs_download rule.
        text = read(SHARED / "legal-research.md")
        template = text[text.index("**Spawn the agent from this template.**"):
                        text.index("**A `needs_download` or hand-off-packet return")]
        westlaw_lines = [line for line in template.splitlines() if line.startswith("Westlaw:")]
        self.assertIn(DECLINED, westlaw_lines[0])
        self.assertNotIn("<other reason>", westlaw_lines[0])
        self.assertIn(REINVOCATION_FIELD + REINVOCATION_STATUS + ", or practitioner declined>",
                      template)
        duty_3 = flat(text[text.index("3. **Tier 4, Westlaw"):text.index("4. **Legislation text")])
        self.assertIn("unless the practitioner declined it this run", duty_3)
        loop = flat(text[text.index("**A `needs_download` or hand-off-packet return"):
                         text.index("**When the gate closes")])
        self.assertIn("a declined issue dispatches nothing", loop)
        front_door = flat(read(SKILL_ROOT / "SKILL.md"))
        self.assertIn("unless the practitioner declined:", front_door)
        self.assertIn("download or run it (unless declined) through", front_door)

    def test_a_packet_beside_other_gaps_still_runs_the_loop(self):
        # #1630: "only gap" left a packet-plus-offers return with neither path taken.
        # The loop runs only on the question's own issues (live-issue test §3).
        for path in (SHARED / "legal-research.md", SKILL_ROOT / "SKILL.md"):
            text = flat(read(path))
            with self.subTest(path=path.name):
                self.assertIn("whatever its other gaps", text)
                self.assertIn("hand-off packet on an issue of the question", text)
                self.assertNotIn("only gap", text)
        self.assertIn("If its disclosure gate is closed after any loop",
                      flat(read(SKILL_ROOT / "SKILL.md")))

    def test_westlaw_unreachable_is_a_stop_never_a_canlii_fallback(self):
        download = read(SHARED / "research-paralegal" / "citation-download.md")
        for gone in ("all remaining citations go to CanLII",
                     "all citations retrieved via CanLII",
                     "proceed via CanLII per the source selection policy"):
            self.assertNotIn(gone, download)
        deep = read(SHARED / "research-paralegal" / "westlaw-deep-research.md")
        self.assertNotIn("not-logged-in", deep)
        gate = flat(read(SHARED / "legal-research.md"))
        self.assertIn("stop the whole question", gate)
        for path in (SHARED / "research-paralegal" / "citation-download.md",
                     SHARED / "research-paralegal" / "westlaw-deep-research.md",
                     SHARED / "legal-research.md", *CHROME_AGENTS):
            text = read(path)
            for status in ("blocked (chrome-not-connected)", "blocked (westlaw-not-signed-in)"):
                with self.subTest(path=path.name, status=status):
                    self.assertIn(status, text)
        for path in CHROME_AGENTS:
            with self.subTest(path=str(path)):
                check = flat(read(path))
                navigate = check.index("Navigate a tab to `https://nextcanada.westlaw.com`")
                self.assertLess(check.index("Call `tabs_context_mcp`"), navigate)
                self.assertLess(navigate, check.index("blocked (westlaw-not-signed-in)", navigate))

    def test_chrome_not_connected_only_after_the_chrome_reach_ladder(self):
        # 2026-10-06 chrome-retry spec: the paralegal returned chrome-not-connected
        # with Chrome connected, never having tried to reach it.
        for name in ("citation-download.md", "westlaw-deep-research.md"):
            text = flat(read(SHARED / "research-paralegal" / name))
            with self.subTest(playbook=name):
                self.assertNotIn("Chrome is not connected, return", text)
                self.assertIn("Chrome reach ladder", text)
        for path in CHROME_AGENTS:
            text = flat(read(path))
            for phrase in ("Chrome reach ladder", "createIfEmpty", "chrome-tools-absent", "tried:"):
                with self.subTest(path=path.name, phrase=phrase):
                    self.assertIn(phrase, text)
            self.assertIn("ToolSearch", granted_tools(path))


class NoteUpRoutingTests(unittest.TestCase):
    def test_the_gate_routes_every_note_up_to_citation_checker(self):
        text = read(SHARED / "legal-research.md")
        self.assertNotIn("Use CanLII for citator note-up only", text)
        duty_5 = flat(text[text.index("5. **Note-up, before the audit"):
                           text.index("**Westlaw unreachable is a hard stop.**")])
        self.assertIn("dispatch `citation-checker`", duty_5)
        self.assertIn("never sent to it", duty_5)
        self.assertIn("citation-checker returns", flat(text))
        template = text[text.index("**Spawn the agent from this template.**"):
                        text.index("**A `needs_download` or hand-off-packet return")]
        self.assertEqual(len([l for l in template.splitlines() if l.startswith("Note-up:")]), 1)

    def test_keycite_runs_before_the_canlii_citator(self):
        rows = [line for line in read(NOTE_UP_PLAYBOOK).splitlines()
                if re.match(r"^\|\s*\d+\s*\|", line)]
        self.assertIn("KeyCite", rows[0])
        self.assertIn("CanLII", rows[1])
        self.assertIn("no CanLII call in its place", flat(read(NOTE_UP_PLAYBOOK)))

    def test_citation_checker_never_classifies_treatment(self):
        text = flat(read(CITATION_CHECKER))
        self.assertIn("never classifies treatment", text)
        self.assertIn("Never open, read, quote or summarize a citing decision", text)

    def test_research_agent_has_no_note_up_mode(self):
        scoped = read(SHARED / "legal-audit-scoped.md")
        self.assertNotIn("## `mode: note-up`", scoped)
        self.assertIn("needs_note_up", read(SHARED / "legal-audit-protocol.md"))


class CanliiServerTests(unittest.TestCase):
    def test_banned_phrases_appear_nowhere_in_the_plugin(self):
        hits = []
        for path in plugin_files():
            data = path.read_bytes()
            hits += [f"{path.relative_to(REPO_ROOT)}: {p!r}" for p in BANNED_PHRASES
                     if p.encode("utf-8") in data]
        self.assertEqual(hits, [])

    def test_source_and_bundle_tell_the_truth_about_decision_text(self):
        for path in (CANLII_SRC, CANLII_DIST):
            with self.subTest(path=path.name):
                self.assertIn(NO_TEXT_NOTICE, read(path))


class InAgentHookTests(unittest.TestCase):
    AUDIT_AGENTS = ("researcher:research-agent", "researcher:citation-checker")

    def test_audit_agents_are_blocked_from_every_non_citator_canlii_tool(self):
        for agent_type in self.AUDIT_AGENTS:
            for tool in LEGISLATION_TOOLS:
                for prefix in (LOCAL, BRIDGED):
                    with self.subTest(agent_type=agent_type, tool=prefix + tool):
                        result = run_hook(prefix + tool, agent_id="a1", agent_type=agent_type)
                        self.assertEqual(result.returncode, 2, result.stderr)
                        self.assertIn("CanLII has no decision text", result.stderr)
                        self.assertIn("needs_download", result.stderr)

    def test_only_citation_checker_keeps_the_citator(self):
        for tool in ("get_case_citator", "get_case_citator_tease", "configure_status"):
            with self.subTest(tool=tool):
                result = run_hook(LOCAL + tool, agent_id="a1",
                                  agent_type="researcher:citation-checker")
                self.assertEqual(result.returncode, 0, result.stderr)
        for agent_type in ("researcher:research-agent", "researcher:research-paralegal"):
            for tool in ("get_case_citator", "get_case_citator_tease"):
                with self.subTest(agent_type=agent_type, tool=tool):
                    result = run_hook(LOCAL + tool, agent_id="a1", agent_type=agent_type)
                    self.assertEqual(result.returncode, 2, result.stderr)

    def test_research_paralegal_no_longer_keeps_the_legislation_tools(self):
        # Its legislation-currency mode retired into legislation_currency (2026-10-06).
        for tool in LEGISLATION_TOOLS:
            with self.subTest(tool=tool):
                result = run_hook(LOCAL + tool, agent_id="a1",
                                  agent_type="researcher:research-paralegal")
                self.assertEqual(result.returncode, 2, result.stderr)

    def test_every_agent_may_run_legislation_currency(self):
        for agent_type in self.AUDIT_AGENTS + ("researcher:research-paralegal",):
            with self.subTest(agent_type=agent_type):
                result = run_hook(LOCAL + "legislation_currency", agent_id="a1", agent_type=agent_type)
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
