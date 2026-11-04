# Presenting a file

Shared doctrine for every skill and agent. It is not a skill: it has no `SKILL.md` and is never wrapped. It is the one source for which tool shows a file to the practitioner. A file that says a file is presented, sent or shown as a file card cites this file for the tool.

> To show a file to the practitioner, check the session's tool list first and use the card tool it holds. When `mcp__cowork__present_files` is listed, call it with the file's path: it is the default, even when `SendUserFile` is listed too. When only `SendUserFile` is listed, use it, staging a PC file first with `device_stage_files`. When neither is listed, say in one plain line which folder holds the file. Never call a tool the list does not hold, and never pick `SendUserFile` out of habit.

A file card is a file shown this way. ToolSearch the tool if it is deferred. Where a skill says to stage a file first on a remote-device-only host, that staging is part of the `SendUserFile` route: it applies only when `SendUserFile` is the tool this rule chose. Before the first `device_stage_files` call of a session, check that `get_device_info`'s `connectedFolders` covers the file's folder. When it does not, make one `device_request_folder_access` call before staging, never after a failed stage, for the folder the calling skill names, or else the file's own folder. `device_stage_files` may not load until a folder is connected. After a granted `device_request_folder_access`, or when `connectedFolders` is not empty, and `device_stage_files` is not in the tool list, run one ToolSearch `select:mcp__remote-devices__device_stage_files,mcp__remote-devices__device_list_dir,mcp__remote-devices__device_commit_files`. If it is still absent, run that search once more at the next turn. Only then say in one plain line that the file cannot be shown as a card yet and which folder holds it. Never suggest reconnecting the app or starting a new session as a first response.

## Fallback route: a file saved on the PC

This is the fallback route. It applies only when `mcp__cowork__present_files` is not in the session's tool list (the remote-device-only host). Where that tool is present, call it with the file's path instead. On that host, this applies to every skill that presents a file saved on the PC as a card: a deliverable, a found document, a draft. On a cloud session linked to the PC through `mcp__remote-devices__*`, `mcp__cowork__present_files` is absent and `SendUserFile` takes only container paths. The practitioner needs a card that opens the saved file itself.

**The route.** Before the session's first staging, check the folder grant as above. Stage the file with one `device_stage_files(paths: [<PC path>])` call, then call `SendUserFile` on the `stagedPath` it returns (`/mnt/user-data/uploads/...`). That card's ⌄ menu offers "Open in Word" and "Show in Explorer", and its folder button reveals the file. Staging alone presents nothing.

A PC path is never passed to `SendUserFile`: only the staged path `device_stage_files` returns is.

**Never these.** Each gave the practitioner only a download, never the saved file:

1. `SendUserFile` on a scratch copy in the container: a download card.
2. A PDF conversion of the file, sent with `display: "render"`: a download card.
3. Page PNGs made from that PDF: thumbnails and "Download all".
4. A markdown link `computer:///C:/.../<file>`: an in-app preview with "Download as DOCX".
5. `SendUserFile` given the Windows path: an error that the attachment does not exist.

A highlight extract (`/show-me`, Mechanics step 2) is different. On the fallback route it is review evidence that lives in the container and never belongs on the PC, so `SendUserFile` sends it as it is, on its container path.

The hook `lawyer/skills/show-me/hooks/staged-file-gate.py` is the backstop. When `/mnt/user-data` exists, it refuses a `SendUserFile` file that is neither under `/mnt/user-data/uploads/` nor a `.pdf` or `.png`. It cannot catch techniques 2 to 4, so this section is the rule.

When the card tool's result does not say the file was delivered, say in one plain line what was presented, naming the file and never its path.
