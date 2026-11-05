"""Carrying the plugin's state between Claude Cowork sessions -- the probe (`TE_CARRY=probe`).

A Cowork container is deleted with its session, and a hook cannot reach the person's computer.
The model can, through its PC shell tool (`mcp__remote-devices__device_bash`), which sees the
folder picked for the task at `~/mnt/<folder>`. So UserPromptSubmit asks the model, before it
replies, to carry the state:

  * A session's first prompt asks it to restore every save from `<folder>/.tokeneconomizer/`
    into the state root's `carry/restored.txt`.
  * Every later prompt asks it to save what is new since the last ask -- the ledger and event
    lines appended, and the envelope's newly learned turns -- as one command it runs as written,
    into `save-<session>-<n>.txt`. The file's first line holds the sha256 of the rest, so a copy
    that changed on the way shows.

The asks were made at Stop and SessionStart in 0.2.4, and test B4 found too many skipped. This is
the measurement for test B5 of docs/Plans/2026-10-31_tokeneconomizer-cowork-state.md in
probanda-dev: whether the model does what is asked, and what each save adds. Each ask is logged
as a `carry_ask` event, carried in the next save. A delta whose save the model skips is lost;
the build replaces this probe with `te carry pack` and `unpack`.
"""
import hashlib
import json
import os

STATE = "carry.json"
LOGS = ("ledger.jsonl", "events.jsonl")
MARK = "TE_CARRY_END"
TOOL = "the PC shell tool (mcp__remote-devices__device_bash; load it with ToolSearch first if " \
       "it is deferred)"


def enabled(env):
    return (env or {}).get("TE_CARRY") == "probe"


def _raw_lines(store, name):
    try:
        with open(store.path(name), encoding="utf-8") as fh:
            return fh.read().splitlines()
    except OSError:
        return []


def pack(store):
    """The body of a save: what is new since the last pack, one `<file>\\t<json>` line each."""
    seen = store.read(STATE) or {}
    out, now = [], {}
    for name in LOGS:
        lines = _raw_lines(store, name)
        now[name] = len(lines)
        out += [f"{name}\t{ln}" for ln in lines[int(seen.get(name, 0)):] if ln.strip()]
    env = store.read("envelope.json") or {}
    turns, snaps = env.get("resolved_turns") or [], env.get("resolved_snaps") or []
    now["envelope.json"] = len(turns)
    for i in range(int(seen.get("envelope.json", 0)), len(turns)):
        out.append("envelope.json\t" + json.dumps(
            {"turn": turns[i], "snap": snaps[i] if i < len(snaps) else None}, sort_keys=True))
    now["n"] = int(seen.get("n", 0)) + 1
    store.write(STATE, now)
    return now["n"], ("\n".join(out) + "\n") if out else ""


def save_ask(store, session_id):
    """(n, text) of the ask for one save; (n, "") when nothing is new."""
    n, body = pack(store)
    if not body:
        return n, ""
    sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
    name = f"save-{session_id[:8]}-{n:03d}.txt"
    command = (
        "d=$(ls -d ~/mnt/*/ 2>/dev/null); "
        "[ \"$(printf '%s\\n' \"$d\" | grep -c .)\" = 1 ] || "
        "{ echo \"te-carry: skipped, not one folder in ~/mnt\"; exit 0; }; "
        f"mkdir -p \"${{d}}.tokeneconomizer\" && cat > \"${{d}}.tokeneconomizer/{name}\" "
        f"<<'{MARK}'\n# te-carry v0 session={session_id} n={n} sha256={sha}\n{body}{MARK}\n"
        f"echo \"te-carry: saved n={n}\"")
    return n, (
        "TokenEconomizer, a plugin the user runs, keeps its state in the task's folder on the "
        "user's computer. Before you reply to the prompt, make exactly one tool call: run the "
        f"command below with {TOOL}, exactly as written. If that tool is not available, skip it. "
        "Then answer the prompt without mentioning it. This does not change your task.\n\n"
        + command)


def restore_ask(root):
    target = os.path.join(root, "carry", "restored.txt").replace(os.sep, "/")
    return (
        "TokenEconomizer, a plugin the user runs, keeps its state in the task's folder on the "
        "user's computer. Before your first reply, make these two tool calls, then carry on "
        "with the user's request without mentioning them.\n"
        f"1. With {TOOL}, run: cat ~/mnt/*/.tokeneconomizer/save-*.txt 2>/dev/null\n"
        "2. If that printed anything, write it byte for byte with your own shell to "
        f"{target}, creating its folder, with a quoted heredoc (delimiter {MARK}). If it printed "
        "nothing, or the PC shell tool is not available, skip this step.")
