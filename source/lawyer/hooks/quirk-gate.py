#!/usr/bin/env python3
"""Refuse a practice quirk the practitioner has not approved in their own words (the quirk gate).

Hook event: PreToolUse on quirks__write. A quirk is a `rule` (the practitioner's instruction about what
Probanda must or must not do in this practice) or `knowledge` (a fact that directs nothing). The tool
cannot see the practitioner's messages, so this gate reads the session transcript the harness wrote and
never the model's account of it. Docs: docs/Specs/2026-11-06_practice-quirks-entries-spec.md.

| call                                                    | passes only when the practitioner's last turn ... |
| add / revise, type rule, or revise of a rule            | holds the call's title AND body, each as an unbroken run (pasted from the code block the session showed, or typed). A bare yes never passes. |
| retire a rule                                           | holds the rule's title and a word of REMOVAL. |
| add / revise, knowledge                                 | is a bare yes, and the session's reply before it showed the title and body. |
| confirm a rule; retire or confirm knowledge             | is a bare yes, and the session's reply before it showed the entry's title. |
| any call from a subagent                                | never: its calls are not in the main transcript, so the practitioner cannot have approved them. |

`expect_type` and `expect_title` name the stored entry a revise, confirm or retire acts on; the tool
refuses a call whose echo does not match the file, so the gate can rely on them without reading it.
Known limit, as rule-gate's: the gate proves the practitioner's message holds the words, not that they
meant to approve them. The proposal block asks them to paste the whole block, which makes it deliberate.

A practitioner turn is read as Probanda's other transcript gates read one (shared/scripts/transcript.py).
A run ignores case and runs of whitespace; punctuation and word order count. Exit 0 allows the call;
exit 2 refuses it and the session reads stderr. The gate fails CLOSED: a missing transcript, an op it
does not know, or any error of its own refuses the call.
"""
import importlib.util
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve()
    # shared/scripts in the built plugin, else in this repo's source tree
    sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                     HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
    import hook_io
    from transcript import STRUCK, approval, norm, practitioner_turns
    # The word list that says a practitioner is asking to remove or replace a rule is rule-gate's.
    _spec = importlib.util.spec_from_file_location("rule_gate", HERE.parent / "rule-gate.py")
    _rule_gate = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_rule_gate)
    REMOVAL = _rule_gate.REMOVAL
except Exception as exc:  # a crash would let the call through
    sys.stderr.write(f"Refused: quirk-gate cannot load its helper: {exc!r}\n")
    sys.exit(2)

PREFIX = "Refused: "
OPS = ("add", "revise", "confirm", "retire")
CEREMONY = ("A practice rule is saved only in the practitioner's own words. Show the proposed rule in a code block "
            "(PROPOSED PRACTICE RULE (area: ...), Title: ..., Body: ..., and a line asking them to paste the whole "
            "block into chat) and save it only after their next message holds the title and body. "
            "\"Yes\" or \"Approved\" never saves a rule. Knowledge, and confirming or retiring an entry, are saved "
            "after the practitioner's plain yes to wording you have just shown. A subagent returns its proposal to "
            "the main session, which asks.")


def refuse(message):
    return hook_io.refuse(PREFIX + message + "\n" + CEREMONY)


def read_transcript(path):
    """(the practitioner's turns with widget values struck, the session's visible reply before the last one)."""
    *segments, _tail = practitioner_turns(path)
    return [segment.struck for segment in segments], ["\n".join(segment.reply) for segment in segments]


def text_of(tool_input, key):
    value = tool_input.get(key)
    return value if isinstance(value, str) and value.strip() else None


def main():
    payload = hook_io.payload()
    if payload.get("agent_id"):
        return refuse("a subagent's call cannot be approved, because its calls are not in the session transcript the "
                      "practitioner's messages are read from.")
    tool_input = payload.get("tool_input") or {}
    op = tool_input.get("op")
    if op not in OPS:
        return refuse(f"the request ({op!r}) is not one of {', '.join(OPS)}, so it cannot be checked.")
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the session transcript is not available, so there is no record of what the practitioner said.")
    try:
        turns, replies = read_transcript(path)
    except OSError as exc:
        return refuse(f"cannot read the session transcript at {path}: {exc}")
    if not turns:
        return refuse(f"the session transcript at {path} holds no practitioner turn.")
    last, last_reply = turns[-1], replies[-1]
    shown = norm(last_reply)
    in_last = norm(last)

    new_type, old_type = tool_input.get("type"), tool_input.get("expect_type")
    old_title = text_of(tool_input, "expect_title")
    if op in ("add", "revise"):
        title, body = text_of(tool_input, "title"), text_of(tool_input, "body")
        if title is None or body is None or new_type not in ("rule", "knowledge"):
            return refuse("the entry has no type, title or body to check.")
        if op == "revise" and old_type not in ("rule", "knowledge"):
            return refuse("a revision must say which type of entry it replaces (expect_type).")
        if "rule" in (new_type, old_type):
            if norm(title) in in_last and norm(body) in in_last:
                return 0
            return refuse("the practitioner's last turn does not hold this rule's title and body as unbroken runs.\n"
                          f"  title: {title}\n  last turn: {last[:200]}")
        if approval(last) and norm(title) in shown and norm(body) in shown:
            return 0
        return refuse("the practitioner's last turn is not a bare yes to a reply that showed this title and body.\n"
                      f"  title: {title}\n  last turn: {last[:200]}")
    # confirm and retire act on a stored entry that the tool will check against old_type and old_title
    if old_title is None or old_type not in ("rule", "knowledge"):
        return refuse("the call does not name the entry's type and title (expect_type, expect_title).")
    if op == "retire" and old_type == "rule":
        if norm(old_title) in in_last and REMOVAL.search(last.replace(STRUCK, " ")):
            return 0
        return refuse("the practitioner's last turn does not ask to remove or replace this rule by its title.\n"
                      f"  title: {old_title}\n  last turn: {last[:200]}")
    if approval(last) and norm(old_title) in shown:
        return 0
    return refuse("the practitioner's last turn is not a bare yes to a reply that showed this entry's title.\n"
                  f"  title: {old_title}\n  last turn: {last[:200]}")


if __name__ == "__main__":
    # the gate's own failure refuses the call
    hook_io.run(main, "quirk-gate", closed=lambda exc: refuse(f"the gate itself failed: {exc!r}"))
