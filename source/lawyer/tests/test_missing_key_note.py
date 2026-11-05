"""missing-key-note.py: the one-sentence notice when no key is stored, silence when it is,
the held-suggestion note, the out-of-sight note outside Windows, facts only on every branch,
and never the key's value.

Each test points the hook at its own Credential Manager target, so the real
Probanda/cloud-key is never read, written or deleted."""
from __future__ import annotations

import ctypes
import importlib.util
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / ".claude" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "missing-key-note.py"
SECRET = "sb_secret_do-not-echo"
CRED_TYPE_GENERIC = 1
CRED_PERSIST_SESSION = 1


class CREDENTIALW(ctypes.Structure):
    _fields_ = [
        ("Flags", ctypes.c_uint32), ("Type", ctypes.c_uint32), ("TargetName", ctypes.c_wchar_p),
        ("Comment", ctypes.c_wchar_p), ("LastWritten", ctypes.c_uint64), ("CredentialBlobSize", ctypes.c_uint32),
        ("CredentialBlob", ctypes.c_void_p), ("Persist", ctypes.c_uint32), ("AttributeCount", ctypes.c_uint32),
        ("Attributes", ctypes.c_void_p), ("TargetAlias", ctypes.c_wchar_p), ("UserName", ctypes.c_wchar_p),
    ]


@pytest.fixture(autouse=True)
def target():
    name = f"Probanda/cloud-key-test-{os.getpid()}-{uuid.uuid4().hex}"
    yield name
    if sys.platform == "win32":
        ctypes.windll.advapi32.CredDeleteW(name, CRED_TYPE_GENERIC, 0)


def run(tmp_path: Path, target: str, **extra: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in ("LEGAL_COMMONS_SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY")}
    env.update({"PROBANDA_CLOUD_KEY_TARGET": target, "COCLERK_CONFIG_PATH": str(tmp_path / "device" / "probanda.json")})
    env.update(extra)
    return run_hook(HOOK, env=env, text=True)


def store_key(target: str) -> None:
    blob = ctypes.create_string_buffer(SECRET.encode(), len(SECRET))
    cred = CREDENTIALW(Type=CRED_TYPE_GENERIC, TargetName=target, CredentialBlobSize=len(SECRET),
                       CredentialBlob=ctypes.cast(blob, ctypes.c_void_p), Persist=CRED_PERSIST_SESSION)
    assert ctypes.windll.advapi32.CredWriteW(ctypes.byref(cred), 0), ctypes.GetLastError()


def hold(tmp_path: Path, count: int) -> None:
    (tmp_path / "device").mkdir(exist_ok=True)
    held = [{"held_id": str(n), "held_on": "2026-10-20", "draft": {"title": "t", "body": "b"}} for n in range(count)]
    (tmp_path / "device" / "suggestions.local.json").write_text(json.dumps({"suggestions": [], "held": held}), encoding="utf-8")


def context(result: subprocess.CompletedProcess) -> str:
    assert result.returncode == 0
    return json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]


@pytest.mark.skipif(sys.platform != "win32", reason="Credential Manager is checked only on Windows")
def test_no_key_file_states_the_fact_and_its_effect(tmp_path, target):
    text = context(run(tmp_path, target))
    assert text.startswith("This computer holds no Probanda key.")
    assert "suggestions to the Probanda team cannot be sent" in text
    assert "kept on this computer and sent by itself once the key is stored" in text
    assert "__" not in text and "/lawyer:" not in text


@pytest.mark.skipif(sys.platform != "win32", reason="Credential Manager is checked only on Windows")
def test_a_stored_key_gives_no_output_and_never_its_value(tmp_path, target):
    store_key(target)
    result = run(tmp_path, target)
    assert result.returncode == 0
    assert result.stdout == ""
    assert SECRET not in result.stderr


@pytest.mark.skipif(sys.platform != "win32", reason="Credential Manager is checked only on Windows")
def test_held_suggestions_are_named_once_the_key_is_stored(tmp_path, target):
    store_key(target)
    hold(tmp_path, 2)
    text = context(run(tmp_path, target))
    assert "holds 2 suggestion(s)" in text
    assert "None of them has been sent" in text
    assert "sent only if the practitioner submits its card" in text
    assert SECRET not in text


@pytest.mark.skipif(sys.platform != "win32", reason="Credential Manager is checked only on Windows")
def test_an_empty_held_list_gives_no_output(tmp_path, target):
    store_key(target)
    hold(tmp_path, 0)
    assert run(tmp_path, target).stdout == ""


def test_an_environment_key_counts_as_present_and_is_never_echoed(tmp_path, target):
    result = run(tmp_path, target, LEGAL_COMMONS_SUPABASE_KEY=SECRET)
    assert result.returncode == 0
    assert result.stdout == ""
    assert SECRET not in result.stderr


def test_outside_windows_the_session_is_told_only_that_the_key_is_out_of_sight(monkeypatch):
    spec = importlib.util.spec_from_file_location("missing_key_note", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.delenv("LEGAL_COMMONS_SUPABASE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setattr(module.sys, "platform", "linux")
    text = module.context()
    assert text.startswith("This session cannot see whether this computer holds Probanda's key")
    assert "suggestions to the Probanda team cannot be sent" in text
    assert "__" not in text and "/lawyer:" not in text


ASKS = ("call ", "invoke ", "tell the practitioner", "follow ", "offer ", "ask ", "do not ", "never ")


def test_every_branch_states_facts_only():
    """No branch asks the model to act, names a tool or names a skill (issue #227)."""
    module = load_hook()
    for text in (module.MISSING, module.UNSEEN, module.HELD.format(count=2)):
        assert "__" not in text and "/lawyer:" not in text and "/" not in text, text
        lowered = text.lower()
        for ask in ASKS:
            assert ask not in lowered, (ask, text)


def load_hook():
    spec = importlib.util.spec_from_file_location("missing_key_note", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_held_suggestions_are_counted_from_the_store_and_the_unread_old_log(tmp_path, monkeypatch):
    module = load_hook()
    monkeypatch.setenv("COCLERK_CONFIG_PATH", str(tmp_path / "device" / "probanda.json"))
    (tmp_path / "device").mkdir()
    (tmp_path / "device" / "probanda.json").write_text("{}", encoding="utf-8")
    hold(tmp_path, 2)
    assert module.held_count() == 2, "an old log the store has not read yet still counts"
    store = tmp_path / "device" / "suggestions" / "suggestions.json"
    store.parent.mkdir(parents=True)
    records = [{"kind": "held", "record_id": "a", "draft": {}}, {"kind": "suggestion", "record_id": "b"},
               {"kind": "held", "record_id": "c", "draft": {}}, {"kind": "held", "record_id": "d", "draft": {}}]
    store.write_text(json.dumps({"version": 1, "migrated_log": None, "records": records}), encoding="utf-8")
    assert module.held_count() == 5
    store.write_text(json.dumps({"version": 1, "migrated_log": {"from": "suggestions.local.json", "on": "x"}, "records": records}),
                     encoding="utf-8")
    assert module.held_count() == 3, "once read into the store, the old log is not counted again"
