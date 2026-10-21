#!/usr/bin/env python3
"""Refuse a practitioner Rule the practitioner did not make in their own words (the Rule gate).

Hook event: PreToolUse on preferences__write. A Rule is an instruction a practitioner gives, in
their own words, for their own future Probanda sessions, kept as a preference
(shared/paralegal-posture.md section 9; docs/Specs/2026-10-20_approved-research-issues-pass-job-words-gate-spec.md).
This gate is the Global Rule: it applies to every user, and only the Probanda team changes it.

- An `add` passes when its instruction is an unbroken run of one practitioner turn in this
  session's transcript, and either:
  - the practitioner's last turn is a bare yes (APPROVALS, the whole turn) answering the session's
    visible reply since the turn before it, which asks ENFORCE_QUESTION; or
  - it replaces a Rule: a preferences__write retire was called since the practitioner's last turn,
    that turn asks for the change as a retire must (below), and the instruction is a run of that
    turn (pasted or typed).
- A `retire` passes when the practitioner's last turn asks to remove or replace a Rule: it holds a
  word of REMOVAL, or it holds, as an unbroken run, a fenced code block the session showed in a
  visible reply earlier in this session (the pasted replacement). A bare "Approved" does neither.
  Known limit: the gate cannot tell which Rule the turn names, only that it asks for a change.

A practitioner turn is read as Probanda's other transcript gates read one (copied, not imported,
so this hook depends on no other plugin): a `user` line with no isMeta, origin kind "human", and promptSource "sdk", "typed" or "queued"; a
queued_command attachment with origin kind "human"; or the command-args of a slash command. Every
<system-reminder> block is cut out, and every data-value of the session's earlier show_widget calls
is struck, so a widget echo supplies no words. A run ignores case and runs of whitespace;
punctuation and word order count.

Exit 0 allows the call; exit 2 refuses it and the session reads stderr. The gate fails CLOSED: a
missing transcript, an op it does not know, or any error of its own refuses the call.
"""
import html
import json
import re
import sys

PREFIX = "Refused (Rule gate): "
ENFORCE_QUESTION = "Do you want me to enforce that rule for all future sessions?"
TYPED_SOURCES = {"sdk", "typed", "queued"}
STRUCK = " \x00 "
GAP = " \x01 "  # where a system-reminder block was cut out of a turn
REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.S)
DATA_VALUE = re.compile(r"""data-value\s*=\s*(?:"([^"]*)"|'([^']*)')""")
FENCE = re.compile(r"^```[^\n]*\n(.*?)^```", re.M | re.S)
APPROVALS = {"yes", "approved", "approve", "agreed", "go ahead", "yes, go ahead", "ok", "okay", "do it"}
REMOVAL = re.compile(r"(?i)\b(remove|retire|delete|drop|cancel|revoke|reverse|replace|change|amend|modify|"
                     r"update|undo|forget|withdraw|scrap|no longer)\b")
CEREMONY = ("A Rule is made only in the practitioner's own words: ask \"" + ENFORCE_QUESTION + "\" and save the "
            "instruction exactly as they said it only after their next turn is a bare yes. To change a Rule, show the "
            "new wording in a code block and ask them to paste it into chat: \"Approved\" never adopts it. Retire a "
            "Rule only when their own words ask to remove or replace it (shared/paralegal-posture.md section 9).")


def norm(text):
    return " ".join(text.split()).casefold()


def text_of(content):
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content
                         if isinstance(part, dict) and part.get("type") == "text")
    return content if isinstance(content, str) else ""


def words(text):
    """text with every system-reminder block cut out, or "" when that leaves no words."""
    text = REMINDER.sub(GAP, text)
    return text if text.replace(GAP, "").strip() else ""


def strike(turn, values):
    for value in sorted(values, key=len, reverse=True):
        turn = re.sub(r"(?<!\w)" + re.escape(value) + r"(?!\w)", STRUCK, turn)
    return turn


def approval(turn):
    """Whether a turn, its struck widget values and cut reminders removed, is a bare yes."""
    return norm(turn.replace(STRUCK.strip(), " ").replace(GAP.strip(), " ")).rstrip(".!") in APPROVALS


