"""plugin-cache-guard.py: an edit inside an installed Probanda plugin copy is refused, every other
path passes, and its own error fails open, loudly."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "source" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "plugin-cache-guard.py"


def run(stdin: str, plugin_root: Path | None, **env) -> subprocess.CompletedProcess:
    base = {k: v for k, v in os.environ.items() if k not in ("COCLERK_HTML_DEV", "CLAUDE_PLUGIN_ROOT")}
    if plugin_root is not None:
        base["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    return run_hook(HOOK, stdin, env={**base, **env})


def edit(tmp_path: Path, path: Path, plugin_root: Path | None, **env) -> subprocess.CompletedProcess:
    payload = {"hook_event_name": "PreToolUse", "tool_name": "Edit", "cwd": str(tmp_path),
               "tool_input": {"file_path": str(path)}}
    return run(json.dumps(payload), plugin_root, **env)


def synced(tmp_path: Path) -> Path:
    for name in ("lawyer", "litigator"):
        (tmp_path / "synced" / name / "skills").mkdir(parents=True)
    return tmp_path / "synced" / "lawyer"


def test_an_edit_inside_an_installed_plugin_is_refused(tmp_path):
    root = synced(tmp_path)
    for target in (root / "skills" / "SKILL.md", tmp_path / "synced" / "litigator" / "skills" / "x.md"):
        result = edit(tmp_path, target, root)
        assert result.returncode == 0
        output = json.loads(result.stdout)["hookSpecificOutput"]
        assert list(output) == ["hookEventName", "permissionDecision", "permissionDecisionReason"]
        assert output["permissionDecision"] == "deny"
        assert output["permissionDecisionReason"].startswith("Refused: that file is part of the installed Probanda plugin")


def test_other_paths_and_exemptions_pass_silently(tmp_path):
    root = synced(tmp_path)
    for result in (edit(tmp_path, tmp_path / "notes.md", root),
                   edit(tmp_path, root / "skills" / "SKILL.md", None),
                   edit(tmp_path, root / "skills" / "SKILL.md", root, COCLERK_HTML_DEV="1")):
        assert result.returncode == 0
        assert result.stdout == b""


def test_the_plugin_source_repo_is_exempt(tmp_path):
    root = synced(tmp_path)
    (tmp_path / "source" / "lawyer").mkdir(parents=True)
    (tmp_path / "source" / "lawyer" / "plugin.json").write_text("{}", encoding="utf-8")
    assert edit(tmp_path, root / "skills" / "SKILL.md", root).stdout == b""


def test_its_own_error_allows_the_call_loudly(tmp_path):
    result = run("not json", synced(tmp_path))
    assert result.returncode == 0
    assert result.stdout == b""
    assert "plugin-cache-guard hook error (allowing" in result.stderr.decode("utf-8")
