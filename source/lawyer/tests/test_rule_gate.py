"""rule-gate.py: a Rule is made, retired or replaced only in the practitioner's own words."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "rule-gate.py"
PLUGIN_JSON = Path(__file__).resolve().parents[1] / "plugin.json"
QUESTION = "Do you want me to enforce that rule for all future sessions?"
RULE = "Never send a letter before I have read it."
NEW_RULE = "Never send a letter before I have read it, unless it is a covering letter."


def turn(text: str, **kw) -> dict:
    return {"type": "user", "promptSource": "sdk", "origin": {"kind": "human"},
            "message": {"role": "user", "content": text}, **kw}


def reply(text: str) -> dict:
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}


def call(op: str, **tool_input) -> dict:
    return {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": f"p-{op}", "name": "mcp__plugin_lawyer_data__preferences__write",
         "input": {"op": op, **tool_input}}]}}


def widget(*values: str) -> dict:
    cards = "".join(f'<div class="elicit-card" data-value="{v}">{v}</div>' for v in values)
    return {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "w1", "name": "mcp__visualize__show_widget", "input": {"widget_code": cards}}]}}


def run(tmp_path: Path, lines: list, tool_input: dict, transcript: str | None = None) -> subprocess.CompletedProcess:
    path = tmp_path / "session.jsonl"
    path.write_text("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines), encoding="utf-8")
    payload = {"hook_event_name": "PreToolUse", "tool_name": "mcp__plugin_lawyer_data__preferences__write",
               "tool_input": tool_input, "transcript_path": str(path) if transcript is None else transcript}
    return subprocess.run([sys.executable, str(HOOK)], input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                          capture_output=True, timeout=30)


def add(instruction: str) -> dict:
    return {"op": "add", "skill": "lawyer:draft", "instruction": instruction}


RETIRE = {"op": "retire", "id": "rule-1"}


def refused(result: subprocess.CompletedProcess, *fragments: str) -> bool:
    stderr = result.stderr.decode("utf-8")
    assert result.returncode == 2, stderr
    assert stderr.startswith("Refused: ")
    for fragment in fragments:
        assert fragment in stderr
    return True


def test_an_add_in_the_practitioners_words_passes_after_a_yes_to_the_question(tmp_path):
    lines = [turn(RULE), reply(f"Noted. {QUESTION}"), turn("Yes")]
    result = run(tmp_path, lines, add(RULE))
    assert result.returncode == 0, result.stderr


def test_an_add_in_accented_words_passes(tmp_path):
    rule = "Never send a letter to Mme Gagné before I have read it — not even a covering letter."
    lines = [turn(rule), reply(f"Noted. {QUESTION}"), turn("Yes")]
    result = run(tmp_path, lines, add(rule))
    assert result.returncode == 0, result.stderr


def test_an_add_worded_by_the_session_is_refused(tmp_path):
    lines = [turn("check letters with me first"),
             reply(f"I will save: `Always wait for counsel's review before a letter is sent.` {QUESTION}"), turn("Yes")]
    assert refused(run(tmp_path, lines, add("Always wait for counsel's review before a letter is sent.")),
                   "not an unbroken run")


def test_an_add_needs_a_bare_yes_to_the_enforce_question(tmp_path):
    for lines in ([turn(RULE), reply("Shall I remember that?"), turn("Yes")],
                  [turn(RULE), reply(QUESTION), turn("Yes, and also for emails")],
                  [turn(RULE), reply(QUESTION), turn("Yes"), reply("Saved."), turn("Thanks")]):
        assert refused(run(tmp_path, lines, add(RULE)), "last turn is not a bare yes")
    assert refused(run(tmp_path, [turn(RULE), reply(QUESTION)], add(RULE)), "not an unbroken run")


def test_a_widget_echo_supplies_no_words(tmp_path):
    lines = [widget(RULE), turn(f"Selected: {RULE}"), reply(QUESTION), turn("Yes")]
    assert refused(run(tmp_path, lines, add(RULE)), "not an unbroken run")


# The Global Rule's example (spec §11): "Do X" is refused, the session proposes new wording in a
# code block, and only a paste adopts it.
def conflict() -> list:
    return [turn("Send the letter to opposing counsel now."),
            reply(f"I cannot do that because on 2026-10-20 you created the rule, `{RULE}`. If you want me to do it "
                  f"you must first change or remove that rule.\n\n```\n{NEW_RULE}\n```")]


def test_a_replacement_adopted_by_approved_alone_is_refused(tmp_path):
    lines = conflict() + [turn("Approved")]
    assert refused(run(tmp_path, lines, RETIRE), "does not ask to remove or replace")
    assert refused(run(tmp_path, lines + [call("retire", id="rule-1")], add(NEW_RULE)))


def test_a_pasted_replacement_passes(tmp_path):
    lines = conflict() + [turn("Approved"),
                          reply("Changes to rules must come from your own words. To adopt this as the new rule, you must "
                                "cut & paste the above modified rule into chat."),
                          turn(NEW_RULE)]
    result = run(tmp_path, lines, RETIRE)
    assert result.returncode == 0, result.stderr
    result = run(tmp_path, lines + [call("retire", id="rule-1")], add(NEW_RULE))
    assert result.returncode == 0, result.stderr


def test_a_typed_replacement_passes_and_must_be_the_typed_words(tmp_path):
    typed = "Change the rule to: Never send a letter before I have read it, unless it is a covering letter."
    lines = conflict() + [turn(typed)]
    assert run(tmp_path, lines, RETIRE).returncode == 0
    assert run(tmp_path, lines + [call("retire", id="rule-1")], add(NEW_RULE)).returncode == 0
    assert refused(run(tmp_path, lines + [call("retire", id="rule-1")], add(NEW_RULE + " Always.")))


def test_a_replacement_needs_the_retire_first_or_the_enforce_question(tmp_path):
    lines = conflict() + [turn(NEW_RULE)]
    assert refused(run(tmp_path, lines, add(NEW_RULE)), "not an unbroken run")


def test_a_retire_passes_only_when_asked(tmp_path):
    assert run(tmp_path, [turn("Remove the rule about letters.")], RETIRE).returncode == 0
    for last in ("Thanks", "Yes", "Approved"):
        assert refused(run(tmp_path, [turn(last)], RETIRE), "does not ask to remove or replace")


def test_fails_closed(tmp_path):
    assert refused(run(tmp_path, [turn(RULE)], add(RULE), transcript=""), "transcript is not available")
    missing = str(tmp_path / "absent.jsonl")
    assert refused(run(tmp_path, [turn(RULE)], add(RULE), transcript=missing), missing)
    assert refused(run(tmp_path, [turn(RULE)], {"op": "list"}), "neither to add nor to retire")
    assert refused(run(tmp_path, [reply(QUESTION)], add(RULE)), "holds no practitioner turn")


def test_plugin_registers_the_gate_for_both_tool_name_forms():
    manifest = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))
    entries = [entry for entry in manifest["hooks"]["PreToolUse"]
               if any("${CLAUDE_PLUGIN_ROOT}/hooks/rule-gate.py" in h.get("args", []) for h in entry["hooks"])]
    assert len(entries) == 1
    matcher = re.compile(entries[0]["matcher"])
    for prefix in ("mcp__plugin_lawyer_data__", "mcp__remote-devices__plugin_lawyer_data__"):
        assert matcher.fullmatch(prefix + "preferences__write")
    assert not matcher.fullmatch("mcp__plugin_lawyer_data__preferences__read")
