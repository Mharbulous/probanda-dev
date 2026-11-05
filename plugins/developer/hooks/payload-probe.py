#!/usr/bin/env python3
"""Report what a PreToolUse hook payload carries, for one diagnostic call only.

Hook event: PreToolUse, matcher mcp__.+skill_source__read$. It acts only on the call
skill_source__read {"path": "payload-probe"}, a file that does not exist, and refuses that call
with a report: the payload's keys, whether transcript_path is present and readable, and where
this hook runs. Every other call passes untouched. It writes nothing and reports no argument,
no environment value and no transcript content. Fails open: a crash lets the call through, and
the server then answers not_found.
Question: docs/Specs/2026-10-28_tokeneconomizer-cowork-adaptation-spec.md, B3, asked of PreToolUse.
"""
import json
import os
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve()
    sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                     HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
    import hook_io
except Exception as exc:
    sys.stderr.write(f"payload-probe cannot load its helper: {exc!r}\n")
    sys.exit(0)

TRIGGER = "payload-probe"


def transcript_facts(path):
    if not path:
        return {"present": False}
    facts = {"present": True, "exists": False}
    try:
        p = Path(path)
        facts["exists"] = p.is_file()
        if facts["exists"]:
            kinds = {}
            with p.open(encoding="utf-8", errors="replace") as f:
                for line in f:
                    try:
                        kind = json.loads(line).get("type") or "?"
                    except ValueError:
                        kind = "unparsed"
                    kinds[kind] = kinds.get(kind, 0) + 1
            facts["bytes"] = p.stat().st_size
            facts["record_types"] = kinds
    except OSError as exc:
        facts["error"] = type(exc).__name__
    return facts


def session_files(session_id):
    """Whether a transcript named for this session exists under the hook's own Claude folder."""
    base = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"
    out = {"projects_folder_exists": base.is_dir()}
    if out["projects_folder_exists"]:
        found = list(base.glob("*/*.jsonl"))
        out["jsonl_files"] = len(found)
        out["named_for_session"] = bool(session_id) and any(f.stem == session_id for f in found)
    return out


def main():
    payload = hook_io.payload()
    if (payload.get("tool_input") or {}).get("path") != TRIGGER:
        return 0
    sid = payload.get("session_id") or ""
    report = {
        "hook_event_name": payload.get("hook_event_name"),
        "tool_name": payload.get("tool_name"),
        "payload_keys": sorted(payload),
        "transcript_path": transcript_facts(payload.get("transcript_path") or ""),
        "session_id_present": bool(sid),
        "agent_id_present": bool(payload.get("agent_id")),
        "permission_mode": payload.get("permission_mode"),
        "hook_runs_on": sys.platform,
        "cwd_in_payload_matches_hook_cwd": payload.get("cwd") == os.getcwd(),
        "claude_env_names": sorted(k for k in os.environ if k.startswith("CLAUDE")),
        "hook_claude_folder": session_files(sid),
    }
    return hook_io.deny("Payload probe report. No call was made. Show this JSON to the practitioner "
                        "verbatim in a fenced code block, and do not retry:\n" + json.dumps(report, indent=1))


if __name__ == "__main__":
    hook_io.run(main, "payload-probe")
