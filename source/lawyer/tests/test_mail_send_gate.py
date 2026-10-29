"""mail-send-gate.py: a model send is refused with the draft route, a dry run and the morning
briefing pass, and its own error fails open, loudly."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "mail-send-gate.py"
TOOL = "mcp__plugin_lawyer_contacts-calendars-email__mail_send_email"


def run(stdin: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(HOOK)], input=stdin.encode("utf-8"), capture_output=True, timeout=30)


def send(**tool_input) -> subprocess.CompletedProcess:
    return run(json.dumps({"hook_event_name": "PreToolUse", "tool_name": TOOL, "tool_input": tool_input}))


def test_a_send_is_refused_with_the_draft_route():
    result = send(to="a@example.com", subject="Your matter", body="Hello")
    assert result.returncode == 0
    output = json.loads(result.stdout)["hookSpecificOutput"]
    assert list(output) == ["hookEventName", "permissionDecision", "permissionDecisionReason"]
    assert output["hookEventName"] == "PreToolUse"
    assert output["permissionDecision"] == "deny"
    assert output["permissionDecisionReason"].startswith("Refused: Probanda never sends email itself.")
    assert "open it in Outlook, check it and click Send" in output["permissionDecisionReason"]
    assert result.stdout.endswith(b"\n")


def test_a_dry_run_and_the_morning_briefing_pass_silently():
    for tool_input in ({"to": "a@example.com", "subject": "Hi", "dryRun": True},
                       {"to": "me@example.com", "subject": "Morning briefing 2026-10-24"}):
        result = send(**tool_input)
        assert result.returncode == 0
        assert result.stdout == b""


def test_a_dry_run_must_be_true_itself():
    assert send(subject="Hi", dryRun="true").stdout != b""


def test_the_matcher_catches_the_imap_send_and_reply_tools():
    import re
    plugin = json.loads((HOOK.parent.parent / "plugin.json").read_text(encoding="utf-8"))
    matchers = [entry["matcher"] for entry in plugin["hooks"]["PreToolUse"]
                if any("mail-send-gate.py" in " ".join(hook["args"]) for hook in entry["hooks"])]
    assert len(matchers) == 1
    for name in ("mcp__imap__imap_send_email", "mcp__imap__imap_reply_to_email", TOOL):
        assert re.search(matchers[0], name), name
    for name in ("mcp__imap__imap_save_draft", "mcp__imap__imap_send_email_preview"):
        assert not re.search(matchers[0], name), name


def test_its_own_error_allows_the_call_loudly():
    result = run("not json")
    assert result.returncode == 0
    assert result.stdout == b""
    assert "mail-send-gate hook error (allowing" in result.stderr.decode("utf-8")
