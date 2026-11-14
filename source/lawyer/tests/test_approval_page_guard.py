"""approval-page-guard.py: a session may not open, post to or read what approves a step for a tool
that checks its own approval (the /approve/ page on this computer and page-api.secret)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "source" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
HOOK = REPO / "source" / "lawyer" / "hooks" / "approval-page-guard.py"
URL = "http://127.0.0.1:53211/approve/" + "a" * 48


def decision(tool_name, tool_input):
    result = run_hook(HOOK, {"hook_event_name": "PreToolUse", "tool_name": tool_name, "tool_input": tool_input})
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"] if result.stdout else "allow"


def test_the_page_and_the_secret_are_refused_in_every_guarded_tool():
    assert decision("Bash", {"command": f"curl -X POST {URL}"}) == "deny"
    assert decision("PowerShell", {"command": "Invoke-WebRequest http://localhost:5000//approve/x"}) == "deny"
    assert decision("mcp__remote-devices__device_bash", {"command": "type %APPDATA%\\Probanda\\page-api.secret"}) == "deny"
    assert decision("Read", {"file_path": r"C:\Users\x\AppData\Roaming\Probanda\page-api.secret"}) == "deny"
    assert decision("mcp__claude-in-chrome__navigate", {"url": URL, "tabId": 1}) == "deny"
    assert decision("mcp__Claude_Browser__javascript_tool", {"text": f"fetch('{URL}', {{method: 'POST'}})"}) == "deny"


def test_other_pages_and_files_are_let_through():
    assert decision("Bash", {"command": "curl http://127.0.0.1:47616/h/abc/"}) == "allow"
    assert decision("Read", {"file_path": r"C:\Users\x\AppData\Roaming\Probanda\probanda.json"}) == "allow"
    assert decision("mcp__claude-in-chrome__navigate", {"url": "https://example.test/approve/1"}) == "allow"


def test_the_lawyer_matcher_covers_the_guarded_tools_only():
    manifest = json.loads((REPO / "source" / "lawyer" / "plugin.json").read_text(encoding="utf-8"))
    matchers = [entry["matcher"] for entry in manifest["hooks"]["PreToolUse"]
                if any("approval-page-guard.py" in " ".join(hook["args"]) for hook in entry["hooks"])]
    assert len(matchers) == 1
    for name in ("Bash", "PowerShell", "Read", "WebFetch", "mcp__remote-devices__device_bash",
                 "mcp__workspace__bash", "mcp__claude-in-chrome__navigate", "mcp__Claude_Browser__computer"):
        assert re.fullmatch(matchers[0], name), name
    for name in ("Write", "Grep", "mcp__plugin_lawyer_data__matter_data__query", "mcp__computer-use__screenshot"):
        assert not re.fullmatch(matchers[0], name), name
