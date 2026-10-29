"""pending-approvals-note.py: after a compaction or resume, the one-way steps the approval gate
refused and nobody then took are listed; a fresh start lists nothing, and a step since taken is
not listed. The note never quotes the approval block."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "pending-approvals-note.py"
DELETE = "mcp__plugin_lawyer_data__practice_data__delete_anchor"
MERGE = "mcp__plugin_lawyer_data__practice_data__merge_contact"
REFUSAL = "Approval needed [approval-gate act={}]. The practitioner's latest message is not the pasted approval."
FIRST_LINE = "By cutting and pasting this message I approve"


def transcript(tmp_path: Path, calls) -> Path:
    path = tmp_path / "session.jsonl"
    lines = [{"type": "user", "origin": {"kind": "human"}, "promptSource": "typed",
              "message": {"role": "user", "content": "Tidy the anchors and contacts."}}]
    for n, (name, tool_input, result, is_error) in enumerate(calls):
        lines.append({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "id": f"t{n}", "name": name, "input": tool_input}]}})
        lines.append({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": f"t{n}", "content": result, "is_error": is_error}]}})
    lines.append({"type": "system", "subtype": "compact_boundary"})
    path.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
    return path


def run(path: Path, source: str) -> subprocess.CompletedProcess:
    payload = {"hook_event_name": "SessionStart", "source": source, "transcript_path": str(path)}
    return subprocess.run([sys.executable, str(HOOK)], input=json.dumps(payload).encode("utf-8"),
                          capture_output=True, timeout=30)


def test_compact_lists_the_unanswered_refusal_and_not_the_completed_act(tmp_path):
    path = transcript(tmp_path, [
        (DELETE, {"anchor_id": 7}, REFUSAL.format("a" * 64), True),
        (MERGE, {"keep": 1, "drop": 2}, REFUSAL.format("b" * 64), True),
        (MERGE, {"keep": 1, "drop": 2}, '{"merged": true}', False),
    ])
    result = run(path, "compact")
    assert result.returncode == 0, result.stderr
    text = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
    assert DELETE in text and '"anchor_id": 7' in text
    assert MERGE not in text
    assert "only if the practitioner pastes the approval block after this point" in text
    assert FIRST_LINE.casefold() not in text.casefold()


def test_resume_lists_it_too(tmp_path):
    path = transcript(tmp_path, [(DELETE, {"anchor_id": 7}, REFUSAL.format("a" * 64), True)])
    assert DELETE in json.loads(run(path, "resume").stdout)["hookSpecificOutput"]["additionalContext"]


def test_startup_emits_nothing(tmp_path):
    path = transcript(tmp_path, [(DELETE, {"anchor_id": 7}, REFUSAL.format("a" * 64), True)])
    result = run(path, "startup")
    assert result.returncode == 0
    assert result.stdout == b""


def test_the_hook_is_registered_for_compact_and_resume():
    plugin = json.loads((HOOK.parent.parent / "plugin.json").read_text(encoding="utf-8"))
    entries = [entry for entry in plugin["hooks"]["SessionStart"]
               if any("pending-approvals-note.py" in " ".join(hook["args"]) for hook in entry["hooks"])]
    assert [entry.get("matcher") for entry in entries] == ["compact|resume"]
