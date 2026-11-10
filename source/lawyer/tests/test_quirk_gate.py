"""quirk-gate.py: a practice rule is saved only when the practitioner's own message holds its words."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "source" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "quirk-gate.py"
PLUGIN_JSON = Path(__file__).resolve().parents[1] / "plugin.json"
TOOL = "mcp__plugin_lawyer_data__quirks__write"

TITLE = "Never open the main mailbox"
BODY = "Read its mail from the copies in the second mailbox."
FACT_TITLE = "A forwarding rule copies the main mailbox"
FACT_BODY = "Since early November every message is copied to the second mailbox."

BLOCK = f"PROPOSED PRACTICE RULE  (area: email)\nTitle: {TITLE}\nBody: {BODY}\nPaste this whole block back into chat to save it."
PROPOSAL = f"Here is the rule I would save:\n\n```\n{BLOCK}\n```"
FACT_PROPOSAL = f"I would save this as knowledge: {FACT_TITLE}. {FACT_BODY} Shall I?"


def turn(text: str, **kw) -> dict:
    return {"type": "user", "promptSource": "sdk", "origin": {"kind": "human"},
            "message": {"role": "user", "content": text}, **kw}


def reply(text: str) -> dict:
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}


def run(tmp_path: Path, lines: list, tool_input: dict, transcript: str | None = None, **payload_extra) -> subprocess.CompletedProcess:
    path = tmp_path / "session.jsonl"
    path.write_text("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines), encoding="utf-8")
    payload = {"hook_event_name": "PreToolUse", "tool_name": TOOL, "tool_input": tool_input,
               "transcript_path": str(path) if transcript is None else transcript, **payload_extra}
    return run_hook(HOOK, json.dumps(payload, ensure_ascii=False))


def add_rule(title: str = TITLE, body: str = BODY) -> dict:
    return {"op": "add", "type": "rule", "areas": ["email"], "title": title, "body": body}


def add_fact() -> dict:
    return {"op": "add", "type": "knowledge", "areas": ["email"], "title": FACT_TITLE, "body": FACT_BODY}


def on(op: str, expect_type: str, title: str, **more) -> dict:
    return {"op": op, "id": "q-1", "expect_type": expect_type, "expect_title": title, **more}


def refused(result: subprocess.CompletedProcess, *fragments: str) -> bool:
    stderr = result.stderr.decode("utf-8")
    assert result.returncode == 2, stderr
    assert stderr.startswith("Refused: ")
    for fragment in fragments:
        assert fragment in stderr
    return True


def test_the_model_alone_cannot_save_a_rule(tmp_path):
    # No practitioner turn holds the words: the session wrote them and called the tool.
    assert refused(run(tmp_path, [turn("Let's tidy up my notes."), reply(PROPOSAL)], add_rule()), "unbroken runs")
    assert refused(run(tmp_path, [turn("Let's tidy up my notes.")], add_rule()), "unbroken runs")


def test_a_bare_yes_never_saves_a_rule(tmp_path):
    for word in ("Yes", "Approved", "ok", "Go ahead"):
        assert refused(run(tmp_path, [turn("Save a rule."), reply(PROPOSAL), turn(word)], add_rule()), "unbroken runs")


def test_a_pasted_block_saves_the_rule(tmp_path):
    lines = [turn("Save a rule."), reply(PROPOSAL), turn(BLOCK)]
    result = run(tmp_path, lines, add_rule())
    assert result.returncode == 0, result.stderr


def test_a_typed_rule_saves_and_one_paste_covers_several_calls(tmp_path):
    other_title, other_body = "Draft emails as .eml files", "Save each outgoing email as an .eml draft."
    lines = [turn("Save two rules."), reply(PROPOSAL),
             turn(f"{BLOCK}\n\nTitle: {other_title}\nBody: {other_body}")]
    assert run(tmp_path, lines, add_rule()).returncode == 0
    assert run(tmp_path, lines, add_rule(other_title, other_body)).returncode == 0


def test_different_wording_is_refused(tmp_path):
    lines = [turn("Save a rule."), reply(PROPOSAL), turn(BLOCK)]
    assert refused(run(tmp_path, lines, add_rule(body=BODY + " Always.")), "unbroken runs")
    assert refused(run(tmp_path, lines, add_rule(title="Never open any mailbox")), "unbroken runs")


def test_a_widget_echo_supplies_no_words(tmp_path):
    widget = {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "w1", "name": "mcp__visualize__show_widget",
         "input": {"widget_code": f'<div data-value="{TITLE}">{TITLE}</div><div data-value="{BODY}">{BODY}</div>'}}]}}
    lines = [widget, turn(f"Selected: {TITLE} {BODY}")]
    assert refused(run(tmp_path, lines, add_rule()), "unbroken runs")


def test_a_subagent_is_always_refused(tmp_path):
    lines = [turn("Save a rule."), reply(PROPOSAL), turn(BLOCK)]
    assert refused(run(tmp_path, lines, add_rule(), agent_id="agent-7", agent_type="general-purpose"), "subagent")
    lines = [turn("Yes"), reply(FACT_PROPOSAL), turn("Yes")]
    assert refused(run(tmp_path, lines, add_fact(), agent_id="agent-7"), "subagent")


def test_knowledge_needs_a_bare_yes_to_wording_the_session_showed(tmp_path):
    assert run(tmp_path, [turn("Note a fact."), reply(FACT_PROPOSAL), turn("Yes")], add_fact()).returncode == 0
    assert refused(run(tmp_path, [turn("Note a fact."), reply("Shall I note a fact?"), turn("Yes")], add_fact()),
                   "not a bare yes")
    assert refused(run(tmp_path, [turn("Note a fact."), reply(FACT_PROPOSAL), turn("Yes, and also for files")], add_fact()),
                   "not a bare yes")
    assert refused(run(tmp_path, [turn("Note a fact."), reply(FACT_PROPOSAL)], add_fact()), "not a bare yes")


def test_a_rule_cannot_be_demoted_to_knowledge_on_a_yes(tmp_path):
    lines = [turn("Change it."), reply(FACT_PROPOSAL), turn("Yes")]
    revise = {**add_fact(), **on("revise", "rule", TITLE)}
    assert refused(run(tmp_path, lines, revise), "unbroken runs")
    # claiming the old entry was knowledge is the tool's refusal (type_mismatch), not the gate's
    assert run(tmp_path, lines, {**add_fact(), **on("revise", "knowledge", FACT_TITLE)}).returncode == 0


def test_a_revision_of_a_rule_needs_the_new_wording_pasted(tmp_path):
    new_body = BODY + " Newest first."
    revise = {**add_rule(body=new_body), **on("revise", "rule", TITLE)}
    assert refused(run(tmp_path, [turn("Change the rule."), reply(PROPOSAL), turn("Approved")], revise), "unbroken runs")
    assert run(tmp_path, [turn("Change the rule."), reply(PROPOSAL), turn(f"Title: {TITLE}\nBody: {new_body}")], revise).returncode == 0
    assert refused(run(tmp_path, [turn("Change the rule."), turn("Yes")], {**add_rule(), "op": "revise"}),
                   "which type of entry it replaces")


def test_retiring_a_rule_needs_its_title_and_a_word_of_removal(tmp_path):
    retire = on("retire", "rule", TITLE)
    assert run(tmp_path, [turn(f"Remove the rule \"{TITLE}\".")], retire).returncode == 0
    for last in ("Yes", "Approved", f"{TITLE}", "Remove the rule about mailboxes."):
        assert refused(run(tmp_path, [turn(last)], retire), "remove or replace this rule by its title")


def test_confirming_or_retiring_knowledge_or_confirming_a_rule_needs_a_yes_to_its_title(tmp_path):
    shown = [turn("Check the notes."), reply(f"Is \"{FACT_TITLE}\" still true, and \"{TITLE}\" still wanted?"), turn("Yes")]
    assert run(tmp_path, shown, on("confirm", "knowledge", FACT_TITLE)).returncode == 0
    assert run(tmp_path, shown, on("retire", "knowledge", FACT_TITLE)).returncode == 0
    assert run(tmp_path, shown, on("confirm", "rule", TITLE)).returncode == 0
    unshown = [turn("Check the notes."), reply("Is the old note still true?"), turn("Yes")]
    assert refused(run(tmp_path, unshown, on("confirm", "knowledge", FACT_TITLE)), "not a bare yes")
    assert refused(run(tmp_path, unshown, on("confirm", "rule", TITLE)), "not a bare yes")


def test_fails_closed(tmp_path):
    lines = [turn(BLOCK)]
    assert refused(run(tmp_path, lines, add_rule(), transcript=""), "transcript is not available")
    missing = str(tmp_path / "absent.jsonl")
    assert refused(run(tmp_path, lines, add_rule(), transcript=missing), missing)
    assert refused(run(tmp_path, lines, {"op": "list"}), "is not one of")
    assert refused(run(tmp_path, [reply(PROPOSAL)], add_rule()), "holds no practitioner turn")
    assert refused(run(tmp_path, lines, {"op": "add", "type": "rule", "areas": ["email"]}), "no type, title or body")
    assert refused(run(tmp_path, lines, {"op": "retire", "id": "q-1"}), "expect_type")


def test_plugin_registers_the_gate_for_both_tool_name_forms():
    manifest = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))
    entries = [entry for entry in manifest["hooks"]["PreToolUse"]
               if any("${CLAUDE_PLUGIN_ROOT}/hooks/quirk-gate.py" in h.get("args", []) for h in entry["hooks"])]
    assert len(entries) == 1
    matcher = re.compile(entries[0]["matcher"])
    for prefix in ("mcp__plugin_lawyer_data__", "mcp__remote-devices__plugin_lawyer_data__"):
        assert matcher.fullmatch(prefix + "quirks__write")
        assert not matcher.fullmatch(prefix + "quirks__read")
        assert not matcher.fullmatch(prefix + "quirks__list")