def read_transcript(path):
    """(practitioner turns with widget values struck, the session's visible reply between the turn
    before the last and the last, every fenced block the session's visible replies showed before
    the last turn, whether a preferences__write retire was called since the last turn)."""
    turns, widget_values = [], set()
    visible, last_reply, shown = [], "", []
    retired = False
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except ValueError:
                continue  # a line the harness is still writing
            content = (rec.get("message") or {}).get("content")
            parts = [p for p in content if isinstance(p, dict)] if isinstance(content, list) else []
            turn = ""
            if rec.get("type") == "assistant":
                for part in parts:
                    if part.get("type") == "text" and not rec.get("isSidechain"):
                        visible.append(part.get("text") or "")
                    if part.get("type") != "tool_use":
                        continue
                    name = part.get("name") or ""
                    tool_input = part.get("input") or {}
                    if name.endswith("SendUserMessage") and not rec.get("isSidechain"):
                        message = tool_input.get("message")
                        visible.append(message if isinstance(message, str) else "")
                    elif (name.endswith("preferences__write") and not rec.get("isSidechain")
                          and tool_input.get("op") == "retire"):
                        retired = True
                    if name.endswith("show_widget"):
                        code = "\n".join(v for v in tool_input.values() if isinstance(v, str))
                        widget_values |= {html.unescape(a or b) for a, b in DATA_VALUE.findall(code)
                                          if (a or b).strip()}
                continue
            if rec.get("type") == "user":
                origin = rec.get("origin")
                if rec.get("isMeta") or not isinstance(origin, dict) or origin.get("kind") != "human":
                    continue
                turn = words(text_of(content))
                if rec.get("promptSource") is None:
                    # A slash command carries no promptSource: only its arguments are the practitioner's words.
                    args = COMMAND_ARGS.search(turn) if "<command-name>" in turn else None
                    if not args:
                        continue
                    turn = words(args.group(1))
                elif rec["promptSource"] not in TYPED_SOURCES:
                    continue
            elif rec.get("type") == "attachment":
                queued = rec.get("attachment") or {}
                origin = queued.get("origin")
                if (queued.get("type") == "queued_command" and not queued.get("isMeta") and isinstance(origin, dict)
                        and origin.get("kind") == "human"):
                    turn = words(text_of(queued.get("prompt")))
            if turn:
                turns.append(strike(turn, widget_values))
                last_reply, visible, retired = "\n".join(visible), [], False
                shown += FENCE.findall(last_reply)
    return turns, last_reply, shown, retired


def refuse(message):
    sys.stderr.write(PREFIX + message + "\n" + CEREMONY + "\n")
    return 2


def main():
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    tool_input = payload.get("tool_input") or {}
    op = tool_input.get("op")
    if op not in ("add", "retire"):
        return refuse(f"op {op!r} is neither add nor retire, so the gate cannot read it.")
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the hook input names no transcript_path, so there is no record of what the practitioner said.")
    try:
        turns, last_reply, shown, retired = read_transcript(path)
    except OSError as exc:
        return refuse(f"cannot read the session transcript at {path}: {exc}")
    if not turns:
        return refuse(f"the session transcript at {path} holds no practitioner turn.")
    last = turns[-1]
    pasted = any(norm(block) and norm(block) in norm(last) for block in shown)
    asks_change = bool(REMOVAL.search(last.replace(STRUCK, " "))) or pasted
    if op == "retire":
        if asks_change:
            return 0
        return refuse(f"the practitioner's last turn does not ask to remove or replace a Rule.\n"
                      f"  last turn: {last[:200]}")
    instruction = tool_input.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        return refuse("the add names no instruction.")
    if retired:
        if asks_change and norm(instruction) in norm(last):
            return 0
        return refuse(f"a replacement Rule needs the practitioner's last turn to ask for the change and to hold "
                      f"the new wording as an unbroken run, pasted or typed.\n  wrote: {instruction}\n  last turn: {last[:200]}")
    if not any(norm(instruction) in norm(turn) for turn in turns[:-1]):
        return refuse(f"the instruction is not an unbroken run of one thing the practitioner said in this session.\n"
                      f"  wrote: {instruction}")
    if approval(last) and norm(ENFORCE_QUESTION) in norm(last_reply):
        return 0
    return refuse(f"the practitioner's last turn is not a bare yes to \"{ENFORCE_QUESTION}\" asked in the reply "
                  f"before it.\n  wrote: {instruction}\n  last turn: {last[:200]}")


if __name__ == "__main__":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        sys.exit(main())
    except Exception as exc:  # the gate's own failure refuses the call
        sys.exit(refuse(f"the gate itself failed: {exc!r}"))
