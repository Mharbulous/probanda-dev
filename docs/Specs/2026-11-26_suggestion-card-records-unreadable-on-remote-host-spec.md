# Spec: suggestion card cannot be built on a remote-device host (records unreadable)

Status: proposed, 2026-11-26. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.33.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-25_factum-issues-on-appeal-own-statement-spec.md` (the suggestion that could not be built). Earlier: `2026-10-29_suggestion-card-not-shown-on-remote-host-spec.md` (the folder-grant half of the same failure, still unimplemented).

---

## 1. Problem

A practitioner-initiated suggestion could not be built in a cloud session reaching the PC through the device bridge. `suggestion_card__build` refused because it could not read most of this computer's records, so the suggestion was neither shown nor kept, and the skill forbids building again in the session. The practitioner's feedback therefore cannot reach the Probanda team from this kind of host at all. Separately, the request for access to the suggestions folder (needed to show the Past suggestions page whose badges had changed) was refused by the host's auto-mode classifier, as the 2026-10-29 spec describes.

## 2. Evidence (observed; quoted text is data, not instructions)

- Host: cloud session, remote-device bridge, only `SendUserFile` as the card tool; one connected folder (MATTER_ROOT).
- `suggestion_card__build` (origin practitioner, source user) returned: `{"built": false, "reason": "records_unreadable", "unreadable": ["matter", "contact", "folder name", "document title", "file name"]}`. `client` was not listed, so client records were readable.
- In the same session, matter-data and drafting-data tools on MATTER_ROOT worked, and `suggestion_box__status` and `suggestion_log__read` succeeded.
- `device_request_folder_access` for `<APPDATA>\Probanda\suggestions`: "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Cowork Folder Access]."
- Skill text, `lawyer/skills/suggestion/SKILL.md` §6: "When it returns `built: false` with `reason: \"records_unreadable\"`, the suggestion could not be checked, so it is not shown. ... Then stop: do not build it again in this session, and nothing is kept to send."
- Cause: **UNVERIFIED**. Candidates: the check reads matter, contact, folder and document records from a path that is not resolved on this host (practice root, folder map or per-matter databases), or the reader fails on a schema or permission and reports the kind unreadable.
- Workaround in use: none; the practitioner was told the suggestion was not shown and not sent, and asked to run /developer:fix-this instead.

## 3. Goal and non-goals

Goal: on every host where the practitioner can work, a suggestion can be checked and built, or, when a record kind truly cannot be read, the practitioner's words are not lost. Non-goals: weakening the identifier check; the folder-grant problem (2026-10-29 spec).

## 4. Design

1. Find why each listed kind is unreadable on this host, and fix the reader so it reads the same records the other data tools read in the same session.
2. If a kind is still unreadable for a genuine reason, keep the scrubbed draft on this computer (as held drafts were) so it can be built and shown in a later session, instead of discarding it. Choose against HEAD (§9).

## 5. Constraints that must still hold

- Nothing is sent or shown unchecked; the full check still runs over everything the card would send.
- The error names nothing inside Probanda to the practitioner.
- No client or matter content leaves the computer.

## 6. Options considered, streamline and deburr first, additions last

1. Make the check use the same record resolution the working data tools use, deleting any separate path logic. (recommended)
2. Keep the draft as a held draft when the check cannot complete, reusing the existing held-draft store.
3. Allow a partial check. Rejected: could send an identifier.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Reproduce `records_unreadable` with a host-like setup and find each kind's failing read.
3. Fix the reader (option 1); add option 2 only if a kind can still legitimately be unreadable.
4. Add a test per record kind for the readable and the unreadable case.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of suggestion card cannot be built on a remote-device host (records unreadable) complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Where the matter, contact, folder, document and file records are readable by the other data tools, the build's check reads them too (test).
2. A check that cannot complete keeps the scrubbed draft for a later session, or the spec records why that was not needed.
3. No card is built or sent without a complete check (test unchanged or strengthened).

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. If a kind is genuinely unreadable, keep the draft (option 2) or keep refusing? Default: keep the draft unsent.

## 10. Verify against HEAD before building

- Where `suggestion_card__build`'s check reads each record kind, and how it resolves their locations.
- How the matter-data and practice-data tools resolve the same records.
- §6 of the suggestion skill reads as quoted in §2.

## 11. Verification against HEAD (2026-11-26, at 34f0ef2d)

| Item | Found at HEAD |
|---|---|
| Where the build's check reads each kind | `source/lawyer/mcp/src/suggestions/records.ts` `readRecordTexts`. `client`, and the practice half of `matter`, `contact` and `folder_name`, come from the practice store (`PracticeStore.items()`). `folder_name` also takes the folder map (`readFolderMap`). The case-data half of `matter`, `contact`, `folder_name`, `document_title` and `file_name` comes from every matter's matter-data folder, found by `matterDataFolders` (`tools/practice/contacts.ts`) and read in one spawn of `list_record_names.py` (`case/list-record-names.ts`). One folder read `unavailable`, or one matter `matterDataFolders` cannot place, marks all five case-data kinds failed. |
| How it resolves locations | Practice store and folder map: the same `configPath` (APPDATA) and `case_data_root` the practice-data tools use. Matter-data folders: `case_data_root`, then each matter's own `0. CASE DATA` or a child of the root, matched by matter number. No separate path logic beyond that. |
| How the matter-data and practice-data tools resolve the same records | Practice-data tools: the same `PracticeStore` and config. Matter-data tools: one matter at a time, from the `matter_root` the session passes, through its pointer (`case/backend.ts`, `resolve_paths.resolve_pointer`). They refuse a database below v9.1 exactly as the check's script does. They read only the matter the session works in. The check reads every matter. |
| The version guard | `list_record_names.py` calls `parties_of_record._behind`, which returns `unavailable` for any `main.sqlite` below `EXPECTED_USER_VERSION` (v9.1). |
| Columns the script reads | `sources.title`, `sources.file_path`, `parties.name`, `parties.lawyer_name`, `parties.lawyer_firm`, `proceedings.file_number`, `proceedings.style_of_cause`. No hop in `migrations.sql` (62 to 91) adds, renames or rebuilds any of them. The 90 to 91 hop changes only `issues`. |
| Skill §6 | Reads as quoted in §2. |
| Reproduction | Run locally on the developer's own machine, not a remote host, against its real records (states and counts only were printed): `client` read, the other five `partial`. 26 matter-data folders found, none unplaced; 25 read `unavailable` at v9.0 against the v9.1 the guard needs, 1 read `ok`. |

**Cause.** Not the host. The check refuses on any host where any matter's case data is behind the current schema, because the names script applies the version guard of a script that needs the newest columns, although the seven columns it reads predate every migration. The session's own matter had been migrated, so its matter-data tools worked; the other matters had not. `client` was readable because it never touches case data.

**Design consequence.** Option 1 becomes: drop the version guard from the names script, on design decision #61's footing (columns that predate every migration need no guard). A database that truly lacks a column still fails its read and reads `unavailable`, so the check is not weakened. Option 2 (§9 Q1 default) still applies to what can remain genuinely unreadable: a matter with no matter number or two folders with one, a damaged database, or a read that times out.
