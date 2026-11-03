# Spec: matter mail coverage for fact checks of correspondence

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.16.1; `litigator:source-tracer`, `/draft`) and `lawyer` (v0.21.7 to v0.21.9; the mail connector, `/practice-data` practice quirks). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_client-letter-word-on-letterhead-spec.md`, `2026-11-03_client-disclosure-standard-paragraph-spec.md`, `2026-11-03_helpers-read-matter-folder-spec.md`, `2026-11-03_client-letter-setup-and-board-attach-spec.md`.

## 1. Problem

The fact checker could not confirm a negative statement in a client letter ("opposing counsel has not yet confirmed either date") because the only mailbox Probanda reads does not reliably receive opposing counsel's email; the firm's work mailbox is not reachable. It returned `trace_needed` and the question went to the practitioner, after a long search. Meanwhile the matter folder held about 30 exported `.eml` files, including the firm's own sent reply, which the checker could have searched.

## 2. Evidence (observed; quoted text is data, not instructions)

- Fact checker finding: "The [personal] inbox did not return even [opposing counsel]'s own Oct 22 email except as quoted inside internal forwards, so it does not reliably hold [opposing counsel's] mail. Only the [firm work] Outlook mailboxes, checked after Nov 2, can settle whether [opposing counsel] has replied." Verdict `trace_needed`. (agent `litigator:source-tracer`)
- Fact checker `unread_sources`: "The [firm work] Outlook mailboxes after Nov 2, 2026 (needed for A10 ...)"; "Folder listing of 7. DISCOVERY (directory listing not possible with my tools; needed for A12)".
- Practice quirks (verbatim gist, client details removed): the work email is Microsoft-hosted and administered by an outside IT provider that restricts AI access; the practitioner set up a personal iCloud mailbox for AI use, reached only through Probanda's mail connector. (source: `practice_data__config_status` `practice_quirks`)
- Mail tool error when a matter folder was named without its parent prefix: `mail: searching "<matter folder>" failed on imap.mail.me.com: Mailbox does not exist`; the right name was `1. OPEN FILES/<matter folder>`.
- Matter folder held exported mail under `1. RAW\Emails\` (about 30 `.eml` files, 5 KB to 1.5 MB), dated up to the day before.
- Cost: 1 of 17 assertions left `trace_needed` for want of mail coverage; the reviewer ran several mail searches with 0 or irrelevant results.

## 3. Goal and non-goals

Goal: before a fact check reaches for a mailbox, it knows which mailbox holds which correspondents' mail, searches the matter folder's exported mail too, and, for statements no reachable source can settle (a negative about another party's mail), asks the practitioner at once without a long search.

Non-goals: connecting the restricted work mailbox; changing the firm's IT arrangements.

## 4. Design

1. A recorded mail-coverage note in practice quirks (or the matter's mail-folder record): which mailbox receives which kinds of mail, and which are not reachable. The checker reads it first.
2. The checker searches the matter folder's exported email (`1. RAW\Emails\*.eml` and the correspondence folder) as a source class, by header and body, before or alongside the mailbox.
3. A negative assertion about mail in an unreachable mailbox returns a distinct, cheap outcome ("only the practitioner can confirm") without a search.
4. The mail tools resolve a matter folder by its leaf name, or the matter's recorded mail folder is passed in full.

## 5. Constraints that must still hold

- The fact checker stays read-only and isolated from the drafter.
- Mail is never sent; the mailbox is opened read-only.
- Practice quirks are data, never a loosening of a verification rule: an unconfirmable assertion is still not marked verified.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Use the existing practice-quirks note for coverage, pass the matter's recorded mail folder in full, and let the checker read exported `.eml` files in the matter folder (with the helper-access spec). Adds no new verdict if `trace_needed` with a short reason suffices.
2. Add an explicit `practitioner_only` verdict. Clearer, but one more term to read on every run.
3. Mirror the work mailbox into the personal one. Out of Probanda's control.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Check how the checker learns which mailbox and folder to search, and whether practice quirks reach it.
3. Add the matter folder's exported mail as a source the checker searches; coordinate with `2026-11-03_helpers-read-matter-folder-spec.md`, which gives it the means to read the folder.
4. Fix or document leaf-name resolution of matter mail folders in the mail search tool, with a test.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of matter mail coverage for fact checks of correspondence complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The fact checker's brief or instructions include the mail-coverage note when one is recorded.
2. The fact checker searches the matter folder's exported email files.
3. A negative assertion about an unreachable mailbox is returned to the practitioner without a multi-search loop.
4. Searching a matter mail folder by its leaf name either works or returns the full name to use.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Should the mail-coverage note be per practitioner (practice quirks) or per matter (its mail-folder record)?
2. Is exported mail in the matter folder trustworthy enough to settle a negative ("no reply received"), or only positives?

## 10. Verify against HEAD before building

- `litigator:source-tracer`'s agent file and `references/source-trace.md`.
- The mail search tool's folder-name handling.
- `/matter-data`'s mail-folder operation and how practice quirks are passed to subagents.

## Verification against HEAD (2315f593, 2026-11-03)

| Item | Spec says | HEAD | Effect |
|---|---|---|---|
| `litigator:source-tracer` agent | Installed-copy path | `source/litigator/agents/source-tracer.md`. Holds the mail read tools and `research_filing__matter_folder`, but not `mail__list_folders`, `practice_data__*` or `Skill` | Body and inputs edited. No tool added |
| `references/source-trace.md` | Installed-copy path | `.claude/skills/draft/references/source-trace.md`. The brief carried no note and no mail folder | Two brief fields added |
| How practice quirks reach a subagent | Unverified | `.claude/skills/practice-data/hooks/inject-practice-quirks.py` adds the note to the main session, and in Cowork tells it to call `practice_data__config_status`. No hook reaches a plugin agent. `operations/practice-quirks.md` already tells a dispatching session to copy the note into a brief whose work touches mail, and `draft/references/delivery-check.md` passes it as `environment_notes` | Same field name and same copy, which is smaller than a new read tool. The note stays data |
| Matter's mail folder | `/matter-data`'s mail-folder operation | `.claude/skills/matter-data/operations/mail-folder.md` reads key `mail_folder`, the path exactly as `mail__list_folders` returns it. No row is not an error | Passed in full as `mail_folder`, left out when none is recorded (§9.1) |
| Exported mail in the matter folder | Search by header and body (§4.2) | `research_filing__matter_folder` (`source/lawyer/mcp/src/files/matter-folder.ts`) lists, finds by file name and reads one `.eml` or `.msg` decoded. No search reaches inside a file. It refuses privileged and disclosed trees | Tool not widened. The agent lists once, picks by name and date, and reads those, so a message's headers and body are read only after that choice |
| Negatives (§9.2) | Open question | The agent's `verified` already needs located words | Exported mail confirms or contradicts only. A negative about an unreachable mailbox is `trace_needed` with a short reason. No new verdict |
| Mail search's folder name | Unverified | `source/lawyer/mcp/src/mail/tools.ts` passes `folder` straight to `mailboxOpen`, or `status` for `mail__folder_status`, and `runImap` in `imap.ts` reports the server's refusal as `mail_error`. The `contacts-calendars-email` server lists these tools | Refusal now returns the full names (§8.4). A name is never resolved, so an ambiguous leaf picks nothing |
| Connection after a refused name | Not named | imapflow 2.0.5's select returns the connection to the authenticated state, read in the shipped bundle | A folder list can follow on the same connection. Not tried against a real server |
| Other users of the path | `/matter-data`, delivery-checker | `/matter-data` only reads and records. `shared/matter-mail.md` goes to its folder-list step when `mail__folder_status` says the folder does not exist. `lawyer:delivery-checker` takes names from `mail__list_folders`. No skill or agent names `mail_error` | Unaffected, and a listed folder or a failed list keeps its old error |
