#!/usr/bin/env python3
"""Claude Code PreToolUse hook (matcher: Skill).

The /legal-research gate runs only in the main session. It spawns
law-getter and the audit agent, and a subagent
cannot spawn agents, so a gate invoked inside one fails partway through and
every currency result comes back validation_unavailable. This refuses that
invocation on the first call, before anything is dispatched.

Decision rule
  1. Not the Skill tool, or a skill other than legal-research      -> allow.
  2. args start with westlaw-query-optimizer (drafts a query only)  -> allow.
  3. The call comes from a subagent (hook input has agent_id)       -> block (exit 2).
  4. Otherwise (main session)                                       -> allow.

The skill's own first gate line is the backstop for a subagent that reads
SKILL.md without the Skill tool. Policy: source/skills/shared/legal-research.md

Registered in plugins/litigation/.claude-plugin/plugin.json. Fails OPEN on any
unexpected error, loudly.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
import hook_io  # noqa: E402

GATE_SKILL = "legal-research"
QUERY_SUBSKILL = "westlaw-query-optimizer"

BLOCK_MESSAGE = """Blocked: /legal-research runs only from the main session. It spawns law-getter and the audit agent, and a subagent cannot spawn agents. Nothing was dispatched.
Stop and return this item to the main session, which runs /legal-research itself. Never answer the question yourself in its place."""


def main():
    payload = hook_io.payload()
    if payload.get("tool_name") != "Skill":
        return 0
    tool_input = payload.get("tool_input") or {}
    name = (tool_input.get("skill") or "").lstrip("/").split(":")[-1]
    if name != GATE_SKILL:
        return 0
    if (tool_input.get("args") or "").strip().startswith(QUERY_SUBSKILL):
        return 0
    if payload.get("agent_id"):
        return hook_io.refuse(BLOCK_MESSAGE)
    return 0


if __name__ == "__main__":
    hook_io.run(main, "block-subagent-legal-research")
