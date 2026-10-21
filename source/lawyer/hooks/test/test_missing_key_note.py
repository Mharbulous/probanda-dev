"""missing-key-note.py: the one-sentence notice when no key file exists, silence when it does,
the held-suggestion note, the tool pointer outside Windows, and never the key's value."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parent.parent / "missing-key-note.py"
SECRET = "sb_secret_do-not-echo"


def run(tmp_path: Path, **extra: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in ("LEGAL_COMMONS_SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY")}
    env.update({"LOCALAPPDATA": str(tmp_path / "local"), "COCLERK_CONFIG_PATH": str(tmp_path / "device" / "probanda.json")})
    env.update(extra)
    return subprocess.run([sys.executable, str(HOOK)], env=env, capture_output=True, text=True, timeout=30)


def store_key(tmp_path: Path) -> None:
    folder = tmp_path / "local" / "Coclerk" / "legal-commons"
    folder.mkdir(parents=True)
    (folder / "credential.json.dpapi").write_text(SECRET, encoding="utf-8")


def hold(tmp_path: Path, count: int) -> None:
    (tmp_path / "device").mkdir(exist_ok=True)
    held = [{"held_id": str(n), "held_on": "2026-10-20", "draft": {"title": "t", "body": "b"}} for n in range(count)]
    (tmp_path / "device" / "suggestions.local.json").write_text(json.dumps({"suggestions": [], "held": held}), encoding="utf-8")


def context(result: subprocess.CompletedProcess) -> str:
    assert result.returncode == 0
    return json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]


@pytest.mark.skipif(sys.platform != "win32", reason="the key file is checked only on Windows")
def test_no_key_file_gives_the_one_sentence_notice_and_the_route(tmp_path):
    text = context(run(tmp_path))
    assert text.startswith("This computer holds no Probanda key.")
    assert "once, in this one sentence" in text
    assert "Do not repeat it" in text
    assert "key_request__submit" in text
    assert "Never ask for the key in chat" in text
    assert "/lawyer:suggestion" in text


@pytest.mark.skipif(sys.platform != "win32", reason="the key file is checked only on Windows")
def test_a_stored_key_gives_no_output_and_never_its_value(tmp_path):
    store_key(tmp_path)
    result = run(tmp_path)
    assert result.returncode == 0
    assert result.stdout == ""
    assert SECRET not in result.stderr


@pytest.mark.skipif(sys.platform != "win32", reason="the key file is checked only on Windows")
def test_held_suggestions_are_named_once_the_key_is_stored(tmp_path):
    store_key(tmp_path)
    hold(tmp_path, 2)
    text = context(run(tmp_path))
    assert "holds 2 suggestion(s)" in text
    assert "exactly as drafted" in text
    assert SECRET not in text


@pytest.mark.skipif(sys.platform != "win32", reason="the key file is checked only on Windows")
def test_an_empty_held_list_gives_no_output(tmp_path):
    store_key(tmp_path)
    hold(tmp_path, 0)
    assert run(tmp_path).stdout == ""


def test_an_environment_key_counts_as_present_and_is_never_echoed(tmp_path):
    result = run(tmp_path, LEGAL_COMMONS_SUPABASE_KEY=SECRET)
    assert result.returncode == 0
    assert result.stdout == ""
    assert SECRET not in result.stderr


def test_outside_windows_the_session_is_pointed_to_config_status(monkeypatch):
    spec = importlib.util.spec_from_file_location("missing_key_note", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.delenv("LEGAL_COMMONS_SUPABASE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setattr(module.sys, "platform", "linux")
    text = module.context()
    assert "practice_data__config_status" in text
    assert "cloud_credential: missing" in text
    assert "key_request__submit" in text
