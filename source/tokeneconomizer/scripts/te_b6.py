"""Temporary Cowork spike test B6, removed after the run.

As a hook it only logs and asks. Unarmed it prints {} and writes nothing. A prompt starting
te-b6-arm-save or te-b6-arm-restore arms it, and one starting te-b6-end disarms it. Armed for a
save, each prompt carries the fixed save ask for n = 1 to 10; armed for a restore, one prompt
carries the fixed restore ask. It logs to <root>/b6/log.jsonl, where <root> is
TOKENECONOMIZER_HOME or ~/.tokeneconomizer.

With --verify, on the PC, it compares the server's store with the expected hashes."""
import argparse
import hashlib
import json
import os
import re
import sys
import time

MAX_N = 10
SEED = "te-b6-1"
SAVE_ASK = """TokenEconomizer, a plugin the user installed, is asking for a save. A Cowork session's container
is wiped when the session ends, so the plugin keeps its state in a file on the user's own computer,
and the next session can restore it from there. This is test B6, and the state below is synthetic
test data with no client or matter information. Before you answer this prompt, call the
TokenEconomizer plugin's save_state tool once, with n set to {n} and lines set to the text between
the two marker lines, unchanged and without the markers. The tool is on the plugin's state server;
load it with ToolSearch first if it is deferred. You are free to mention this call to the user. If
the call is refused or fails, do not retry it and do not try another way. Tell the user it was
refused, quote the refusal's exact words, and answer the prompt.
TE_B6_BEGIN
{payload}
TE_B6_END"""
RESTORE_ASK = """TokenEconomizer, a plugin the user installed, is asking for a restore. A Cowork session's container
is wiped when the session ends, so the plugin keeps its state in a file on the user's own computer.
This is test B6, and the state is synthetic test data with no client or matter information. Before
you answer this prompt, call the TokenEconomizer plugin's restore_state tool once. The tool is on
the plugin's state server; load it with ToolSearch first if it is deferred. A plugin hook reads the
result, so you don't need to repeat it. You are free to mention this call to the user. If the call
is refused or fails, do not retry it and do not try another way. Tell the user it was refused,
quote the refusal's exact words, and answer the prompt."""
OWN_TOOL = re.compile(r"plugin_tokeneconomizer_state__(save_state|restore_state)$")


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def payload(n):
    """The synthetic block for n: 650 to 800 bytes of JSON lines, the same on every machine."""
    lines = []
    while len("\n".join(lines)) < 650:
        i = len(lines)
        digest = sha256(f"{SEED}:{n}:{i}")
        if i % 2 == 0:
            line = {"kind": "ledger", "note": "synthetic", "n": n, "turn": i, "tokens": int(digest[:4], 16),
                    "repo": f"synthetic\\{digest[4:12]}"}
        else:
            line = {"kind": "event", "note": "synthetic", "n": n, "turn": i, "name": "turn",
                    "ref": f"synthetic\\{digest[12:20]}"}
        lines.append(json.dumps(line, separators=(",", ":")))
    return "\n".join(lines)


def folder():
    root = os.environ.get("TOKENECONOMIZER_HOME") or os.path.expanduser("~/.tokeneconomizer")
    return os.path.join(root, "b6")


