"""hook_io.py: each output shape, the fail-open and fail-closed wrapper, and a fail-closed gate that
cannot find its helper refusing the call."""
from __future__ import annotations

import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import hook_io  # noqa: E402

REPO = Path(__file__).resolve().parents[4]
CLOSED_GATES = ("source/lawyer/hooks/rule-gate.py", "source/litigator/hooks/correspondence-review-gate.py",
                "source/researcher/hooks/commons-read-only.py",
                ".claude/skills/drafting-data/hooks/practitioner-words-gate.py")


def test_payload_reads_the_stdin_json_as_utf8(monkeypatch):
    stdin = type("Stdin", (), {"buffer": io.BytesIO(json.dumps({"tool_name": "Café"}, ensure_ascii=False).encode("utf-8"))})
    monkeypatch.setattr(sys, "stdin", stdin)
    assert hook_io.payload() == {"tool_name": "Café"}


def test_deny_writes_the_pre_tool_use_refusal(capsys):
    assert hook_io.deny("Refused: no.") == 0
    out = capsys.readouterr().out
    assert out == json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                     "permissionDecisionReason": "Refused: no."}}) + "\n"


def test_pre_tool_carries_any_decision_and_extra_fields_in_order(capsys):
    assert hook_io.pre_tool("allow", "guarded", updatedInput={"command": "rm x"}) == 0
    output = json.loads(capsys.readouterr().out)["hookSpecificOutput"]
    assert list(output) == ["hookEventName", "permissionDecision", "permissionDecisionReason", "updatedInput"]
    assert output["permissionDecision"] == "allow"
    assert output["updatedInput"] == {"command": "rm x"}


def test_note_writes_additional_context(capsys):
    assert hook_io.note("SessionStart", "Read this.") == 0
    assert capsys.readouterr().out == ('{"hookSpecificOutput": {"hookEventName": "SessionStart", '
                                       '"additionalContext": "Read this."}}\n')


def test_refuse_writes_stderr_and_exits_2(capsys):
    assert hook_io.refuse("Blocked: no.") == 2
    captured = capsys.readouterr()
    assert (captured.out, captured.err) == ("", "Blocked: no.\n")


def test_run_exits_with_main_s_code():
    for code, expected in ((0, 0), (2, 2), (None, None)):
        with pytest.raises(SystemExit) as exit_:
            hook_io.run(lambda: code, "my-hook")
        assert exit_.value.code == expected


def test_run_fails_open_loudly(capsys):
    def main():
        raise ValueError("bad payload")
    with pytest.raises(SystemExit) as exit_:
        hook_io.run(main, "my-hook")
    assert exit_.value.code == 0
    assert capsys.readouterr().err == "my-hook hook error (allowing): ValueError: bad payload\n"


def test_run_fails_closed_through_the_gate_s_own_refusal(capsys):
    def main():
        raise ValueError("bad payload")
    with pytest.raises(SystemExit) as exit_:
        hook_io.run(main, "my-gate", closed=lambda exc: hook_io.refuse(f"Refused: the gate failed: {exc!r}"))
    assert exit_.value.code == 2
    assert capsys.readouterr().err == "Refused: the gate failed: ValueError('bad payload')\n"


def test_run_passes_a_system_exit_through():
    def main():
        sys.exit(2)
    with pytest.raises(SystemExit) as exit_:
        hook_io.run(main, "my-hook", closed=lambda exc: 0)
    assert exit_.value.code == 2


def test_strings_walks_dicts_and_lists():
    assert list(hook_io.strings({"a": "x", "b": ["y", {"c": "z"}, 3]})) == ["x", "y", "z"]


def test_config_path_prefers_the_override(monkeypatch, tmp_path):
    monkeypatch.setenv("COCLERK_CONFIG_PATH", str(tmp_path / "probanda.json"))
    assert hook_io.config_path() == tmp_path / "probanda.json"
    monkeypatch.delenv("COCLERK_CONFIG_PATH")
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert hook_io.config_path() == tmp_path / "Probanda" / "probanda.json"
    (tmp_path / "Coclerk").mkdir()
    (tmp_path / "Coclerk" / "coclerk.json").write_text("{}", encoding="utf-8")
    assert hook_io.config_path() == tmp_path / "Coclerk" / "coclerk.json"


@pytest.mark.parametrize("gate", CLOSED_GATES)
def test_a_fail_closed_gate_that_cannot_find_its_helper_refuses(tmp_path, gate):
    copy = tmp_path / "a" / "b" / "hooks" / Path(gate).name
    copy.parent.mkdir(parents=True)
    shutil.copy(REPO / gate, copy)
    result = subprocess.run([sys.executable, str(copy)], input=b"{}", capture_output=True, timeout=30)
    assert result.returncode == 2
    assert result.stdout == b""
    assert result.stderr.decode("utf-8").startswith(f"Refused: {copy.stem} cannot load its helper: ")
