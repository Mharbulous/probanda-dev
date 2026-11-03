# Spec: `/deduping-email` skill in the Probanda lawyer plugin

Build a new skill, `deduping-email`, in the **lawyer plugin of the probanda-dev repo**. Before writing anything, read the repo's CLAUDE.md and the lawyer plugin's conventions for skills, agents, MCP tools, tests and versioning, and follow them. Where this spec conflicts with a repo convention, ask me rather than guess.

## What it does

Removes duplicate emails from one or more mail folders, or from a whole mailbox, in the practitioner's own mailbox. It reaches the mailbox through the lawyer plugin's existing mail connection: the same server and stored credential the `mail__*` tools use, set up by `mail__configure_credential`. It must work for any practitioner's mail setup that connection supports, not only mine. It must not add a second credential path.

Design principle: do as much as possible deterministically in plugin code, which costs zero tokens. Use an LLM only where judgment is genuinely needed. The work runs in two tiers.

## Definitions

- **Delete**: in this spec, a soft-delete (CLAUDE.md, Mail terms): move the message to the mailbox's Deleted Items / Trash folder. Find it by the IMAP `\Trash` special-use flag or the provider's equivalent. Never permanently delete, never empty the trash.
- **Identical**: byte-for-byte the same, meaning the SHA-256 of the full raw RFC 822 message is equal.
- **Duplicative**: the copies share a Message-ID but are not byte-identical. Copies with the same Message-ID can still differ in real content, so content and attachments must be compared before anything is removed.

## Deletion policy (deliberate, narrow exception)

The practitioner's standing rule is that Probanda tools never permanently delete email; they may sort, organize and soft-delete. This skill soft-deletes, and only on these terms:
- Messages only ever go to Trash, which is recoverable. Nothing is permanently deleted.
- Nothing moves without the practitioner's explicit yes to the exact list shown to them, given in the conversation for that batch.
- The move tool accepts only an approved plan that the scan produced. It is not a general move-to-Trash tool. It refuses any UID that is not in the approved plan, and it refuses any message whose identity no longer matches what was approved (the folder's UIDVALIDITY or the message's hash has changed).
- No mail tool gains the ability to permanently delete.

## Tier 1: identical copies (deterministic, zero tokens)

1. Scan each target folder read-only (EXAMINE) and hash the raw bytes of every message.
2. Group the messages by hash.
3. In each group, keep the newest copy (the highest UID in that folder) and propose the older copies for removal.
4. The scan writes a plan file to the plugin's working location and returns only a short summary to the session. The summary covers counts per folder, the number of groups, the number of messages proposed for removal, and a few sample subject/date lines. It never returns message bodies or the full plan.
5. Show the practitioner the summary and ask for a yes.
6. On a yes, the apply tool moves the planned copies to Trash. On any error it stops and reports exactly what was already moved.

## Tier 2: duplicative copies (LLM-assisted)

Tier 2 runs only on messages that survived tier 1.

1. Plugin code groups the survivors by Message-ID. Every group with more than one copy goes into a comparison file. For each copy, the file records:
   - its UID, folder, date and size
   - the headers that differ between the copies
   - a hash of its normalized body, and a unified diff of the decoded text bodies (length-capped)
   - its attachments, each as (filename, size, SHA-256)
2. A new lawyer-plugin agent (read-only, returns strict JSON) reads the comparison file and judges each group:
   - If one copy contains all the information in another (body text and attachments are a superset), the subsumed copy is duplicative and can go.
   - If each copy holds something the other lacks, keep both.
   - The copy kept is the superset, whatever its age.

   The agent returns a verdict and a one-line reason for each group. It never moves anything.
3. The skill shows the practitioner the verdicts, with their reasons, and asks for a yes. Only the copies the practitioner approves are written into a tier 2 plan, and the same apply tool moves exactly those to Trash.

## Inputs

- One or more folder names, or the whole mailbox.
- By default each folder is deduplicated on its own. An across-folders option treats the listed folders as one set and keeps the copy in the first folder listed.
- Folder names can contain spaces, slashes and parentheses (for example `1. OPEN FILES/Example v. Sample L000`). Quote them correctly, and use modified UTF-7 for non-ASCII names.

## Pieces to build

- **Deterministic tools** on the lawyer plugin's mail server:
  - a scan that does tier 1 and builds the tier 2 comparison file
  - an apply that moves the UIDs in an approved plan to Trash, under the guards above
- **Agent**: the tier 2 judge described above.
- **SKILL.md** (short and imperative, with detail in `references/`). Workflow:
  1. Take the folders.
  2. Run the tier 1 scan.
  3. Show the summary.
  4. On a yes, apply.
  5. Run the tier 2 comparison.
  6. Dispatch the judge.
  7. Show the verdicts.
  8. On a yes, apply.
  9. Report the outcome.
- Follow the plugin's rules on keeping internals out of what the practitioner sees. Show them outcomes in plain words.

## Tests

Use the repo's own test framework, with synthetic RFC 822 messages and no network. The tests must cover:
- Tier 1 groups byte-identical copies and keeps the highest UID.
- Same-Message-ID copies with different bytes survive tier 1 and appear in the comparison file, with the differing headers, a body diff and attachment hashes.
- Apply moves only the UIDs in the approved plan, and refuses an unplanned UID, a changed UIDVALIDITY and a changed hash.
- Nothing is permanently deleted, and nothing goes anywhere except Trash.
- Folder names with spaces, slashes and parentheses are quoted correctly.
- The scan's returned summary contains no message bodies.

## Done when

- The skill, tools, agent and tests are in the lawyer plugin, and the plugin's checks and tests pass.
- The plugin version is bumped the probanda-dev way, ready to release and update in Cowork.
- A tier 1 scan on one real folder of mine returns a sensible summary and moves nothing.
