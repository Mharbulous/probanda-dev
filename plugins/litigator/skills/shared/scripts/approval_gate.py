"""The one-way approval gate every plugin's one-way-gate.py hook shares.

    return approval_gate.check(payload)   # in a PreToolUse hook on a one-way tool

A call is gated only when all three hold: a human must truly read the change, a model must not
make it alone, and it has effect across future sessions. Never gate routine, one-time or
one-session work (a day's activity, a time entry): a block in a regular workflow gets tuned out
(practitioner's rule, 2026-11-06). A gated call passes only on the practitioner's pasted
approval. With none, the gate refuses and
its refusal carries the call's hash: sha256 of the tool name, its canonical-JSON arguments and
the sha256 of every file an argument names (never a database file, whose unrelated writes would
void the approval). The refusal tells the model to show a bold one-way-door warning and a block
whose first line states in plain words what the act does, why, and why it cannot be undone
(first_line, from ACTS and the call's arguments). It names no file path, tool or field: the hash
binds those.

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

Some gated tools also check their approval themselves, on the practitioner's computer
(CHECKS_OWN_APPROVAL; lawyer's mcp/src/approval/gate.ts), because in Cowork the hook runs where no
transcript can be read. For those, an approved call is allowed with `approval_proof` added to its
input: HMAC-SHA256 under the device secret (page-api.secret beside probanda.json) of
"approval\\n<tool>\\n<arguments as canonical JSON>". With no transcript the hook lets them through,
and the tool changes nothing until the practitioner approves the step on a page it serves. If the
secret cannot be read, an approved call goes through without the proof, and the tool asks for the
page's approval. Every other gated tool is refused with no transcript, as before.

A hook finds this module beside hook_io.py and transcript.py in shared/scripts. It keeps no
storage: the transcript is the record.
"""
import hashlib
import hmac
import json
import re
import sys
from pathlib import Path

import hook_io
import transcript

PREFIX = "By cutting and pasting this message I approve"
# One plain sentence per gated tool, keyed by the end of its name, filled from the call's arguments.
ACTS = {
    "record_filed": "record Writing {filing_id} as filed on {filed_on}, in the drafting records of {matter}, "
                    "so the file shows when it was filed. Later steps rely on that record",
    "record_sent": "record Writing {filing_id} as sent on {sent_on}, in the drafting records of {matter}{sent_copy}{waiver}, "
                   "so the file shows when it was sent. Later steps rely on that record",
    "record_served": "record Writing {filing_id} as served on {served_on}, in the drafting records of {matter}, "
                     "so the file shows when it was served. Later steps rely on that record",
    "delete_anchor": "delete anchor {anchor_id} and its sources and derived deadlines, so those dates stop being "
                     "tracked. The deleted dates are not kept",
    "merge_contact": "merge contact {spare_id} into contact {keep_id}, deleting contact {spare_id}, so the person has "
                     "one record. The deleted contact is not kept",
    "issue_invoice": "record invoice {invoice_number} for {amount} as issued, locking its lines and time entries, so "
                     "the bill's record is fixed. The lock is not lifted afterwards",
    "comment_pdf": "write {count} comment(s) on page(s) {pages} into the PDF {file_name}, so they stay with the "
                   "document. They become part of the file",
    "troubleshoot__record": "add this entry to Probanda's shared store, where other Probanda users can read it: "
                            "symptom \"{symptom}\", cause \"{cause}\", fix \"{fix}\"",
    "dedupe_apply": "move {expected_count} duplicate email copies, listed in plan {plan_id}, to Trash",
    "contacts__write_probe": "test whether Probanda can change the address book: create one test contact that holds "
                             "nothing real, add a phone number to it, and remove it again",
    "contacts__import_apply": "add {create_count} new contact(s) to the address book and add details to {update_count} "
                              "existing contact(s), as listed in plan {plan_id}, so the address book holds them. "
                              "Probanda cannot take them out again",
    "contacts__merge_apply": "merge {group_count} group(s) of duplicate contacts in the address book, as listed in plan "
                             "{plan_id}, removing {remove_count} contact(s) after saving a copy of each on this computer",
    "contacts__restore_card": "put the contact {name} back in the address book from the copy saved before it was merged",
}
# Gated acts that can be undone, by the end of the tool's name: what the approval says the
# practitioner understands, in place of "one-way and irreversible", and the warning shown.
REVERSIBLE = {
    "dedupe_apply": {
        "understand": "They can be recovered from Trash, but the mail server may empty Trash on its own schedule.",
        "warning": "**This step moves email to Trash: it can be recovered from there until the mail server empties "
                   "Trash on its own schedule.**",
    },
    "contacts__write_probe": {
        "understand": "No other contact is changed, and the test contact is removed at the end.",
        "warning": "**This step writes to your address book: it creates one test contact and removes it again.**",
    },
    "contacts__merge_apply": {
        "understand": "A removed contact can be put back from its saved copy, but the address book has no Trash of its own.",
        "warning": "**This step removes contacts from your address book after merging them: each can be put back from "
                   "the copy saved on this computer.**",
    },
    "contacts__restore_card": {
        "understand": "It adds one contact and changes no other.",
        "warning": "**This step adds a contact back to your address book.**",
    },
}
# Gated tools that check their own approval, by their name on their server (see the docstring).
CHECKS_OWN_APPROVAL = ("mail__dedupe_apply", "contacts__write_probe", "contacts__import_apply",
                       "contacts__merge_apply", "contacts__restore_card")
