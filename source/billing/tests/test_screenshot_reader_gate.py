"""screenshot-reader-gate.py: the reader opens only decrypted screenshots, on its pinned model and effort."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / ".claude" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "screenshot-reader-gate.py"
PLUGIN_JSON = Path(__file__).resolve().parents[1] / "plugin.json"
READER = "billing:screenshot-reader"


def decision(payload: dict) -> str | None:
    result = run_hook(HOOK, {"hook_event_name": "PreToolUse", **payload}, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"] if result.stdout.strip() else None


def read(path: Path, agent_type: str | None = READER) -> str | None:
    payload = {"tool_name": "Read", "tool_input": {"file_path": str(path)}}
    if agent_type is not None:
        payload.update(agent_type=agent_type, agent_id="a1")
    return decision(payload)


def dispatch(**tool_input) -> str | None:
    return decision({"tool_name": "Agent", "tool_input": {"prompt": "p", **tool_input}})


def test_reader_may_read_a_decrypted_screenshot(tmp_path):
    assert read(tmp_path / "syncopaid-screens" / "abc.png") is None


@pytest.mark.parametrize("relative", ["other/abc.png", "syncopaid-screens/abc.txt",
                                      "syncopaid-screens/../secret.png", "syncopaid-screens/sub/abc.png"])
def test_reader_is_refused_anything_else(tmp_path, relative):
    assert read(tmp_path / relative) == "deny"


@pytest.mark.parametrize("agent_type", [None, "lawyer:compare-pages", "general-purpose"])
def test_other_callers_read_freely(tmp_path, agent_type):
    assert read(tmp_path / "notes.txt", agent_type) is None


@pytest.mark.parametrize("extra", [{"model": "sonnet"}, {"effort": "low"}])
@pytest.mark.parametrize("subagent_type", [READER, "screenshot-reader"])
def test_dispatch_with_model_or_effort_is_refused(subagent_type, extra):
    assert dispatch(subagent_type=subagent_type, **extra) == "deny"


def test_plain_dispatch_and_other_agents_pass():
    assert dispatch(subagent_type=READER) is None
    assert dispatch(subagent_type="general-purpose", model="haiku") is None


def test_registered_on_read_and_dispatch():
    entries = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))["hooks"]["PreToolUse"]
    matchers = [e["matcher"] for e in entries if any("screenshot-reader-gate.py" in " ".join(h["args"]) for h in e["hooks"])]
    assert matchers == ["^(Read|Agent|Task)$"]
