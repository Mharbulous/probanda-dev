"""The plumbing every Probanda hook shares: the payload it reads, the decision it writes,
and the wrapper that fails it open or closed.

    payload = hook_io.payload()                  # the stdin JSON
    return hook_io.deny(reason)                  # PreToolUse refusal on stdout, exit 0
    return hook_io.note("SessionStart", text)    # additionalContext on stdout
    return hook_io.refuse(message)               # stderr, exit 2
    hook_io.run(main, "my-hook")                 # fails open, loudly
    hook_io.run(main, "my-gate", closed=failed)  # failed(exc) gives the exit code

A hook finds this module beside it in shared/scripts and imports it after a
sys.path.insert. A fail-closed gate guards that import and exits 2 when it fails,
because a crash exits 1, which lets the call through.
"""
import json
import os
import sys
from pathlib import Path


def payload():
    return json.loads(sys.stdin.buffer.read().decode("utf-8"))


def pre_tool(decision, reason, **extra):
    output = {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": reason,
        **extra,
    }
    sys.stdout.write(json.dumps({"hookSpecificOutput": output}) + "\n")
    return 0


def deny(reason):
    return pre_tool("deny", reason)


def note(event, text):
    sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}) + "\n")
    return 0


def refuse(message):
    sys.stderr.write(message + "\n")
    return 2


def run(main, name, closed=None):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    try:
        code = main()
    except SystemExit:
        raise
    except Exception as exc:
        if closed is None:  # fail OPEN, loudly
            sys.stderr.write(f"{name} hook error (allowing): {type(exc).__name__}: {exc}\n")
            sys.exit(0)
        sys.exit(closed(exc))
    sys.exit(code)


def config_path() -> Path:
    override = os.environ.get("COCLERK_CONFIG_PATH")
    if override:
        return Path(override)
    appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    candidates = [
        Path(appdata) / "Probanda" / "probanda.json",
        Path(appdata) / "Coclerk" / "probanda.json",
        Path(appdata) / "Coclerk" / "coclerk.json",
    ]
    return next((path for path in candidates if path.is_file()), candidates[0])


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
