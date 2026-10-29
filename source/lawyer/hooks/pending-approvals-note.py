#!/usr/bin/env python3
"""After a compaction or a resume, list the one-way steps still waiting for approval.

Hook event: SessionStart, matcher compact|resume. A one-way step the approval gate
(shared/scripts/approval_gate.py) refused, with no later successful call of the same tool, is
still waiting. For each, the note names the step and says that approval counts only if the
practitioner pastes the approval block after this point. It never quotes the block, so it holds
nothing that reads as an approval, and it keeps no storage: the transcript is the record.
Fails OPEN on its own error, loudly on stderr.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
import approval_gate  # noqa: E402
import hook_io  # noqa: E402

HEADER = ("These one-way steps were refused for want of the practitioner's approval and have not been "
          "taken. An approval given before this point no longer counts: each counts only if the "
          "practitioner pastes the approval block after this point, in reply to a new refusal.")


def pending(path):
    found = approval_gate.events(path)
    waiting = {}
    for i, event in enumerate(found):
        if event[0] != "call" or not event[1]["result"]:
            continue
        match = approval_gate.MARKER.search(event[1]["result"])
        if match and not any(later[0] == "call" and later[1]["name"] == event[1]["name"]
                             and later[1]["result"] is not None and not later[1]["is_error"]
                             for later in found[i + 1:]):
            waiting[match.group(1)] = event[1]
    return list(waiting.values())


def main():
    payload = hook_io.payload()
    path = payload.get("transcript_path")
    if payload.get("source") not in ("compact", "resume") or not path or not Path(path).is_file():
        return 0
    calls = pending(path)
    if not calls:
        return 0
    lines = [f"- {call['name']} with {json.dumps(call['input'], ensure_ascii=False, sort_keys=True)}" for call in calls]
    return hook_io.note("SessionStart", HEADER + "\n" + "\n".join(lines))


if __name__ == "__main__":
    hook_io.run(main, "pending-approvals-note")
