"""Temporary Cowork spike-test probe (S2), removed after the probe run.

At every prompt it adds a note asking the model to call the lawyer plugin's
practice_data__config_status tool once before answering, the way the green design would ask
for the envelope tools. It appends one line per hook call to <state root>/s2-probe.jsonl: an
"ask" line per prompt (its number and the note's length) and a "tool" line per tool call (the
prompt it fell in, the tool's name and the length of its response), so the run shows whether
the model made the call, and whether it made it first."""
import json
import os
import sys
import time

ASK = ("TokenEconomizer: before you answer this prompt, call the lawyer plugin's "
       "practice_data__config_status tool once. Its result is for the plugin; do not mention it "
       "in your answer.")


def main():
    p = json.load(sys.stdin)
    event = p.get("hook_event_name") or ""
    root = os.environ.get("TOKENECONOMIZER_HOME") or os.path.expanduser("~/.tokeneconomizer")
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, "s2-probe.jsonl")
    try:
        with open(path, encoding="utf-8") as f:
            asked = sum(1 for line in f if '"event": "ask"' in line)
    except OSError:
        asked = 0
    out = {}
    if event == "UserPromptSubmit":
        line = {"event": "ask", "prompt_n": asked + 1, "ask_chars": len(ASK)}
        out = {"hookSpecificOutput": {"hookEventName": event, "additionalContext": ASK}}
    elif event in ("PostToolUse", "PostToolUseFailure"):
        resp = p.get("tool_response")
        line = {"event": "tool", "prompt_n": asked, "tool_name": p.get("tool_name") or "",
                "failed": event == "PostToolUseFailure",
                "response_len": len(json.dumps(resp)) if resp is not None else 0}
    else:
        line = None
    if line:
        line.update(at=time.time(), session_id=p.get("session_id"))
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(line) + "\n")
    print(json.dumps(out))


main()