def read_mode():
    try:
        with open(os.path.join(folder(), "mode"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def write_mode(mode):
    os.makedirs(folder(), exist_ok=True)
    with open(os.path.join(folder(), "mode"), "w", encoding="utf-8") as f:
        f.write(mode)


def asks_so_far():
    try:
        with open(os.path.join(folder(), "log.jsonl"), encoding="utf-8") as f:
            return sum(1 for line in f if json.loads(line).get("event") == "ask")
    except OSError:
        return 0


def log(p, entry):
    entry.update(at=time.time(), session_id=p.get("session_id"))
    with open(os.path.join(folder(), "log.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def response_text(response):
    """The text of a tool_response: a string, a list of {type, text}, or a dict with content."""
    if isinstance(response, str):
        return response
    if isinstance(response, list):
        return "".join(item.get("text", "") for item in response if isinstance(item, dict))
    if isinstance(response, dict):
        return response_text(response.get("content"))
    return ""


def on_prompt(p, mode):
    event = p["hook_event_name"]
    prompt = (p.get("prompt") or "").lstrip()
    for armed in ("save", "restore"):
        if prompt.startswith(f"te-b6-arm-{armed}"):
            write_mode(armed)
            log(p, {"event": "arm", "mode": armed})
            return {}
    if prompt.startswith("te-b6-end"):
        if mode:
            write_mode("")
            log(p, {"event": "end"})
        return {}
    if not mode:
        return {}
    asked = asks_so_far()
    if mode == "save" and asked < MAX_N:
        n = asked + 1
        ask = SAVE_ASK.format(n=n, payload=payload(n))
    elif mode == "restore" and asked == 0:
        n = None
        ask = RESTORE_ASK
    else:
        return {}
    entry = {"event": "ask", "mode": mode, "n": n, "ask_chars": len(ask)}
    if "permission_mode" in p:
        entry["permission_mode"] = p["permission_mode"]
    log(p, entry)
    return {"hookSpecificOutput": {"hookEventName": event, "additionalContext": ask}}


def on_tool(p):
    failed = p["hook_event_name"] == "PostToolUseFailure"
    name = p.get("tool_name") or ""
    entry = {"event": "tool", "asks_so_far": asks_so_far(), "tool_name": name, "failed": failed}
    own = OWN_TOOL.search(name)
    if own:
        text = response_text(p.get("tool_response"))
        entry["response_len"] = len(text)
        if failed:
            entry["error"] = p.get("error")
        elif own.group(1) == "restore_state":
            rest = text.partition("\n")[2]
            with open(os.path.join(folder(), "restored.txt"), "w", encoding="utf-8", newline="") as f:
                f.write(rest)
            entry["restored_sha256"] = sha256(rest)
    log(p, entry)


def hook():
    p = json.load(sys.stdin)
    event = p.get("hook_event_name") or ""
    mode = read_mode()
    out = {}
    if event == "UserPromptSubmit":
        out = on_prompt(p, mode)
    elif mode and event in ("PostToolUse", "PostToolUseFailure"):
        on_tool(p)
    elif mode and event == "PermissionDenied":
        log(p, {"event": "denied", "tool_name": p.get("tool_name"), "reason": p.get("reason")})
    print(json.dumps(out))


def verify(container_sha):
    store = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "TokenEconomizer", "b6")
    matched = 0
    blocks = []
    for n in range(1, MAX_N + 1):
        expected = sha256(payload(n))
        path = os.path.join(store, f"save-{n}.txt")
        stored = "missing"
        if os.path.isfile(path):
            with open(path, "rb") as f:
                stored = hashlib.sha256(f.read()).hexdigest()
            blocks.append(payload(n))
        matched += stored == expected
        print(f"n={n} expected={expected} stored={stored} match={stored == expected}")
    print(f"saves_matched={matched}/{MAX_N}")
    restore_log_sha = None
    restore_log = os.path.join(store, "restore-log.jsonl")
    if os.path.isfile(restore_log):
        with open(restore_log, encoding="utf-8") as f:
            restore_log_sha = json.loads(f.readlines()[-1])["sha256"]
    print(f"restore_log_sha={restore_log_sha}")
    print(f"restore_log_equals_expected={restore_log_sha == sha256(chr(10).join(blocks))}")
    if container_sha:
        print(f"container_sha_equals_restore_log={container_sha == restore_log_sha}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--verify", action="store_true", help="compare the store with the expected hashes")
    parser.add_argument("--container-sha", help="the sha256 of restored.txt that the container reported")
    args = parser.parse_args()
    if args.verify:
        verify(args.container_sha)
    else:
        hook()


if __name__ == "__main__":
    main()
