"""The one-way approval gate every plugin's one-way-gate.py hook shares.

    return approval_gate.check(payload)   # in a PreToolUse hook on a one-way tool

A one-way call (sending, filing, deleting or merging records, changing a time entry, writing
into a PDF) passes only on the practitioner's pasted approval. With none, the gate refuses and
its refusal carries the call's hash: sha256 of the tool name, its canonical-JSON arguments and
the sha256 of every file an argument names (never a database file, whose unrelated writes would
void the approval). The refusal tells the model to show a bold one-way-door warning and a block
whose first line names the act in plain words (first_line, from ACTS and the call's arguments).

A retry passes only when all of these hold, read from the harness transcript, which the session
cannot write:
- the latest practitioner turn (transcript.turn_of) holds the first line for the refused call,
  compared case- and whitespace-insensitively;
- that turn follows the refusal, and no compact_boundary lies after the refusal;
- exactly one act was refused between the previous practitioner turn and that one;
- no successful call of the refused tool follows that turn (an approval is used once);
- with `Modifications: NONE` (or no Modifications line) the call's hash equals the refused hash;
  with written modifications the call may differ but must be the same tool.
A call from a subagent (`agent_id` in the payload) is refused: its calls and results go to its
own transcript, which the gate cannot read. Plan: docs/Plans/2026-10-28_untrusted-content-and-approvals.md.

A hook finds this module beside hook_io.py and transcript.py in shared/scripts. It keeps no
storage: the transcript is the record.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

import hook_io
import transcript

PREFIX = "By cutting and pasting this message I approve"
# One plain sentence per gated tool, keyed by the end of its name, filled from the call's arguments.
ACTS = {
    "record_filed": "record Writing {filing_id} as filed on {filed_on}, in the database {db_path}",
    "record_sent": "record Writing {filing_id} as sent on {sent_on}, in the database {db_path}{sent_copy}{waiver}",
    "record_served": "record Writing {filing_id} as served on {served_on}, in the database {db_path}",
    "delete_anchor": "delete anchor {anchor_id} and its sources and derived deadlines",
    "merge_contact": "merge contact {spare_id} into contact {keep_id}, deleting contact {spare_id}",
    "time_pipeline__delete": "delete the key {key} from the time-pipeline namespace {namespace}",
    "time_pipeline__bulk_apply": "apply the writes in {path}, which include deletes, to the time-pipeline namespace {namespace}",
    "update_entry": "move TimeCamp entry {entry_id} to task {task_id} and replace its note with \"{note}\"",
    "comment_pdf": "write {count} comment(s) on page(s) {pages} into the PDF {path}",
    "troubleshoot__record": "add this entry to Probanda's shared store, where other Probanda users can read it: "
                            "symptom \"{symptom}\", cause \"{cause}\", fix \"{fix}\"",
    "dedupe_apply": "move {expected_count} duplicate email copies, listed in plan {plan_id}, to Trash",
}
# Gated acts that can be undone, by the end of the tool's name: what the approval says the
# practitioner understands, in place of "one-way and irreversible", and the warning shown.
REVERSIBLE = {
    "dedupe_apply": {
        "understand": "They can be recovered from Trash, but the mail server may empty Trash on its own schedule.",
        "warning": "**This step moves email to Trash: it can be recovered from there until the mail server empties "
                   "Trash on its own schedule.**",
    },
}
MARKER = re.compile(r"\[approval-gate act=([0-9a-f]{64})\]")
MODIFICATIONS = re.compile(r"modifications:(.*)", re.I | re.S)
DATABASE_SUFFIXES = {".db", ".sqlite", ".sqlite3"}

SUBAGENT_MESSAGE = (
    "Refused: a one-way step is never taken from inside a subagent. Return what this call would do "
    "to the main session, which asks the practitioner for approval and makes the call itself."
)


def call_hash(name, tool_input):
    digest = hashlib.sha256()
    digest.update(name.encode("utf-8") + b"\0")
    digest.update(json.dumps(tool_input, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    for text in sorted(set(hook_io.strings(tool_input))):
        path = Path(text)
        try:
            if path.suffix.lower() in DATABASE_SUFFIXES or not path.is_file():
                continue
            content = path.read_bytes()
        except (OSError, ValueError):
            continue
        digest.update(b"\0" + text.encode("utf-8") + b"\0" + hashlib.sha256(content).hexdigest().encode("ascii"))
    return digest.hexdigest()


def first_line(name, tool_input):
    """The approval's first line, naming the act this call performs. Raises for a gated tool with no
    sentence or a call missing a field, which the hook turns into a refusal."""
    key = next((k for k in ACTS if name.endswith("__" + k)), None)
    if key is None:
        raise ValueError(f"no act sentence for {name}")
    comments = tool_input.get("comments") or []
    fields = {
        **{k: " ".join(v.split()) if isinstance(v, str) else v for k, v in tool_input.items()},
        "sent_copy": (f", with the sent copy {tool_input['sent_copy_path']}" if tool_input.get("sent_copy_path") else
                      ", with pasted text as the sent copy" if tool_input.get("sent_copy_text") else ""),
        "waiver": ", waiving the pre-send hold" if tool_input.get("send_anyway") else "",
        "count": len(comments),
        "pages": ", ".join(str(page) for page in sorted({c["page"] for c in comments})),
    }
    understand = REVERSIBLE[key]["understand"] if key in REVERSIBLE else "I understand it is one-way and irreversible."
    return f"{PREFIX} this step: {ACTS[key].format_map(fields)}. {understand}"


def refusal(name, tool_input, act, why):
    reversible = next((v for k, v in REVERSIBLE.items() if name.endswith("__" + k)), None)
    kind = "an approved step" if reversible else "a one-way step"
    warning = reversible["warning"] if reversible else "**This step is a one-way door: easy to pass through and costly to reverse.**"
    return (
        f"Approval needed [approval-gate act={act}]. {why} The call {name} is {kind} and waits for "
        "the practitioner's approval. Do not retry it yet, and do not try another way to do it. Show this "
        f"warning in bold: {warning} Then "
        "show the block below in a fenced text code block and ask the practitioner to copy and paste it back "
        "as their reply, replacing NONE with any change they want in their own words. Retry only after that "
        "reply.\n\n```text\n" + first_line(name, tool_input) + "\nModifications: NONE\n```"
    )


def events(path):
    """The session's own events in order: ("turn", text), ("boundary",) and ("call", record), each call
    record a dict of name, input and, once answered, result and is_error."""
    out, calls = [], {}
    for rec in transcript.records(path):
        if rec.get("type") == "system" and rec.get("subtype") == "compact_boundary":
            out.append(("boundary",))
            continue
        content = (rec.get("message") or {}).get("content")
        parts = [p for p in content if isinstance(p, dict)] if isinstance(content, list) else []
        if rec.get("isSidechain"):
            continue
        if rec.get("type") == "assistant":
            for part in parts:
                if part.get("type") == "tool_use":
                    call = {"name": part.get("name") or "", "input": part.get("input") or {}, "result": None, "is_error": False}
                    calls[part.get("id")] = call
                    out.append(("call", call))
            continue
        for part in parts:
            if part.get("type") == "tool_result" and part.get("tool_use_id") in calls:
                call = calls[part.get("tool_use_id")]
                call["result"] = transcript.result_text(part.get("content"))
                call["is_error"] = bool(part.get("is_error"))
        turn = transcript.turn_of(rec)
        if turn:
            out.append(("turn", turn))
    return out


def why_not(path, name, act):
    """None when the transcript approves this call, else the reason it does not."""
    found = events(path)
    turns = [i for i, event in enumerate(found) if event[0] == "turn"]
    if not turns or transcript.norm(PREFIX) not in transcript.norm(found[turns[-1]][1]):
        return "The practitioner's latest message is not the pasted approval."
    last = turns[-1]
    previous = turns[-2] if len(turns) > 1 else -1
    refused = {}
    for i in range(previous + 1, last):
        if found[i][0] == "call" and found[i][1]["result"]:
            match = MARKER.search(found[i][1]["result"])
            if match:
                refused[match.group(1)] = (i, found[i][1]["name"], found[i][1]["input"])
    if len(refused) != 1:
        return ("The pasted approval follows no refusal." if not refused else
                "More than one step was waiting for approval, so the pasted approval cannot say which.")
    refused_act, (at, refused_name, refused_input) = next(iter(refused.items()))
    if transcript.norm(first_line(refused_name, refused_input)) not in transcript.norm(found[last][1]):
        return "The pasted approval does not describe the step that was refused."
    if any(event[0] == "boundary" for event in found[at + 1:]):
        return "The conversation was compacted after the step was refused."
    if any(event[0] == "call" and event[1]["name"] == refused_name and event[1]["result"] is not None
           and not event[1]["is_error"] for event in found[last + 1:]):
        return "That approval was already used."
    modifications = MODIFICATIONS.search(found[last][1])
    changed = modifications is not None and transcript.norm(modifications.group(1)).rstrip(".") != "none"
    if changed:
        return None if name == refused_name else "The approval was for a different step."
    return None if act == refused_act else "The call is not the one approved."


def check(payload):
    if payload.get("agent_id"):
        return hook_io.deny(SUBAGENT_MESSAGE)
    name = payload.get("tool_name") or ""
    act = call_hash(name, payload.get("tool_input") or {})
    path = payload.get("transcript_path") or ""
    why = why_not(path, name, act) if path else "No record of this conversation could be read."
    return 0 if why is None else hook_io.deny(refusal(name, payload.get("tool_input") or {}, act, why))


def failed(exc):
    sys.stderr.write("one-way-gate hook error: " + type(exc).__name__ + ": " + str(exc) + "\n")
    return hook_io.deny("Refused: the check for the practitioner's approval of this one-way step could not run. "
                        "Try again.")
