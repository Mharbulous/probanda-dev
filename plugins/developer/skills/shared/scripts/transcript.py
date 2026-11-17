"""How Probanda's transcript gates read a session's practitioner turns from the harness's transcript.

    for rec in transcript.records(path): ...     # each JSON line, a half-written one skipped
    *turns, tail = transcript.practitioner_turns(path)

A practitioner turn is a `user` line with no isMeta, origin kind "human", and promptSource "sdk"
(desktop and Cowork) or "typed"/"queued" (a terminal session); or a queued_command attachment
with origin kind "human" and no isMeta (a message sent mid-turn, #1358), whose prompt's text parts
count (#1456). A slash command's record has no promptSource: only its command-args are the
practitioner's words. Every <system-reminder> block is cut out of a turn, and a record left with
no words is not a turn (#1366). Every data-value of the session's earlier show_widget calls, a
subagent's included, is struck out of the turn, so a widget echo supplies no words.

Each segment holds what came before its turn: the session's visible reply (its own text parts
and SendUserMessage messages, not a subagent's) and the tool calls since the previous turn, each
paired with the tool_result that answered it. The last segment, with no turn, holds what came
after the last turn. A hook finds this module beside hook_io.py in shared/scripts.
"""
import html
import json
import re
from dataclasses import dataclass, field

TYPED_SOURCES = {"sdk", "typed", "queued"}
STRUCK = " \x00 "
GAP = " \x01 "  # where a system-reminder block was cut out of a turn
REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.S)
DATA_VALUE = re.compile(r"""data-value\s*=\s*(?:"([^"]*)"|'([^']*)')""")
FENCE = re.compile(r"^```[^\n]*\n(.*?)^```", re.M | re.S)
# A whole practitioner turn that approves the session's proposal, as approval() normalizes it.
APPROVALS = {"yes", "approved", "approve", "agreed", "go ahead", "yes, go ahead", "ok", "okay", "do it"}


@dataclass
class Call:
    name: str
    input: dict
    sidechain: bool
    result: str = None  # the answering tool_result's text, None while unanswered
    is_error: bool = False


@dataclass
class Segment:
    raw: str = None  # the turn, reminders cut; None in the last segment
    struck: str = None  # the turn with earlier widget values struck
    reply: list = field(default_factory=list)  # the visible reply before the turn, part by part
    calls: list = field(default_factory=list)  # the tool calls since the previous turn


def norm(text):
    return " ".join(text.split()).casefold()


def text_of(content):
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content
                         if isinstance(part, dict) and part.get("type") == "text")
    return content if isinstance(content, str) else ""


def words(text):
    """text with every system-reminder block cut out, or "" when that leaves no words (#1366)."""
    text = REMINDER.sub(GAP, text)
    return text if text.replace(GAP, "").strip() else ""


def strike(turn, values):
    for value in sorted(values, key=len, reverse=True):
        turn = re.sub(r"(?<!\w)" + re.escape(value) + r"(?!\w)", STRUCK, turn)
    return turn


def approval(turn):
    """Whether a turn, its struck widget values and cut reminders removed, is a bare yes."""
    return norm(turn.replace(STRUCK.strip(), " ").replace(GAP.strip(), " ")).rstrip(".!") in APPROVALS


def fences(text):
    """Each fenced code block's content in text, its final newline dropped."""
    return [b[:-1] if b.endswith("\n") else b for b in FENCE.findall(text)]


def result_text(content):
    if isinstance(content, list):
        return "\n".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content if isinstance(content, str) else ""


def records(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                yield json.loads(line)
            except ValueError:
                continue  # a line the harness is still writing


def turn_of(rec):
    """The practitioner's words in a record, reminders cut, or "" when it is not a practitioner turn."""
    if rec.get("type") == "user":
        origin = rec.get("origin")
        if rec.get("isMeta") or not isinstance(origin, dict) or origin.get("kind") != "human":
            return ""
        turn = words(text_of((rec.get("message") or {}).get("content")))
        if rec.get("promptSource") is None:
            # A slash command carries no promptSource: only its arguments are the practitioner's words.
            args = COMMAND_ARGS.search(turn) if "<command-name>" in turn else None
            return words(args.group(1)) if args else ""
        return turn if rec["promptSource"] in TYPED_SOURCES else ""
    if rec.get("type") == "attachment":
        queued = rec.get("attachment") or {}
        origin = queued.get("origin")
        if (queued.get("type") == "queued_command" and not queued.get("isMeta") and isinstance(origin, dict)
                and origin.get("kind") == "human"):
            return words(text_of(queued.get("prompt")))
    return ""


def practitioner_turns(path):
    """The session's segments: one per practitioner turn, then the last one after the last turn."""
    segments, current, calls, widget_values = [], Segment(), {}, set()
    for rec in records(path):
        content = (rec.get("message") or {}).get("content")
        parts = [p for p in content if isinstance(p, dict)] if isinstance(content, list) else []
        sidechain = bool(rec.get("isSidechain"))
        if rec.get("type") == "assistant":
            for part in parts:
                if part.get("type") == "text" and not sidechain:
                    current.reply.append(part.get("text") or "")
                if part.get("type") != "tool_use":
                    continue
                call = Call(part.get("name") or "", part.get("input") or {}, sidechain)
                current.calls.append(call)
                calls[part.get("id")] = call
                if call.name.endswith("SendUserMessage") and not sidechain:
                    message = call.input.get("message")
                    current.reply.append(message if isinstance(message, str) else "")
                if call.name.endswith("show_widget"):
                    code = "\n".join(v for v in call.input.values() if isinstance(v, str))
                    widget_values |= {html.unescape(a or b) for a, b in DATA_VALUE.findall(code)
                                      if (a or b).strip()}
            continue
        if rec.get("type") == "user":
            for part in parts:
                if part.get("type") == "tool_result" and part.get("tool_use_id") in calls:
                    call = calls[part.get("tool_use_id")]
                    call.result, call.is_error = result_text(part.get("content")), bool(part.get("is_error"))
        turn = turn_of(rec)
        if turn:
            current.raw, current.struck = turn, strike(turn, widget_values)
            segments.append(current)
            current = Segment()
    return segments + [current]
