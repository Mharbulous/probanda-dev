import importlib.util
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "missing-key-note.py"


def test_unseen_branch_asks_no_tool_call(monkeypatch):
    spec = importlib.util.spec_from_file_location("missing_key_note", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.delenv("LEGAL_COMMONS_SUPABASE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setattr(module.sys, "platform", "linux")
    text = module.context() or ""
    assert "__" not in text and "/lawyer:" not in text
