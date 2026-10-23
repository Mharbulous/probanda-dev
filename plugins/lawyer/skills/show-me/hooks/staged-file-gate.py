#!/usr/bin/env python3
"""Refuse a file card that would open only as a download on a cloud-linked host.

Hook event: PreToolUse, matcher SendUserFile. On a cloud session linked to the
PC through remote-devices, `mcp__cowork__present_files` is absent and
`SendUserFile` takes container paths only. A card made from a scratch copy in
the container offers only "Download"; a card made from the path
`device_stage_files` returns (under /mnt/user-data/uploads/) offers "Open in
Word" and "Show in Explorer" (show-me/SKILL.md, "Presenting a file saved on the
PC"). So, only when /mnt/user-data exists, this gate refuses a SendUserFile
whose file is neither under /mnt/user-data/uploads/ nor a .png or .pdf.

PNG and PDF pass anywhere, because show-me's highlight extracts are review
evidence that lives in the container and never belongs on the PC. Staged HTML
pages sit under uploads/, so html-pages-gate's staging allowlist is untouched.
The Code tab and local Cowork have no /mnt/user-data and are never refused.
Exempt when COCLERK_SENDFILE_ANY=1 is in the environment (for developing in a cloud
session). The refusal does not name it, nor any skill section: a refusal is quoted
to the practitioner verbatim (shared/internals-confidentiality.md).

Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0
silently. Fails OPEN on its own error, loudly on stderr, as html-pages-gate does.
"""
import json
import os
import posixpath
import sys

CONTAINER_ROOT = "/mnt/user-data"
STAGED = "/mnt/user-data/uploads/"
CONTAINER_KINDS = (".png", ".pdf")


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def refused(path):
    if path.lower().endswith(CONTAINER_KINDS):
        return False
    return not posixpath.normpath(path.replace("\\", "/")).startswith(STAGED)


def message(path):
    return (
        f'Refused: "{path}" is not a staged copy of the file saved on the PC. '
        "On this cloud-linked host a card made from a container copy, a conversion or a Windows path "
        "offers only Download. Stage the file saved on the PC with device_stage_files(paths: [<PC path>]) "
        "and call SendUserFile on the stagedPath it returns (/mnt/user-data/uploads/...): that card offers "
        "Open in Word and Show in Explorer. A highlighted page extract (.pdf or .png) is sent as it is."
    )


def deny(reason):
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}) + "\n")


def main():
    if os.environ.get("COCLERK_SENDFILE_ANY") == "1" or not os.path.isdir(CONTAINER_ROOT):
        return 0
    payload = json.load(sys.stdin)
    tool_input = payload.get("tool_input") or {}
    for path in strings(tool_input.get("files")):
        if refused(path):
            deny(message(path))
            break
    return 0


if __name__ == "__main__":
    try:
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # fail OPEN, loudly
        sys.stderr.write("staged-file-gate hook error (allowing call): " + type(exc).__name__ + ": " + str(exc) + "\n")
        sys.exit(0)
