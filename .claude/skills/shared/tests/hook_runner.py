"""One runner for the hook tests: run a hook script in a fresh Python process with a payload on stdin.

A test adds this folder to `sys.path` and imports `run_hook`. The build skips `tests` folders, so this
file ships in no plugin.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def run_hook(path: str | Path, payload=None, env: dict | None = None, timeout: float | None = 30,
             text: bool = False, encoding: str | None = None) -> subprocess.CompletedProcess:
    """Run the hook at `path` and return its `CompletedProcess`.

    `payload` is sent on stdin: a dict or list as JSON, a `str` or `bytes` as it is (so a test can
    send malformed input), and `None` sends nothing. Output is bytes unless `text` is true or an
    `encoding` is given, as with `subprocess.run`; a `str` payload is encoded as UTF-8 in bytes mode.
    `env`, when given, replaces the environment.
    """
    if isinstance(payload, (dict, list)):
        payload = json.dumps(payload)
    as_text = text or encoding is not None
    if isinstance(payload, str) and not as_text:
        payload = payload.encode("utf-8")
    elif isinstance(payload, bytes) and as_text:
        payload = payload.decode(encoding or "utf-8")
    return subprocess.run([sys.executable, str(path)], input=payload, capture_output=True, env=env,
                          timeout=timeout, text=text, encoding=encoding)