SECRET_FILE = "page-api.secret"
SECRET_BYTES = 32
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


def path_parts(path):
    """A path's parts, whichever machine's separators it holds: the hook may run on Linux while the
    path is the practitioner's Windows one."""
    return re.split(r"[\\/]", path or "")


def matter(db_path):
    """A drafting database's folder, which is the matter's case-data folder."""
    parts = path_parts(db_path)
    return parts[-2] if len(parts) > 1 and parts[-2] else "this matter"


def first_line(name, tool_input):
    """The approval's first line, naming the act this call performs. Raises for a gated tool with no
    sentence or a call missing a field, which the hook turns into a refusal."""
    key = next((k for k in ACTS if name.endswith("__" + k)), None)
    if key is None:
        raise ValueError(f"no act sentence for {name}")
    comments = tool_input.get("comments") or []
    fields = {
        **{k: " ".join(v.split()) if isinstance(v, str) else v for k, v in tool_input.items()},
        "matter": matter(tool_input.get("db_path")),
        "file_name": path_parts(tool_input.get("path"))[-1],
        "sent_copy": (f", with the sent copy {path_parts(tool_input['sent_copy_path'])[-1]}" if tool_input.get("sent_copy_path") else
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


def own_check(name):
    """The tool's name on its server when it checks its own approval, else None."""
    return next((tool for tool in CHECKS_OWN_APPROVAL if name.endswith("__" + tool)), None)


def proof(tool, args, secret):
    """What the tool accepts as the practitioner's approval of this exact call."""
    canonical = json.dumps(args, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hmac.new(secret, f"approval\n{tool}\n{canonical}".encode("utf-8"), hashlib.sha256).hexdigest()


def allow_with_proof(tool, tool_input):
    try:
        secret = (hook_io.config_path().parent / SECRET_FILE).read_bytes()
    except OSError:
        return 0
    if len(secret) != SECRET_BYTES:
        return 0
    args = {key: value for key, value in tool_input.items() if key != "approval_proof"}
    return hook_io.pre_tool("allow", "The practitioner pasted the approval of this step.",
                            updatedInput={**args, "approval_proof": proof(tool, args, secret)})


def check(payload):
    if payload.get("agent_id"):
        return hook_io.deny(SUBAGENT_MESSAGE)
    name = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}
    own = own_check(name)
    path = payload.get("transcript_path") or ""
    if not path and own:
        return 0
    act = call_hash(name, tool_input)
    why = why_not(path, name, act) if path else "No record of this conversation could be read."
    if why is not None:
        return hook_io.deny(refusal(name, tool_input, act, why))
    return allow_with_proof(own, tool_input) if own else 0


def failed(exc):
    sys.stderr.write("one-way-gate hook error: " + type(exc).__name__ + ": " + str(exc) + "\n")
    return hook_io.deny("Refused: the check for the practitioner's approval of this one-way step could not run. "
                        "Try again.")
