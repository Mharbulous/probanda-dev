#!/usr/bin/env python3
# REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/.
"""Claude Code PreToolUse hook (matcher: CanLII server tools, local or device-bridged).

Two guards over the CanLII research tools:

- The main session never calls them. A main-session call is the closed-gate
  bypass recorded in #491.
- Inside a subagent, CanLII is note-up only. CanLII's API returns no decision
  text, so any other tool is an attempt to find or read a decision through
  CanLII (the CanLII-first failure).

legislation_currency runs anywhere, the main session included: it is leg 1 of
shared/statute-currency.md as one deterministic call, reports metadata about an
instrument's own record and states no law. The raw legislation tools it
composes are no agent's grant any more (research-paralegal's
legislation-currency mode retired into it, 2026-10-06).

Policy (closed-gate rule, Westlaw-first gate): .claude/skills/shared/legal-research.md

Decision rule
  1. Not a CanLII server tool, a credential setup tool, or
     legislation_currency                                        -> allow.
  2. The call comes from a plugin-shipped agent (hook input has
     agent_id, and agent_type carries a litigation: or
     legal-commons: prefix):
     a. citator tool                                             -> allow.
     b. any other CanLII tool                                    -> block (exit 2).
  3. Otherwise (main session, or a non-plugin subagent)          -> block (exit 2).

Registered in plugins/litigation/.claude-plugin/plugin.json. Fails OPEN on any
unexpected error, loudly.
"""
import json
import re
import sys

CANLII_TOOL_RE = re.compile(r"^mcp__(?:.+__)?plugin_probanda_canlii__(.+)$")
SETUP_TOOLS = {"configure_status", "configure_credential"}
CURRENCY_TOOL = "legislation_currency"
CITATOR_TOOLS = {"get_case_citator", "get_case_citator_tease"}
RESEARCH_AGENT_PREFIXES = ("probanda:",)

BLOCK_MESSAGE = """Blocked: CanLII research tools run only inside research-agent (citator only), never in the main session.
A statute-currency check is the canlii legislation_currency tool, which runs here.
A question about what the law is goes through /legal-research. If its agent's gate closed, relay the agent's confidence summary and research offers verbatim and stop. A closed gate is never a licence to research or answer the question yourself.
If the research agent is unavailable, report that the Probanda plugin needs a re-import and full app restart, and stop."""

IN_AGENT_BLOCK_MESSAGE = """Blocked: CanLII has no decision text. Its API returns index metadata and citator links only. Do not call CanLII to find, read, or check the content of any decision. If you need a decision that is not on disk, stop and return `needs_download: [citations]`. The caller downloads it from Westlaw and re-invokes you once, with `Re-invocation: yes` in the spawn prompt. On that re-invocation, never return `needs_download`: offer the decision as research instead.
Inside this agent only the CanLII citator (get_case_citator, get_case_citator_tease) and configure_status run."""


def main():
    payload = json.load(sys.stdin)
    match = CANLII_TOOL_RE.match(payload.get("tool_name") or "")
    if match is None or match.group(1) in SETUP_TOOLS or match.group(1) == CURRENCY_TOOL:
        return 0
    agent_type = payload.get("agent_type") or ""
    if payload.get("agent_id") and agent_type.startswith(RESEARCH_AGENT_PREFIXES):
        if match.group(1) in CITATOR_TOOLS:
            return 0
        sys.stderr.write(IN_AGENT_BLOCK_MESSAGE + "\n")
        return 2
    sys.stderr.write(BLOCK_MESSAGE + "\n")
    return 2


if __name__ == "__main__":
    try:
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # fail OPEN, loudly
        sys.stderr.write(
            "block-main-session-canlii hook error (allowing call): "
            + type(exc).__name__ + ": " + str(exc) + "\n"
        )
        sys.exit(0)
