---
name: precedents
description: "Use when the practitioner says 'make this a precedent', 'update the precedent', 'organize my precedents', or expects a standard form that may not exist ('my standard retainer', 'the form we use'). Creates a reusable Word precedent from their own saved document, saves an edited copy as a new version, and tidies the precedents folder. A precedent is a Word file whose variable fields are in square brackets and highlighted yellow. Not for filling a precedent in for a client, and not for court forms."
---

<!-- lawyer v0.34.2 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Precedents

Rules for every operation:

- **The practitioner's file is the master.** Start from their saved `.docx`, because it holds their layout. Never regenerate a precedent from Probanda's own text. Their file is never changed.
- **Nothing is overwritten or deleted.** Every save is a new file. A superseded precedent stays where it is, or moves to a folder the practitioner names.
- **A precedent copies the practitioner's wording and never rewords it.** A wording change they ask you to make goes to `lawyer:scrivener`, with what to change as its `instruction`. Show them the text it returns for them to type into their Word copy, then run Modify on that copy. Relay a statement of law it returns as an open item. Never write one in.
- **No client detail survives.** Names, facts, amounts and file numbers all become placeholders, and no client name goes in a precedent's file name.

| The practitioner wants | Go to |
|---|---|
| a finished document made into a precedent, or a standard form that may not exist | Create |
| an edited copy saved as the precedent's new version | Modify |
| the folder tidied | Organize |
| a precedent filled in for a client | Say this is not built yet, and stop |

## Settings first

Call `practice_data__folder_map` with no arguments. Its `precedents` holds the folder's full `path` and the `name_pattern`. When `precedents` is absent or the status is `no_map`, say plainly that Probanda does not yet know where they keep their precedents or how they name them, run `/probanda-setup` step 6, and resume. There is no default for anyone.

In a name pattern, `{YYYY-MM-DD}` is the day the precedent is saved, `{vN}` is one above the highest version of that description in the folder, and `{description}` says what the document is, naming no client.

## Create

When they expect a precedent that may not exist, list the folder first. If it is not there, say so, name the closest documents you found, and offer to build one from a saved Word file they choose.

1. Read the saved `.docx`, its headers and footers included. A PDF or `.doc` will not do: ask for the Word file. Ask them to save and close it first, because only saved text is read.
2. Propose under `/show-me`: the file name, and a table of each value with its placeholder (`[CLIENT NAME]`, `[FILE NUMBER]`). A value is the exact text as it appears, once for each different spelling, and the longest form where forms overlap, such as `Pat Doe` and `Doe`. Below the table, flag each judgment call:
   - example text that was generalized from this client
   - fixed wording that may not suit every client
   - each statement of law in the fixed wording, which their approval vets
3. Save on their approval only, by the steps under "Save".

## Modify

1. Take their edited copy, which is the source. Their layout and wording changes come through because the script works on it directly.
2. Find any client values in it, and map each to the placeholder the precedent's current version uses for that field. Placeholders already bracketed and highlighted are left as they are, and a copy with none to map needs no replacements.
3. Propose and flag as in Create step 2, naming the new file. The earlier version stays.
4. Save on their approval only.

## Save

Write the request to a temporary file outside the matter and precedents folders, then run:

```
python scripts/make_precedent.py <request.json>
```

The request is `{"source", "out_dir", "name", "replacements": [{"value", "placeholder"}]}`, with `out_dir` the settings' `path`. It prints one JSON line. On success, send the new file as a file card and report the name it took, since it takes ` (2)` when the name exists. Each refusal writes nothing:

| `error` | Do this |
|---|---|
| `leftover` | Its `detail` lists each value and where it remains. Tell the practitioner. Propose a further replacement for another form of the value, or ask them to clear it in Word and save when it sits in a comment, tracked change or the document's properties. Never drop a value from the request to get past this. |
| `value_not_found` | Re-read the file for the exact text of each value `detail` lists, and correct or remove it with their approval. |
| `not_a_docx`, `no_folder` | Say plainly that the file or folder cannot be reached from here, naming it, and stop. |
| `bad_request`, `write_failed` | Correct the request if you can. Otherwise tell them what `detail` says and stop. |

## Organize

1. List the folder. Compare each file name with the name pattern.
2. Report the files that do not match in groups, one line for each group, so a run of numbered court forms is one line. Flag any file name holding a client's name.
3. Propose the renames or moves. Apply them only after approval, through `/file-apply`. If `/file-apply` is not available in this session, the `file-manager` plugin is not enabled: stop, tell the practitioner that this step renames or moves a file and needs `file-manager`, and do nothing else. Never fall back to a shell `mv` or `rm` or the Write tool.
