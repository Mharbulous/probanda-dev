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

A practitioner turn is read as Probanda's other transcript gates read one (shared/scripts/transcript.py):
a `user` line with no isMeta, origin kind "human", and promptSource "sdk", "typed" or "queued"; a
queued_command attachment with origin kind "human"; or the command-args of a slash command. Every
<system-reminder> block is cut out, and every data-value of the session's earlier show_widget calls
is struck, so a widget echo supplies no words. A run ignores case and runs of whitespace;
punctuation and word order count.

Exit 0 allows the call; exit 2 refuses it and the session reads stderr. The gate fails CLOSED: a
missing transcript, an op it does not know, or any error of its own refuses the call.
"""
import re
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve()
    # shared/scripts in the built plugin, else in this repo's source tree
    sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                     HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
    import hook_io
    from transcript import STRUCK, approval, fences, norm, practitioner_turns
except Exception as exc:  # a crash would let the call through
    sys.stderr.write(f"Refused: rule-gate cannot load its helper: {exc!r}\n")
    sys.exit(2)

PREFIX = "Refused: "
ENFORCE_QUESTION = "Do you want me to enforce that rule for all future sessions?"
REMOVAL = re.compile(r"(?i)\b(remove|retire|delete|drop|cancel|revoke|reverse|replace|change|amend|modify|"
                     r"update|undo|forget|withdraw|scrap|no longer)\b")
CEREMONY = ("A Rule is made only in the practitioner's own words: ask \"" + ENFORCE_QUESTION + "\" and save the "
            "instruction exactly as they said it only after their next turn is a bare yes. To change a Rule, show the "
            "new wording in a code block and ask them to paste it into chat: \"Approved\" never adopts it. Retire a "
            "Rule only when their own words ask to remove or replace it.")


def read_transcript(path):
    """(practitioner turns with widget values struck, the session's visible reply between the turn
    before the last and the last, every fenced block the session's visible replies showed before
    the last turn, whether a preferences__write retire was called since the last turn)."""
    *segments, tail = practitioner_turns(path)
    replies = ["\n".join(segment.reply) for segment in segments]
    shown = [block for reply in replies for block in fences(reply)]
    retired = any(call.name.endswith("preferences__write") and not call.sidechain and call.input.get("op") == "retire"
                  for call in tail.calls)
    return [segment.struck for segment in segments], (replies or [""])[-1], shown, retired


def refuse(message):
    return hook_io.refuse(PREFIX + message + "\n" + CEREMONY)


def main():
    payload = hook_io.payload()
    tool_input = payload.get("tool_input") or {}
    op = tool_input.get("op")
    if op not in ("add", "retire"):
        return refuse(f"the request ({op!r}) is neither to add nor to retire a Rule, so it cannot be checked.")
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the session transcript is not available, so there is no record of what the practitioner said.")
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
        return refuse("the new Rule has no wording.")
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
    # the gate's own failure refuses the call
    hook_io.run(main, "rule-gate", closed=lambda exc: refuse(f"the gate itself failed: {exc!r}"))
