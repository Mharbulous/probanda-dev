#!/usr/bin/env python3
# REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/.
"""Claude Code PreToolUse hook (matcher: CanLII server tools, local or device-bridged).

Two guards over the CanLII research tools:

- The main session never calls them. A main-session call is the closed-gate
  bypass recorded in #491.
- Inside a subagent, CanLII is note-up only, and only citation-checker notes
  up. CanLII's API returns no decision text, so any other tool is an attempt
  to find or read a decision through CanLII (the CanLII-first failure).

legislation_currency runs anywhere, the main session included: it is leg 1 of
shared/statute-currency.md as one deterministic call, reports metadata about an
instrument's own record and states no law. The raw legislation tools it
composes are no agent's grant any more (the legislation-currency mode of
law-getter's predecessor retired into it, 2026-10-06).

Policy (closed-gate rule, Westlaw-first gate): .claude/skills/shared/legal-research.md

Decision rule
  1. Not a CanLII server tool, a credential setup tool, or
     legislation_currency                                        -> allow.
  2. The call comes from an agent the researcher plugin ships (hook
     input has agent_id, and agent_type carries the researcher:
     prefix):
     a. citator tool, from citation-checker                      -> allow.
     b. any other CanLII tool, or the citator from another agent -> block (exit 2).
  3. Otherwise (main session, or any other subagent)             -> block (exit 2).

Registered in source/researcher/plugin.json. Fails OPEN on any
unexpected error, loudly.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
import hook_io  # noqa: E402

CANLII_TOOL_RE = re.compile(r"^mcp__(?:.+__)?plugin_researcher_canlii__(.+)$")
SETUP_TOOLS = {"configure_status", "configure_credential"}
CURRENCY_TOOL = "legislation_currency"
CITATOR_TOOLS = {"get_case_citator", "get_case_citator_tease"}
RESEARCH_AGENT_PREFIXES = ("researcher:",)
NOTE_UP_AGENT = "researcher:citation-checker"

BLOCK_MESSAGE = """Blocked: CanLII research runs only inside the step that notes up a case, never in the main session.
A check that a statute is current is CanLII's legislation currency check, which runs here.
A question about what the law is goes through /legal-research. If its memo is INCOMPLETE or its research stopped, relay its confidence line and the research it names verbatim and stop. An INCOMPLETE memo is never a licence to research or answer the question yourself.
If the research is unavailable, report that the Probanda plugin needs a re-import and full app restart, and stop."""

IN_AGENT_BLOCK_MESSAGE = """Blocked: CanLII has no decision text. Its API returns index metadata and citator links only. Do not call CanLII to find, read, or check the content of any decision. If you need a decision that is not on disk, stop and return `needs_download: [citations]`. The caller downloads it from Westlaw and re-invokes you once, with `Re-invocation: yes` in the spawn prompt. On that re-invocation, never return `needs_download`: offer the decision as research instead.
The CanLII citator (get_case_citator, get_case_citator_tease) runs only inside citation-checker, which notes up decisions for the /legal-research gate. configure_status runs anywhere."""


def main():
    payload = hook_io.payload()
    match = CANLII_TOOL_RE.match(payload.get("tool_name") or "")
    if match is None or match.group(1) in SETUP_TOOLS or match.group(1) == CURRENCY_TOOL:
        return 0
    agent_type = payload.get("agent_type") or ""
    if payload.get("agent_id") and agent_type.startswith(RESEARCH_AGENT_PREFIXES):
        if match.group(1) in CITATOR_TOOLS and agent_type == NOTE_UP_AGENT:
            return 0
        return hook_io.refuse(IN_AGENT_BLOCK_MESSAGE)
    return hook_io.refuse(BLOCK_MESSAGE)


if __name__ == "__main__":
    hook_io.run(main, "block-main-session-canlii")
