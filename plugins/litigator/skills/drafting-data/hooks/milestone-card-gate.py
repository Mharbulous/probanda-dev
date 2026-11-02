#!/usr/bin/env python3
"""Make sure the Milestone page a result names is presented as a file card (shared/html-pages.md,
"Present each page by its path").

A page is due when a result shows it was written for the practitioner to see:

- drafting_forms__open_session: its milestone_path, the opened filing's or proceeding's page;
- drafting_forms__render: the practice_board document's path on a filing's render, or milestone_path on
  a proceeding's, when pages_written and board_changed are both true;
- drafting_data__complete_job: its milestone_path, when pages_written and board_changed are true.

bootstrap opens no board, and view pages and the Litigation Strategy are presented only on request,
so none of those is ever due.

Hook events:
- PostToolUse on those three tools: names each due page in additionalContext, to present now.
- Stop: blocks the end of a turn while a due page of that turn has no later card call, that is
  mcp__cowork__present_files or SendUserFile given a path with the page's file name (a staged copy
  keeps it). Never blocks when stop_hook_active is set, so it never blocks twice in a row.

Works only from tool-result JSON and the transcript's tool calls. It never opens a page.
Fails OPEN on its own error, loudly on stderr, so a bug here never traps a session.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
import hook_io  # noqa: E402

OPEN = re.compile(r"mcp__(.+__)?plugin_lawyer_data__drafting_forms__open_session")
RENDER = re.compile(r"mcp__(.+__)?plugin_lawyer_data__drafting_forms__render")
COMPLETE = re.compile(r"mcp__(.+__)?plugin_lawyer_data__drafting_data__complete_job")
CARD = re.compile(r"mcp__(.+__)?present_files|(mcp__(.+__)?)?SendUserFile")


def basename(path):
    return re.split(r"[\\/]", path.rstrip("\\/"))[-1].casefold()


def result_json(response):
    """The tool result as a dict: given as one, as JSON text, or as MCP text content blocks."""
    if isinstance(response, dict) and "content" not in response:
        return response
    if isinstance(response, dict):
        response = response["content"]
    if isinstance(response, list):
        response = "".join(b.get("text", "") for b in response if isinstance(b, dict))
    if not isinstance(response, str):
        return None
    try:
        value = json.loads(response)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def changed(result):
    return result.get("pages_written") is True and result.get("board_changed") is True


def due_pages(tool, response):
    """The Milestone page paths this result requires presented."""
    result = result_json(response)
    if result is None:
        return []
    if OPEN.fullmatch(tool):
        path = result.get("milestone_path")
    elif RENDER.fullmatch(tool):
        board = next((d for d in result.get("documents") or [] if isinstance(d, dict) and d.get("document_type") == "practice_board"), None)
        if board is not None:
            path = board.get("path") if changed(board) else None
        else:
            path = result.get("milestone_path") if changed(result) else None
    elif COMPLETE.fullmatch(tool):
        path = result.get("milestone_path") if changed(result) else None
    else:
        return []
    return [path] if isinstance(path, str) and path else []


def how_to_present(paths):
    return ("Present " + ", ".join(f'"{p}"' for p in paths) + " as a file card now, before ending the turn, "
            "by its path, with the card tool in your tool list, as the shared rules for HTML pages and for "
            "presenting a file say. If the Cowork present_files tool is listed, call it with that path. If only "
            "SendUserFile is listed, stage that page alone with device_stage_files at once when the session context "
            "or an earlier get_device_info shows the matter folder connected, else after the one "
            "device_request_folder_access call for the matter folder, and call SendUserFile on the staged path, "
            "never the PC path. If "
            "device_stage_files is not in your tool list after the folder grant, load it with a select: ToolSearch "
            "first. If neither is listed, "
            "say in one line that the page is in the matter's draft folder. Never read the page.")


def post_tool_use(payload):
    paths = due_pages(payload.get("tool_name") or "", payload.get("tool_response"))
    if paths:
        return hook_io.note("PostToolUse", how_to_present(paths))
    return 0


def turn_blocks(transcript_path):
    """The content blocks of the current turn: everything after the practitioner's last prompt."""
    blocks = []
    with open(transcript_path, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            message = entry.get("message") if isinstance(entry, dict) else None
            if not isinstance(message, dict) or entry.get("type") not in ("user", "assistant"):
                continue
            content = message.get("content")
            if isinstance(content, str):
                content = [{"type": "text", "text": content}]
            if not isinstance(content, list):
                continue
            if entry["type"] == "user" and not entry.get("isMeta") and any(
                    isinstance(b, dict) and b.get("type") == "text" for b in content):
                blocks = []  # a new prompt starts a new turn
                continue
            blocks.extend(b for b in content if isinstance(b, dict))
    return blocks


def unpresented(blocks):
    """Due pages of this turn with no later card call naming their file name."""
    calls = {}
    owed = []
    for block in blocks:
        if block.get("type") == "tool_use":
            calls[block.get("id")] = block.get("name") or ""
            if CARD.fullmatch(block.get("name") or ""):
                named = {basename(s) for s in hook_io.strings(block.get("input"))}
                owed = [p for p in owed if basename(p) not in named]
        elif block.get("type") == "tool_result" and block.get("tool_use_id") in calls:
            owed += due_pages(calls[block["tool_use_id"]], block.get("content"))
    return list(dict.fromkeys(owed))


def stop(payload):
    if payload.get("stop_hook_active"):
        return 0
    path = payload.get("transcript_path")
    if not path:
        return 0
    missing = unpresented(turn_blocks(path))
    if missing:
        sys.stdout.write(json.dumps({"decision": "block", "reason": (
            "A Milestone page written this turn was not presented. " + how_to_present(missing))}) + "\n")
    return 0


def main():
    payload = hook_io.payload()
    event = payload.get("hook_event_name")
    if event == "PostToolUse":
        return post_tool_use(payload)
    if event == "Stop":
        return stop(payload)
    return 0


if __name__ == "__main__":
    hook_io.run(main, "milestone-card-gate")
