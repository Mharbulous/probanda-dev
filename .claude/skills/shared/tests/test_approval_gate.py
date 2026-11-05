"""approval_gate.py through each plugin's one-way-gate.py hook: a one-way call passes only on the
practitioner's pasted approval block, read from transcript fixtures (plan
docs/Plans/2026-10-28_untrusted-content-and-approvals.md, change 2b)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hook_runner import run_hook  # noqa: E402

REPO = Path(__file__).resolve().parents[4]
HOOKS = {plugin: REPO / "source" / plugin / "hooks" / "one-way-gate.py"
         for plugin in ("lawyer", "litigator", "timekeeper", "file-manager", "researcher")}
TOOL = "mcp__plugin_lawyer_data__practice_data__delete_anchor"
ARGS = {"anchor_id": 7}
FIRST_LINE = ("By cutting and pasting this message I approve this step: delete anchor 7 and its sources and "
              "derived deadlines, so those dates stop being tracked. The deleted dates are not kept. "
              "I understand it is one-way and irreversible.")
BLOCK = FIRST_LINE + "\nModifications: NONE"
MARKER = re.compile(r"\[approval-gate act=([0-9a-f]{64})\]")


def block_of(reason):
    """The block a practitioner copies out of a refusal."""
    return re.search(r"```text\n(.*?)\n```", reason, re.S).group(1)


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
        result = run_hook(HOOKS[plugin], payload)
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
    assert "process described above" not in reason


def test_the_block_unchanged_passes(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    assert s.gate()
    s.say("  by cutting AND pasting this message I approve this step: delete anchor 7 and its\n"
          "sources and derived deadlines, so those dates stop being tracked. The deleted dates are not kept. "
          "I understand it is one-way and irreversible.\nModifications: NONE")
    assert s.gate() is None


def test_a_filed_record_names_the_writing_and_date(tmp_path):
    s = Session(tmp_path)
    call = {"db_path": r"C:\cases\Matter A\submission.sqlite", "filing_id": 12, "filed_on": "2026-10-29", "expect_revision": 2}
    s.say("Record it as filed.")
    reason = s.gate(name=GATED["litigator"][1], tool_input=call, plugin="litigator")
    assert "record Writing 12 as filed on 2026-10-29, in the drafting records of Matter A," in reason
    assert "process described above" not in reason
    s.say(block_of(reason))
    assert s.gate(name=GATED["litigator"][1], tool_input=call, plugin="litigator") is None


def test_a_block_that_describes_another_step_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    s.gate()
    s.say(BLOCK.replace("anchor 7", "anchor 8"))
    assert s.gate()
    s.say("By cutting and pasting this message I approve the process described above with full understanding "
          "that the process described above is one-way and irreversible.\nModifications: NONE")
    assert s.gate()


SAMPLES = {
    "mcp__plugin_lawyer_data__drafting_data__record_sent": ("litigator", {
        "db_path": "m.db", "filing_id": 4, "sent_on": "2026-10-28", "expect_revision": 3}, "record Writing 4 as sent on 2026-10-28"),
    "mcp__plugin_lawyer_data__drafting_data__record_filed": ("litigator", {
        "db_path": "m.db", "filing_id": 4, "filed_on": "2026-10-28", "expect_revision": 3}, "record Writing 4 as filed on 2026-10-28"),
    "mcp__plugin_lawyer_data__drafting_data__record_served": ("litigator", {
        "db_path": "m.db", "filing_id": 4, "served_on": "2026-10-27", "expect_revision": 3}, "record Writing 4 as served on 2026-10-27"),
    "mcp__plugin_lawyer_data__practice_data__delete_anchor": ("lawyer", {"anchor_id": "a9"}, "delete anchor a9"),
    "mcp__plugin_lawyer_data__practice_data__merge_contact": ("lawyer", {"keep_id": "c1", "spare_id": "c2"},
                                                              "merge contact c2 into contact c1"),
    "mcp__plugin_lawyer_data__practice_data__issue_invoice": ("lawyer", {"invoice_number": "101", "amount": 50},
                                                              "record invoice 101 for 50 as issued"),
    "mcp__plugin_lawyer_data__time_pipeline__delete": ("timekeeper", {"namespace": "timeline", "key": "k1"},
                                                       "delete the item k1 from the activity history on this computer"),
    "mcp__plugin_lawyer_data__time_pipeline__bulk_apply": ("timekeeper", {
        "namespace": "timeline", "path": "/x/gone.jsonl",
        "expect": {"added": 2, "replaced": 1, "removed": 3, "file_sha256": "ab"}},
        "adding 2 new item(s), replacing 1 existing item(s), removing 3 item(s), in the activity history on this computer"),
    "mcp__plugin_file-manager_files__file_ops__comment_pdf": ("file-manager", {
        "matter_root": "/m", "path": "/m/a.pdf", "comments": [{"page": 3, "text": "x"}, {"page": 1, "text": "y"}]},
        "write 2 comment(s) on page(s) 1, 3 into the PDF a.pdf"),
    "mcp__plugin_researcher_commons__troubleshoot__record": ("researcher", {"symptom": "s1", "cause": "c1", "fix": "f1"},
                                                             'symptom "s1", cause "c1", fix "f1"'),
    "mcp__remote-devices__plugin_researcher_commons__troubleshoot__record": ("researcher", {
        "symptom": "s1", "cause": "c1", "fix": "f1"}, 'symptom "s1", cause "c1", fix "f1"'),
    "mcp__plugin_lawyer_contacts-calendars-email__mail__dedupe_apply": ("lawyer", {"plan_id": "abc", "expected_count": 3},
                                                                        "move 3 duplicate email copies, listed in plan abc, to Trash"),
    "mcp__remote-devices__plugin_lawyer_contacts-calendars-email__mail__dedupe_apply": (
        "lawyer", {"plan_id": "abc", "expected_count": 3}, "move 3 duplicate email copies, listed in plan abc, to Trash"),
}


def test_every_gated_tool_names_its_act_in_the_block(tmp_path):
    assert {n for names in GATED.values() for n in names} <= set(SAMPLES)
    for name, (plugin, call, act) in SAMPLES.items():
        s = Session(tmp_path)
        s.say("Go ahead.")
        reason = s.gate(name=name, tool_input=call, plugin=plugin)
        assert act in block_of(reason), name
        assert "process described above" not in reason, name
        s.say(block_of(reason))
        assert s.gate(name=name, tool_input=call, plugin=plugin) is None, name


def test_no_block_holds_a_path_or_an_internal_word(tmp_path):
    for name, (plugin, call, _) in SAMPLES.items():
        s = Session(tmp_path)
        s.say("Go ahead.")
        block = block_of(s.gate(name=name, tool_input=call, plugin=plugin))
        for word in ("/", "\\", "the writes in", "namespace", "time-pipeline", "database", name, "__"):
            assert word not in block, (name, word)


def test_a_sent_copy_on_a_windows_path_is_named_by_its_file_alone(tmp_path):
    s = Session(tmp_path)
    call = {"db_path": r"C:\cases\Matter A\submission.sqlite", "filing_id": 4, "sent_on": "2026-10-28",
            "expect_revision": 3, "sent_copy_path": r"C:\cases\Matter A\sent letter.pdf"}
    s.say("Record it as sent.")
    block = block_of(s.gate(name=GATED["litigator"][0], tool_input=call, plugin="litigator"))
    assert "with the sent copy sent letter.pdf" in block
    assert "\\" not in block


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
    s.say(block_of(s.gate(name=name, tool_input=call, plugin="file-manager")))
    pdf.write_bytes(b"%PDF-1.4 two")
    assert s.gate(name=name, tool_input=call, plugin="file-manager")


BULK = "mcp__plugin_lawyer_data__time_pipeline__bulk_apply"
# The hook never reads this file: in Cowork it runs where the practitioner's files cannot be seen.
BULK_CALL = {"namespace": "evidence", "path": "/not/visible/from/the/hook.jsonl"}


def bulk_gate(s, **args):
    return s.gate(name=BULK, tool_input={**BULK_CALL, **args}, plugin="timekeeper")


def expecting(added=0, replaced=0, removed=0):
    return {"added": added, "replaced": replaced, "removed": removed, "file_sha256": "ab"}


def test_a_bulk_preview_writes_nothing_so_it_passes(tmp_path):
    s = Session(tmp_path)
    s.say("Apply the file.")
    assert bulk_gate(s, preview=True) is None


def test_a_bulk_write_of_only_new_items_passes(tmp_path):
    s = Session(tmp_path)
    s.say("Apply the file.")
    assert bulk_gate(s, expect=expecting(added=96)) is None


def test_a_bulk_write_that_replaces_stops_and_says_nothing_of_deletes(tmp_path):
    s = Session(tmp_path)
    s.say("Apply the file.")
    block = block_of(bulk_gate(s, expect=expecting(added=90, replaced=6)))
    assert ("update billing evidence so it can be checked when you bill, adding 90 new item(s), replacing 6 existing "
            "item(s), in the billing evidence on this computer. The old values are not kept.") in block
    for word in ("delet", "remov"):
        assert word not in block.lower()


def test_a_bulk_write_that_removes_stops_and_says_so(tmp_path):
    s = Session(tmp_path)
    s.say("Apply the file.")
    block = block_of(bulk_gate(s, expect=expecting(removed=2)))
    assert "removing 2 item(s)" in block
    for word in ("adding", "replacing"):
        assert word not in block


def test_a_bulk_call_with_no_preview_and_no_counts_is_sent_to_preview_first(tmp_path):
    s = Session(tmp_path)
    s.say("Apply the file.")
    reason = bulk_gate(s)
    assert "preview" in reason and not MARKER.search(reason)


def test_a_bulk_count_that_is_not_a_whole_number_is_sent_to_preview_first(tmp_path):
    for bad in ("0", None, True, -1, 1.5):
        s = Session(tmp_path)
        s.say("Apply the file.")
        reason = bulk_gate(s, expect=expecting(added=1) | {"removed": bad})
        assert "preview" in reason and not MARKER.search(reason), bad


def test_a_bulk_block_pasted_back_approves_only_those_counts(tmp_path):
    s = Session(tmp_path)
    s.say("Apply the file.")
    s.say(block_of(bulk_gate(s, expect=expecting(replaced=6))))
    assert bulk_gate(s, expect=expecting(replaced=7))
    assert bulk_gate(s, expect=expecting(replaced=6)) is None


def test_a_troubleshooting_entry_goes_to_the_store_only_on_the_pasted_block(tmp_path):
    s = Session(tmp_path)
    name = "mcp__plugin_researcher_commons__troubleshoot__record"
    entry = {"symptom": "mail tools fail", "cause": "username is not the Apple ID", "fix": "re-enter the Apple ID"}
    s.say("That fixed it.")
    s.say(block_of(s.gate(name=name, tool_input=entry, plugin="researcher")))
    assert s.gate(name=name, tool_input={**entry, "fix": "something else"}, plugin="researcher")
    assert s.gate(name=name, tool_input=entry, plugin="researcher") is None


DEDUPE = "mcp__plugin_lawyer_contacts-calendars-email__mail__dedupe_apply"
DEDUPE_CALL = {"plan_id": "abc", "expected_count": 3}


def test_a_dedupe_move_says_trash_and_recoverable_never_one_way(tmp_path):
    s = Session(tmp_path)
    s.say("Remove the duplicates.")
    reason = s.gate(name=DEDUPE, tool_input=DEDUPE_CALL)
    block = block_of(reason)
    assert ("this step: move 3 duplicate email copies, listed in plan abc, to Trash. They can be recovered from "
            "Trash, but the mail server may empty Trash on its own schedule.") in block
    assert "**This step moves email to Trash: it can be recovered from there until the mail server empties Trash on its own schedule.**" in reason
    for wording in ("irreversible", "one-way", "costly to reverse"):
        assert wording not in reason
    s.say(block)
    assert s.gate(name=DEDUPE, tool_input=DEDUPE_CALL) is None


def test_a_dedupe_block_for_one_plan_does_not_approve_another(tmp_path):
    s = Session(tmp_path)
    s.say("Remove the duplicates.")
    block = block_of(s.gate(name=DEDUPE, tool_input=DEDUPE_CALL))
    s.say(block)
    assert s.gate(name=DEDUPE, tool_input={**DEDUPE_CALL, "plan_id": "def"})


def test_a_dedupe_move_from_a_subagent_is_refused(tmp_path):
    s = Session(tmp_path)
    s.say("Remove the duplicates.")
    s.say(block_of(s.gate(name=DEDUPE, tool_input=DEDUPE_CALL)))
    reason = s.gate(name=DEDUPE, tool_input=DEDUPE_CALL, agent_id="a1", agent_type="lawyer:email-reader")
    assert reason and "subagent" in reason


def test_a_sent_record_still_says_one_way(tmp_path):
    s = Session(tmp_path)
    s.say("Record it as sent.")
    reason = s.gate(name="mcp__plugin_lawyer_data__drafting_data__record_sent",
                    tool_input={"db_path": "m.db", "filing_id": 4, "sent_on": "2026-10-28", "expect_revision": 3},
                    plugin="litigator")
    assert "**This step is a one-way door: easy to pass through and costly to reverse.**" in reason
    assert "I understand it is one-way and irreversible." in reason


def test_an_existing_acts_wording_is_unchanged(tmp_path):
    s = Session(tmp_path)
    s.say("Delete that anchor.")
    reason = s.gate()
    assert reason.startswith("Approval needed [approval-gate act=")
    assert ("The call " + TOOL + " is a one-way step and waits for the practitioner's approval. Do not retry it yet, "
            "and do not try another way to do it. Show this warning in bold: **This step is a one-way door: easy to "
            "pass through and costly to reverse.** Then show the block below in a fenced text code block") in reason


GATED = {
    "litigator": ["mcp__plugin_lawyer_data__drafting_data__record_sent", "mcp__plugin_lawyer_data__drafting_data__record_filed",
                  "mcp__plugin_lawyer_data__drafting_data__record_served"],
    "lawyer": ["mcp__plugin_lawyer_data__practice_data__delete_anchor", "mcp__plugin_lawyer_data__practice_data__merge_contact",
               DEDUPE, "mcp__remote-devices__plugin_lawyer_contacts-calendars-email__mail__dedupe_apply"],
    "timekeeper": ["mcp__plugin_lawyer_data__time_pipeline__delete", "mcp__plugin_lawyer_data__time_pipeline__bulk_apply"],
    "file-manager": ["mcp__plugin_file-manager_files__file_ops__comment_pdf"],
    "researcher": ["mcp__plugin_researcher_commons__troubleshoot__record",
                   "mcp__remote-devices__plugin_researcher_commons__troubleshoot__record"],
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
    "mcp__plugin_lawyer_data__practice_data__upsert_anchor", "mcp__plugin_researcher_commons__troubleshoot__confirm_fix",
    "mcp__plugin_file-manager_files__file_ops__move", "mcp__plugin_lawyer_data__drafting_data__execute",
    "mcp__plugin_lawyer_contacts-calendars-email__mail__dedupe_apply_continue",
    "mcp__plugin_lawyer_contacts-calendars-email__mail__dedupe_scan",
    "mcp__plugin_lawyer_contacts-calendars-email__mail__dedupe_record_verdicts",
    "mcp__plugin_lawyer_contacts-calendars-email__mail__list_headers",
    "mcp__plugin_lawyer_contacts-calendars-email__mail__save_message",
    "mcp__plugin_lawyer_contacts-calendars-email__mail__move_messages",
    "mcp__plugin_timekeeper_timecamp__update_entry", "mcp__remote-devices__plugin_timekeeper_timecamp__update_entry",
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
