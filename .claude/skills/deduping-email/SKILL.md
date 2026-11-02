---
name: deduping-email
description: Remove duplicate emails from one or more mail folders, or a whole mailbox, by moving them to Deleted Items / Trash, never deleting permanently. Byte-identical copies are found mechanically; copies sharing a Message-ID but differing in content are judged by a subagent and moved only after the user approves. Works with any provider through a per-setup script (iCloud IMAP ships). Use for "dedupe my inbox", "remove duplicate emails from my Archive folder", "clean up duplicate messages".
---

**Internals stay confidential** (`shared/internals-confidentiality.md`). Show the user counts, folders, dates and reasons in plain words, never script names, file paths of this skill, or JSON.

# Deduping email

Delete means move to the mailbox's trash folder. Never expunge, never delete permanently, never empty the trash. Every move waits for the user's yes.

1. **Folders.** Take the folder names exactly as the user's mail program shows them, or "the whole mailbox" (`--all`). Ask whether folders are deduplicated separately (the default) or as one set (`--across-folders`, keeps the copy in the first folder named).
2. **Setup.** Work out the setup id: `references/setup.md` §1.
3. **Script.** Find it: `references/setup.md` §2. None: dispatch the `file-manager:mail-script-writer` agent with the setup id, the server and sign-in facts you have, and the user's environment notes if any; it writes, tests and saves the script and returns its path. It never sees credentials. If credentials are not stored yet, give the user `references/setup.md` §3 and wait.
4. **Tier 1 dry run.** Run the script with the folders and no mode flag, on the user's computer (`references/setup.md` §4). Show per folder: messages scanned, identical copies found, copies to move. Moves nothing.
5. **Tier 1 apply.** On the user's yes, rerun with `--apply`. Report what moved. On `status: error`, stop and show exactly what was already moved and why it stopped.
6. **Tier 2.** If the report's `tier2.groups` is 0, go to step 9. Otherwise dispatch the `file-manager:email-dedupe-judge` agent with the comparison file's path and a verdicts path beside it (`tier2-verdicts.json`). Never read the comparison file into this session.
7. **Verdicts.** Show each group: the email's date and sender, the copies, the decision and its reason. Ask which groups to approve (all, none, or a list).
8. **Tier 2 moves.** On approval, run `python references/scripts/dedupe_core.py moves-from-verdicts --comparison <cmp> --verdicts <v> --groups <approved ids> --out <moves.json>`, then the setup script with `--move-uids <moves.json>`. It moves exactly those copies and refuses any that changed since the scan.
9. **Outcome.** Report per folder: copies moved to the trash in each tier, groups kept whole and why, and that everything moved can be restored from the trash folder.

Script modes, inputs, output and errors: `references/script-contract.md`. Judging rule: `references/judging.md`.
