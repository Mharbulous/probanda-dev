"""Temporary Cowork red-test probe (R8 to R12), removed after the probe run.

Appends one line per hook call to <state root>/probe.jsonl: the event, the tool's name and
input keys, whether a tool response arrived and its length, and the names (never the values)
of the credential variables the hook sees. After a config_status call it answers with an
additionalContext line and a systemMessage, each with its own code, to test whether either
reaches the model."""
import json
import os
import sys
import time

CTX_CODE = "TE-R9-CTX-7Q4M"
MSG_CODE = "TE-R9-MSG-K2P8"


def main():
    p = json.load(sys.stdin)
    event = p.get("hook_event_name") or ""
    name = p.get("tool_name") or ""
    resp = p.get("tool_response")
    root = os.environ.get("TOKENECONOMIZER_HOME") or os.path.expanduser("~/.tokeneconomizer")
    os.makedirs(root, exist_ok=True)
    line = {"at": time.time(), "event": event, "session_id": p.get("session_id"),
            "tool_name": name, "tool_input_keys": sorted((p.get("tool_input") or {}).keys()),
            "has_tool_response": resp is not None,
            "response_len": len(json.dumps(resp)) if resp is not None else 0,
            "reason": p.get("reason"), "plugin_root": os.environ.get("CLAUDE_PLUGIN_ROOT"),
            "credential_vars": sorted(k for k in os.environ
                                      if k.startswith("ANTHROPIC_") or "TOKEN" in k
                                      or "OAUTH" in k)}
    with open(os.path.join(root, "probe.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(line) + "\n")
    out = {}
    if event == "PostToolUse" and name.endswith("config_status"):
        out = {"hookSpecificOutput": {"hookEventName": event,
                                      "additionalContext": f"{CTX_CODE}: probe context line."},
               "systemMessage": f"{MSG_CODE}: probe notice."}
    print(json.dumps(out))


main()
