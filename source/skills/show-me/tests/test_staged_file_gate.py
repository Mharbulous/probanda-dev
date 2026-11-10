"""staged-file-gate.py: on a cloud-linked host a card from an unstaged path is refused, staged
paths and highlight extracts pass, other hosts are never refused, and its own error fails open."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "hooks" / "staged-file-gate.py"
# Runs the hook as if /mnt/user-data existed, so a Windows test machine stands in for the container.
CLOUD = ("import os, runpy, sys; real = os.path.isdir; "
         "os.path.isdir = lambda p: p == '/mnt/user-data' or real(p); "
         "sys.argv = [sys.argv[1]]; runpy.run_path(sys.argv[0], run_name='__main__')")


def run(stdin: str, cloud: bool = True) -> subprocess.CompletedProcess:
    args = [sys.executable, "-c", CLOUD, str(HOOK)] if cloud else [sys.executable, str(HOOK)]
    env = {k: v for k, v in os.environ.items() if k != "COCLERK_SENDFILE_ANY"}
    return subprocess.run(args, input=stdin.encode("utf-8"), capture_output=True, env=env, timeout=30)


def card(*files: str, cloud: bool = True) -> subprocess.CompletedProcess:
    return run(json.dumps({"hook_event_name": "PreToolUse", "tool_name": "SendUserFile",
                           "tool_input": {"files": list(files)}}), cloud)


def test_an_unstaged_file_is_refused_on_a_cloud_linked_host():
    result = card("/mnt/user-data/uploads/a.docx", "/tmp/letter.docx")
    assert result.returncode == 0
    output = json.loads(result.stdout)["hookSpecificOutput"]
    assert list(output) == ["hookEventName", "permissionDecision", "permissionDecisionReason"]
    assert output["permissionDecision"] == "deny"
    assert output["permissionDecisionReason"].startswith('Refused: "/tmp/letter.docx" is not a staged copy')


def test_staged_files_and_extracts_pass_silently():
    result = card("/mnt/user-data/uploads/a.docx", "/tmp/page 3.pdf", "/tmp/page 3.PNG")
    assert result.returncode == 0
    assert result.stdout == b""


def test_a_host_with_no_container_is_never_refused():
    result = card("/tmp/letter.docx", cloud=False)
    assert result.returncode == 0
    assert result.stdout == b""


def test_its_own_error_allows_the_call_loudly():
    result = run("not json")
    assert result.returncode == 0
    assert result.stdout == b""
    assert "staged-file-gate hook error (allowing" in result.stderr.decode("utf-8")
