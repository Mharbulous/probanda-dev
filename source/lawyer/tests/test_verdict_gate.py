"""verdict-gate.py: only the email-reader agent records a verdict on copies of an email."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / ".claude" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "verdict-gate.py"
PLUGIN_JSON = Path(__file__).resolve().parents[1] / "plugin.json"
TOOL = "mcp__plugin_lawyer_contacts-calendars-email__mail__dedupe_record_verdicts"
BRIDGED = "mcp__remote-devices__plugin_lawyer_contacts-calendars-email__mail__dedupe_record_verdicts"
REFUSAL = "Refused: a verdict on copies of an email is recorded only by the step that checks those copies. Nothing was recorded."


def run(**payload) -> subprocess.CompletedProcess:
    return run_hook(HOOK, {"hook_event_name": "PreToolUse", "tool_name": TOOL, "tool_input": {}, **payload})


def refused(result: subprocess.CompletedProcess) -> bool:
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    assert output["permissionDecisionReason"] == REFUSAL
    return True


def test_the_reader_agent_passes_silently():
    result = run(agent_type="lawyer:email-reader", agent_id="a1")
    assert result.returncode == 0
    assert result.stdout == b""


def test_the_main_session_is_refused():
    assert refused(run())


@pytest.mark.parametrize("agent_type", ["lawyer:extract-facts", "email-reader", "other:email-reader", "lawyer:email-reader2", "", None])
def test_any_other_caller_is_refused(agent_type):
    assert refused(run(agent_type=agent_type, agent_id="a1"))


def test_a_payload_it_cannot_read_is_refused():
    assert refused(run_hook(HOOK, "not json"))


def test_the_refusal_only_blocks_and_never_asks_the_model_to_act():
    for word in ("retry", "instead", "dispatch", "call ", "please", "email-reader", "mail__"):
        assert word not in REFUSAL.lower()


def matchers() -> list[str]:
    groups = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))["hooks"]["PreToolUse"]
    return [g["matcher"] for g in groups if any("verdict-gate.py" in arg for h in g["hooks"] for arg in h.get("args", []))]


def test_the_plugin_runs_the_hook_on_both_names_of_the_tool_and_on_no_other_mail_tool():
    [matcher] = matchers()
    for name in (TOOL, BRIDGED):
        assert re.search(matcher, name), name
    for name in ("read_comparison", "scan", "apply", "plan_tier2"):
        assert not re.search(matcher, TOOL.replace("dedupe_record_verdicts", f"dedupe_{name}")), name
