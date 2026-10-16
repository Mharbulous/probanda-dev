# Presenting a file

Shared doctrine for every skill and agent. It is not a skill: it has no `SKILL.md` and is never wrapped. It is the one source for which tool shows a file to the practitioner. A file that says a file is presented, sent or shown as a file card cites this file for the tool.

> To show a file to the practitioner, call `mcp__cowork__present_files` with the file's path. It is the default. Use `SendUserFile` (staging a PC file first with `device_stage_files`) only when `mcp__cowork__present_files` is not in the session's tool list. Check the tool list before choosing; never pick `SendUserFile` out of habit.

A file card is a file shown this way. ToolSearch the tool if it is deferred. Where a skill says to stage a file first on a remote-device-only host, that staging is part of the fallback route: it applies only when `SendUserFile` is the tool this rule chose.
