"""transcript.py: which records are practitioner turns, what each segment holds, and how a tool call
is paired with its result."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import transcript  # noqa: E402

HUMAN = {"kind": "human"}
REMINDER = "<system-reminder>context the harness adds</system-reminder>"


def typed(text, source="sdk", **extra):
    return {"type": "user", "origin": HUMAN, "promptSource": source, "message": {"content": text}, **extra}


def slash(name, args=None):
    body = f"<command-name>/{name}</command-name>" + (f"<command-args>{args}</command-args>" if args is not None else "")
    return {"type": "user", "origin": HUMAN, "message": {"content": body}}


def queued(prompt, **extra):
    return {"type": "attachment", "attachment": {"type": "queued_command", "origin": HUMAN, "prompt": prompt, **extra}}


def assistant(*parts, sidechain=False):
    return {"type": "assistant", "isSidechain": sidechain, "message": {"content": list(parts)}}


def text(value):
    return {"type": "text", "text": value}


def tool_use(use_id, name, **tool_input):
    return {"type": "tool_use", "id": use_id, "name": name, "input": tool_input}


def tool_result(use_id, content="done", is_error=False, sidechain=False):
    return {"type": "user", "isSidechain": sidechain,
            "message": {"content": [{"type": "tool_result", "tool_use_id": use_id, "content": content,
                                     "is_error": is_error}]}}


def write(tmp_path, records, tail=""):
    path = tmp_path / "t.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in records) + tail, encoding="utf-8")
    return path


def turns(tmp_path, records, tail=""):
    return [s.raw for s in transcript.practitioner_turns(write(tmp_path, records, tail))[:-1]]


def test_records_skips_a_half_written_last_line(tmp_path):
    path = write(tmp_path, [typed("one"), typed("two")], tail='{"type": "user", "mess')
    assert [r["message"]["content"] for r in transcript.records(path)] == ["one", "two"]
    assert turns(tmp_path, [typed("one")], tail='{"type": "user", "mess') == ["one"]


def test_a_typed_turn_from_each_typed_source(tmp_path):
    assert turns(tmp_path, [typed("a", "sdk"), typed("b", "typed"), typed("c", "queued")]) == ["a", "b", "c"]


def test_a_prompt_suggestion_or_other_source_is_not_a_turn(tmp_path):
    assert turns(tmp_path, [typed("suggested", "suggestion")]) == []


def test_a_slash_command_s_args_are_the_turn(tmp_path):
    assert turns(tmp_path, [slash("draft", "the reply to Smith")]) == ["the reply to Smith"]


def test_a_slash_command_with_no_args_is_not_a_turn(tmp_path):
    assert turns(tmp_path, [slash("draft"), slash("draft", "  ")]) == []


def test_a_queued_command_is_a_turn_and_its_images_add_no_words(tmp_path):
    prompt = [{"type": "image", "source": {}}, {"type": "text", "text": "and this"}]
    assert turns(tmp_path, [queued("sent mid-turn"), queued(prompt)]) == ["sent mid-turn", "and this"]
    assert turns(tmp_path, [queued("meta", isMeta=True)]) == []


def test_is_meta_and_non_human_origins_are_not_turns(tmp_path):
    records = [typed("skill body", isMeta=True), {**typed("a subagent"), "origin": {"kind": "task-notification"}},
               {**typed("no origin"), "origin": None}]
    assert turns(tmp_path, records) == []


def test_a_turn_that_is_only_a_system_reminder_is_not_a_turn(tmp_path):
    assert turns(tmp_path, [typed(REMINDER), typed(REMINDER + " yes")]) == [transcript.GAP + " yes"]


def test_widget_values_seen_so_far_are_struck_a_sidechain_s_too(tmp_path):
    records = [typed("Smith v Jones before"),
               assistant(tool_use("w1", "show_widget", html='<b data-value="Smith v Jones">x</b>')),
               assistant(tool_use("w2", "show_widget", html="<i data-value='Hadley'>y</i>"), sidechain=True),
               typed("Smith v Jones and Hadley")]
    segments = transcript.practitioner_turns(write(tmp_path, records))
    assert segments[0].struck == "Smith v Jones before"
    assert segments[1].raw == "Smith v Jones and Hadley"
    assert segments[1].struck == transcript.STRUCK + " and " + transcript.STRUCK


def test_the_visible_reply_holds_the_session_s_text_and_send_user_message_not_a_subagent_s(tmp_path):
    records = [assistant(text("before")), typed("first"),
               assistant(text("mine"), tool_use("s1", "SendUserMessage", message="sent")),
               assistant(text("subagent"), tool_use("s2", "SendUserMessage", message="theirs"), sidechain=True),
               assistant(tool_use("s3", "SendUserMessage", message=7)),
               typed("second"), assistant(text("after"))]
    segments = transcript.practitioner_turns(write(tmp_path, records))
    assert [s.reply for s in segments] == [["before"], ["mine", "sent", ""], ["after"]]
    assert segments[-1].raw is None


def test_tool_calls_pair_with_their_results_in_the_segment_they_were_made(tmp_path):
    records = [assistant(tool_use("a", "Agent", subagent_type="x")), typed("go"),
               assistant(tool_use("b", "mcp__x__drafting_data__execute", sql_script="SELECT 1"),
                         tool_use("c", "Write", file_path="f")),
               tool_result("b", [{"type": "text", "text": "ok"}, {"type": "image"}]),
               tool_result("a", "late"),
               assistant(tool_use("d", "Task"), sidechain=True),
               tool_result("d", "boom", is_error=True, sidechain=True)]
    first, tail = transcript.practitioner_turns(write(tmp_path, records))
    assert [(c.name, c.result) for c in first.calls] == [("Agent", "late")]
    assert [(c.name, c.input, c.sidechain, c.result, c.is_error) for c in tail.calls] == [
        ("mcp__x__drafting_data__execute", {"sql_script": "SELECT 1"}, False, "ok\n", False),
        ("Write", {"file_path": "f"}, False, None, False),
        ("Task", {}, True, "boom", True)]


def test_shared_helpers():
    assert transcript.norm("  Go\n AHEAD ") == "go ahead"
    assert transcript.approval("Yes." + transcript.GAP) and not transcript.approval("yes please")
    assert transcript.fences("```\nkeep\n```\n```py\nb\n```") == ["keep", "b"]
