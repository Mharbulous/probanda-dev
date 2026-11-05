---
name: precedents
description: "Use when the practitioner says 'make this a precedent', 'update the precedent', 'organize my precedents', or expects a standard form that may not exist ('my standard retainer', 'the form we use'). Creates a reusable Word precedent from their own saved document, saves an edited copy as a new version, and tidies the precedents folder. A precedent is a Word file whose variable fields are in square brackets and highlighted yellow. Not for filling a precedent in for a client, and not for court forms."
---

<!-- lawyer v0.25.3 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

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
