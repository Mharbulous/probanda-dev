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
