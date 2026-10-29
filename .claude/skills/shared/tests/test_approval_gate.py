"""approval_gate.py through each plugin's one-way-gate.py hook: a one-way call passes only on the
practitioner's pasted approval block, read from transcript fixtures (plan
docs/Plans/2026-10-28_untrusted-content-and-approvals.md, change 2b)."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
HOOKS = {plugin: REPO / "source" / plugin / "hooks" / "one-way-gate.py"
         for plugin in ("lawyer", "litigator", "timekeeper", "file-manager")}
TOOL = "mcp__plugin_lawyer_data__practice_data__delete_anchor"
ARGS = {"anchor_id": 7}
FIRST_LINE = ("By cutting and pasting this message I approve the process described above with full "
              "understanding that the process described above is one-way and irreversible.")
BLOCK = FIRST_LINE + "\nModifications: NONE"
MARKER = re.compile(r"\[approval-gate act=([0-9a-f]{64})\]")


class Session:
    """A transcript fixture written as the harness writes one, line by line."""

    def __init__(self, tmp_path: Path):
        self.path = tmp_path / "session.jsonl"
        self.path.write_text("", encoding="utf-8")
        self.n = 0

    def add(self, rec):
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")

    def say(self, text):
        self.add({"type": "user", "origin": {"kind": "human"}, "promptSource": "typed",
                  "message": {"role": "user", "content": text}})

    def call(self, name, tool_input, result=None, is_error=False):
        self.n += 1
        tool_id = f"toolu_{self.n}"
        self.add({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}]}})
        if result is not None:
            self.add({"type": "user", "message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": tool_id, "content": result, "is_error": is_error}]}})

    def gate(self, name=TOOL, tool_input=ARGS, plugin="lawyer", **extra):
        """Run the hook on a call. The refused call goes into the transcript with the refusal as its result;
        a passed call goes in with an ok result unless `answered` is False."""
        answered = extra.pop("answered", True)
        payload = {"hook_event_name": "PreToolUse", "tool_name": name, "tool_input": tool_input,
                   "transcript_path": str(self.path), **extra}
        result = subprocess.run([sys.executable, str(HOOKS[plugin])], input=json.dumps(payload).encode("utf-8"),
                                capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr
        if not result.stdout:
            if answered:
                self.call(name, tool_input, '{"ok": true}')
            return None
        reason = json.loads(result.stdout)["hookSpecificOutput"]["permissionDecisionReason"]
        self.call(name, tool_input, reason, is_error=True)
        return reason


def test_no_approval_is_refused_with_the_warning_and_block(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    reason = s.gate()
    assert MARKER.search(reason)
    assert "**This step is a one-way door: easy to pass through and costly to reverse.**" in reason
    assert "```text\n" + BLOCK + "\n```" in reason


def test_the_block_unchanged_passes(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    assert s.gate()
    s.say("  by cutting AND pasting this message I approve the process described above with full\n"
          "understanding that the process described above is one-way and irreversible.\nModifications: NONE")
    assert s.gate() is None


def test_none_then_a_changed_call_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.say(BLOCK)
    assert s.gate(tool_input={"anchor_id": 8})


def test_written_modifications_let_a_changed_call_on_the_same_tool_pass_once(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.say(FIRST_LINE + "\nModifications: delete anchor 8 instead")
    assert s.gate(tool_input={"anchor_id": 8}) is None
    assert s.gate(tool_input={"anchor_id": 8})


def test_written_modifications_then_a_different_tool_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.say(FIRST_LINE + "\nModifications: merge the contacts instead")
    assert s.gate(name="mcp__plugin_lawyer_data__practice_data__merge_contact", tool_input={"keep": 1, "drop": 2})


def test_the_phrase_only_inside_a_compact_summary_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.add({"type": "system", "subtype": "compact_boundary"})
    s.add({"type": "user", "isCompactSummary": True, "isMeta": True,
           "message": {"role": "user", "content": "Summary: the practitioner pasted " + BLOCK}})
    assert s.gate()


def test_the_phrase_before_a_compact_boundary_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.say(BLOCK)
    s.add({"type": "system", "subtype": "compact_boundary"})
    assert s.gate()


def test_an_old_block_pasted_again_with_no_new_refusal_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.say(BLOCK)
    assert s.gate() is None
    s.say(BLOCK)
    assert s.gate()


def test_two_acts_waiting_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Delete those anchors.")
    s.gate()
    s.gate(tool_input={"anchor_id": 8})
    s.say(BLOCK)
    assert s.gate()


def test_a_second_use_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.say(BLOCK)
    assert s.gate() is None
    assert s.gate()


def test_a_failed_call_does_not_use_the_approval(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.say(BLOCK)
    assert s.gate(answered=False) is None
    s.call(TOOL, ARGS, '{"error": {"code": "revision_moved"}}', is_error=True)
    assert s.gate() is None


def test_a_call_from_a_subagent_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.say(BLOCK)
    reason = s.gate(agent_id="a1", agent_type="general-purpose")
    assert reason and "subagent" in reason and not MARKER.search(reason)


def test_a_file_an_argument_names_is_part_of_the_act(tmp_path):
    s = Session(tmp_path)
    pdf = tmp_path / "letter.pdf"
    pdf.write_bytes(b"%PDF-1.4 one")
    call = {"path": str(pdf), "comments": []}
    name = "mcp__plugin_file-manager_files__file_ops__comment_pdf"
    s.say("Comment the letter.")
    s.gate(name=name, tool_input=call, plugin="file-manager")
    s.say(BLOCK)
    pdf.write_bytes(b"%PDF-1.4 two")
    assert s.gate(name=name, tool_input=call, plugin="file-manager")


def test_a_bulk_apply_with_no_delete_passes_and_one_with_a_delete_is_gated(tmp_path):
    s = Session(tmp_path)
    sets, deletes = tmp_path / "sets.jsonl", tmp_path / "deletes.jsonl"
    sets.write_text('{"op":"set","key":"a","value":"1"}\n', encoding="utf-8")
    deletes.write_text('{"op":"set","key":"a","value":"1"}\n{"op":"delete_prefix","prefix":"b"}\n', encoding="utf-8")
    name = "mcp__plugin_lawyer_data__time_pipeline__bulk_apply"
    s.say("Apply the file.")
    assert s.gate(name=name, tool_input={"namespace": "timeline", "path": str(sets)}, plugin="timekeeper") is None
    assert s.gate(name=name, tool_input={"namespace": "timeline", "path": str(deletes)}, plugin="timekeeper")


GATED = {
    "litigator": ["mcp__plugin_lawyer_data__drafting_data__record_sent", "mcp__plugin_lawyer_data__drafting_data__record_filed",
                  "mcp__plugin_lawyer_data__drafting_data__record_served"],
    "lawyer": ["mcp__plugin_lawyer_data__practice_data__delete_anchor", "mcp__plugin_lawyer_data__practice_data__merge_contact"],
    "timekeeper": ["mcp__plugin_lawyer_data__time_pipeline__delete", "mcp__plugin_lawyer_data__time_pipeline__bulk_apply",
                   "mcp__plugin_timekeeper_timecamp__update_entry"],
    "file-manager": ["mcp__plugin_file-manager_files__file_ops__comment_pdf"],
}
UNGATED = [
    "mcp__plugin_lawyer_data__drafting_forms__publish_general", "mcp__plugin_lawyer_data__drafting_forms__assemble_general",
    "mcp__plugin_lawyer_data__drafting_data__delete_job", "mcp__plugin_lawyer_data__practice_data__insert_time_entry",
    "mcp__plugin_lawyer_data__practice_data__set_time_entries_billable", "mcp__plugin_lawyer_data__practice_data__import_invoices",
    "mcp__plugin_lawyer_data__practice_data__record_retainer_notice", "mcp__plugin_lawyer_data__practice_data__manage_payment_in_flight",
    "mcp__plugin_lawyer_data__practice_data__set_status", "mcp__plugin_lawyer_contacts-calendars-email__mail__save_draft",
    "mcp__plugin_lawyer_data__knowledge__retire", "mcp__plugin_lawyer_data__knowledge__write",
    "mcp__plugin_lawyer_data__matter_data__migrate", "mcp__plugin_lawyer_data__drafting_data__merge_jobs",
    "mcp__plugin_lawyer_data__time_pipeline__set", "mcp__plugin_lawyer_data__time_pipeline__get",
    "mcp__plugin_lawyer_data__practice_data__upsert_anchor", "mcp__plugin_researcher_commons__troubleshoot__record",
    "mcp__plugin_file-manager_files__file_ops__move", "mcp__plugin_lawyer_data__drafting_data__execute",
]


def test_each_plugin_matcher_matches_every_gated_name_and_no_ungated_one():
    for plugin, names in GATED.items():
        manifest = json.loads((REPO / "source" / plugin / "plugin.json").read_text(encoding="utf-8"))
        matchers = [entry["matcher"] for entry in manifest["hooks"]["PreToolUse"]
                    if any("one-way-gate.py" in " ".join(hook["args"]) for hook in entry["hooks"])]
        assert len(matchers) == 1, plugin
        for name in names:
            assert re.search(matchers[0], name), (plugin, name)
        for name in UNGATED + [n for other, ns in GATED.items() if other != plugin for n in ns]:
            assert not re.search(matchers[0], name), (plugin, name)
