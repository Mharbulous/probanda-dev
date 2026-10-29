"""housekeeping-approval-guard.py: Write, Edit and a shell command on a housekeeping run's
approval.json are refused; other files and commands pass; its own error fails open, loudly."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "housekeeping-approval-guard.py"
APPROVAL = r"C:\Matters\Smith case data\housekeeping\20260924-100000123-a1b2\approval.json"


def run(stdin: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(HOOK)], input=stdin.encode("utf-8"), capture_output=True, timeout=30)


def call(tool_name: str, **tool_input) -> subprocess.CompletedProcess:
    return run(json.dumps({"hook_event_name": "PreToolUse", "tool_name": tool_name, "tool_input": tool_input}))


def refused(result: subprocess.CompletedProcess) -> bool:
    assert result.returncode == 0
    if result.stdout == b"":
        return False
    output = json.loads(result.stdout)["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    assert output["permissionDecisionReason"].startswith("Refused:")
    return True


def test_write_and_edit_of_a_run_approval_are_refused():
    assert refused(call("Write", file_path=APPROVAL, content="{}"))
    assert refused(call("Edit", file_path=APPROVAL, old_string="a", new_string="b"))
    assert refused(call("MultiEdit", file_path=APPROVAL.replace("\\", "/"), edits=[]))
    assert refused(call("Write", file_path=APPROVAL.replace("20260924-100000123-a1b2", "20260924-100000-a1b2"), content="{}"))
    assert refused(call("Write", file_path=APPROVAL.upper(), content="{}"))


def test_other_files_pass():
    assert not refused(call("Write", file_path=APPROVAL.replace("approval.json", "proposal.json"), content="{}"))
    assert not refused(call("Write", file_path=r"C:\work\approval.json", content="{}"))
    assert not refused(call("Edit", file_path=r"C:\Matters\Smith\3. CORRESPONDENCE\letter.md", old_string="a", new_string="b"))


def test_a_shell_command_naming_a_run_approval_is_refused():
    assert refused(call("Bash", command=f'echo {{}} > "{APPROVAL}"'))
    assert refused(call("PowerShell", command=f"Set-Content -Path '{APPROVAL}' -Value '{{}}'"))
    assert refused(call("Bash", command="cd 'case data/housekeeping/20260924-100000-a1b2' && rm approval.json"))
    assert refused(call("mcp__workspace__bash", command=f"cp x.json '{APPROVAL.replace(chr(92), '/')}'"))


def test_other_shell_commands_pass():
    assert not refused(call("Bash", command="git status"))
    assert not refused(call("Bash", command="cat approval.json"))
    assert not refused(call("Bash", command=f'cat "{APPROVAL.replace("approval.json", "proposal.json")}"'))


def test_the_matcher_catches_the_edit_and_shell_tools_only():
    plugin = json.loads((HOOK.parent.parent / "plugin.json").read_text(encoding="utf-8"))
    matchers = [entry["matcher"] for entry in plugin["hooks"]["PreToolUse"]
                if any("housekeeping-approval-guard.py" in " ".join(hook["args"]) for hook in entry["hooks"])]
    assert len(matchers) == 1
    for name in ("Write", "Edit", "MultiEdit", "Bash", "PowerShell", "mcp__workspace__bash", "mcp__x__device_bash"):
        assert re.search(matchers[0], name), name
    for name in ("Read", "Grep", "mcp__plugin_file-manager_files__file_ops__move"):
        assert not re.search(matchers[0], name), name


def test_its_own_error_allows_the_call_loudly():
    result = run("not json")
    assert result.returncode == 0
    assert result.stdout == b""
    assert "housekeeping-approval-guard hook error (allowing" in result.stderr.decode("utf-8")
