# Dedupe script specification

The one specification every deduping-email setup script meets: the shipped `references/scripts/icloud-imap.py`, and every script the `file-manager:mail-script-writer` agent writes for a setup that has none. A script written from this file alone, plus the core it builds on (§8), must behave the same as every other. The tests in `references/scripts/test_dedupe_core.py` check it for the shipped core.

## 1. Purpose

Remove duplicate emails from one or more folders of one mailbox, or from the whole mailbox, by moving them to the mailbox's trash folder. Do every step that needs no judgment mechanically, at zero tokens. Leave to an LLM only the one judgment that needs it: which copies of one email can go without losing information.

## 2. Scope

**In scope**

- Writing, testing and saving a dedupe script for one mail setup (a provider and an access method), to this specification.
- Scanning folders, finding identical and duplicative copies, reporting them, and moving approved copies to the trash folder.

**Out of scope.** If a task needs any of these, the script and the script writer stop and say so; neither attempts it.

- Setting up email account access: creating an account, making an app-specific password, turning on IMAP, two-factor sign-in, registering an OAuth app, granting API permissions, storing or changing credentials.
- Sending, drafting, filing, labelling or flagging mail; mail rules and filters.
- Restoring from the trash, emptying the trash, deleting anything permanently.
- Any mailbox other than the one the run signs in to.

## 3. Prerequisites

All of these hold before a script runs. The skill checks them first. A missing one stops the run with nothing scanned, and the user is told which is missing.

1. **Mail access already works** on the computer where the script runs: a sign-in for this mailbox exists in one of the places the script reads (§6) and the server accepts it. Setting it up is out of scope (§2).
2. **The mail server is reachable** from that computer. Normally the user's own computer; a sandbox that blocks the mail port is not.
3. **The mailbox has a trash folder**: one the server flags `\Trash`, or the provider's equivalent (Deleted Items, Deleted Messages, Trash).
4. **The server can move a message** between folders in one step (IMAP MOVE, or the provider's own move call).
5. **Python 3** is installed. Standard library only, plus `keyring` when it is installed.

## 4. Constraints

Each is absolute. A script that breaks one does not ship.

1. **Never delete permanently.** "Delete" means move to the trash folder of §3.3, and nothing else. Never EXPUNGE, never CLOSE a folder opened read-write, never flag a message `\Deleted`, never call a permanent-delete API, never empty the trash.
2. **Moves only.** Without a one-step move (§3.4), stop before moving anything. Never copy-then-remove.
3. **Read-only until approved.** Scans open folders read-only (IMAP EXAMINE). The default run is a dry run that moves nothing. Only `--apply` and `--move-uids` open a folder read-write, and only to move.
4. **Duplicative copies move only after approval.** The script never moves a tier 2 copy on its own, only the exact UIDs in a `--move-uids` file the user approved.
5. **Always keep one copy.** No group ever loses every copy.
6. **Verify before moving.** Before each tier 2 move, re-fetch the message and move it only if its folder validity and SHA-256 still match what was judged.
7. **Fail closed.** Any error stops the run at once and reports exactly what was already moved.
8. **Credentials stay out of sight.** Read them only from §6's sources. Never write them to a file, print them, put them on a command line, or pass them through chat.
9. **Mail stays on the computer.** The report and comparison file are written only to the local out dir (§7).

## 5. Definitions

- **Identical:** byte-for-byte the same. The SHA-256 of the full raw RFC 822 message is equal.
- **Duplicative:** the copies share a Message-ID but are not identical. They may still differ in real content, so content and attachments are compared before any copy goes.
- **Critical information:** everything the sender sent, as delivered: body text, quoted chain, embedded images, links (original addresses), attachments (by content), and the sender's headers (From, To, Cc, Subject, Date).
- **Added after delivery:** content a copy gained after it was delivered: mail-program edits, notes, banners, list footers, links rewritten by a mail filter, delivery headers. It is not critical information. Content removed or altered after delivery is: the copy that still has the original is kept.
- **Most complete copy:** the copy that holds every other copy's critical information. It is kept regardless of age.
- **UID:** an integer stable within a folder, increasing with arrival (the IMAP UID, or for an API a stable sequence the script derives and documents). **UIDVALIDITY** changes whenever UIDs would be reused.

## 6. Logic

```
run(folders | --all, mode):
    check prerequisites (§3)                       # stop if any is missing
    trash = folder flagged \Trash, else a known trash name      # stop if none
    if --all: folders = every selectable folder except trash, \Noselect, \NonExistent, \All

    # --- Tier 1: identical copies, mechanical, zero tokens ---
    for each folder (read-only):
        for each message not already marked deleted:
            record uid, size, dates, Message-ID, sha256(raw bytes)
    group messages by sha256                       # per folder; one set with --across-folders
    for each group of 2+:
        keep = highest UID                         # --across-folders: highest UID in the first listed folder holding a copy
        mark the others for removal
    if mode == scan:  report, move nothing
    if mode == apply: for each marked copy: move to trash; record it; on any error stop and report

    # --- Tier 2: duplicative copies, script groups, LLM judges ---
    survivors = messages not marked in tier 1
    group survivors by Message-ID                  # messages without one are counted and left alone
    for each group of 2+:
        write to the comparison file, per copy: folder, UID, UIDVALIDITY, date, size, sha256,
            headers that differ between copies, normalized-body hash,
            unified diff of decoded text bodies (capped), attachments as (filename, size, sha256),
            inline images as (content_id, filename, size, sha256), <img src> references and the
            cid: references with no matching part (missing inline images),
            links from HTML href and plain-text URLs, each with its decoded original
            (Safe Links, Proofpoint URL Defense) and what rewrote it,
            sender headers (from, to, cc, subject, date) and which of them differ,
            and mechanical hints (body equal / contained, attachments, links by original and
            images by sha256 equal / subset, rewritten-link counts, sender headers equal)
    script stops here: it moves no tier 2 copy

    LLM judge (one subagent, reads the comparison file, writes verdicts):
        for each group, apply the rule (references/judging.md):
            "Keep the smallest set of copies that together hold everything the sender sent, as
             delivered: body text, quoted chain, embedded images, links (original addresses),
             attachments (by content), and the sender's headers (From, To, Cc, Subject, Date).
             Content added after delivery (mail-program edits, notes, banners, list footers,
             rewritten links) is not critical, and a copy differing only by it can go. Content
             removed or altered after delivery is critical: the copy that still has the original
             is kept. When the judge can't tell whether a difference came from the sender or was
             added later, keep both."
            the most complete copy is kept, regardless of age
    user approves groups

    # --- Approved tier 2 moves, mechanical ---
    move file = approved verdicts, with each UID's UIDVALIDITY and sha256 taken from the comparison file
    refuse a verdict that removes every copy, or a copy not in its group
    for each listed UID: re-fetch; if UIDVALIDITY and sha256 match, move to trash, else stop
```

## 7. Interface

### Modes

| Invocation | Does |
|---|---|
| `<setup>.py FOLDER [FOLDER ...]` or `--all` (`scan`, the default) | tier 1 dry run, plus the tier 2 comparison file. Moves nothing. |
| `... --apply` | the tier 1 moves, then the tier 2 comparison file from the survivors |
| `--move-uids FILE` | exactly the moves in FILE, nothing else |
| `--across-folders` | treat the listed folders as one set; keep the copy in the first folder listed |
| `--out-dir DIR` | where the report and the comparison file go (default `$DEDUPE_OUT_DIR`, else `~/.probanda/deduping-email/runs/<time>`) |

A folder name that does not exist, or the trash folder, fails the run before anything moves.

### Folder names

Send every folder name as one IMAP quoted string (`dedupe_core.quote_mailbox`): modified UTF-7 for non-ASCII, `\` and `"` escaped, and spaces, slashes, dots and parentheses literal. `1. OPEN FILES/Smith v. Jones (2024)/Pleadings` goes out as `"1. OPEN FILES/Smith v. Jones (2024)/Pleadings"`.

### Credentials (where the script reads an existing sign-in)

First found: `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_HOST` (and `MAIL_PORT`); the mail sign-in Probanda's mail tools already store on a Windows computer (`dedupe_core.probanda_mail_credential`, used only when it is for the same server); the OS keyring through `keyring` (service `deduping-email/<setup-id>`, the user name under the key `MAIL_USER`, the password under the user name). None found: stop, prerequisite §3.1 missing.

### Report

One JSON report on stdout, also saved as `report-<mode>.json` in the out dir: `setup`, `mode`, `status`, `dry_run`, `expunged` (always false), `trash_folder`, `out_dir`, `folders` (per folder: `uidvalidity`, `messages`, `tier1_groups`, `tier1_to_remove`), `folders_skipped`, `tier1` (`rule`, `groups` each with `keep` and `remove`, `to_remove`), `tier2` (`rule`, `comparison_file`, `groups`, `copies`, `messages_without_message_id`, `proposed`), `moved` (each with `folder`, `uid`, `tier`, `method`), `moved_count`, `errors`. On an error: `status` is `error`, `errors` says why, `moved` lists exactly what was already moved, exit code 2. A move is recorded only after the server confirms it.

### Comparison file (`tier2-comparison.json`)

```json
{"setup": "...", "created": "...", "rule": "...", "across_folders": false,
 "groups": [{"group_id": "g1", "message_id": "<...>",
   "copies": [{"index": 0, "folder": "...", "uid": 12, "uidvalidity": 7, "sha256": "...",
               "date": "...", "internaldate": "...", "size": 1234,
               "body_sha256": "...", "body_chars": 410,
               "attachments": [{"filename": "...", "size": 1, "sha256": "..."}],
               "images": [{"content_id": "<logo1>", "filename": null, "size": 1, "sha256": "..."}],
               "image_refs": ["cid:logo1", "https://..."],
               "missing_inline_images": [],
               "links": [{"url": "as found", "original": "decoded destination",
                          "rewritten_by": "safelinks|urldefense|null"}],
               "sender_headers": {"from": "...", "to": "...", "cc": null, "subject": "...", "date": "..."},
               "differing_headers": {"subject": ["..."]},
               "differing_transport_headers": ["received"]}],
   "sender_header_differences": ["cc"],
   "body_diffs": [{"from": 0, "to": 1, "diff": "unified diff, capped", "truncated": false}],
   "hints": [{"copies": [0, 1], "body_equal": false, "body_i_within_j": true, "body_j_within_i": false,
              "attachments_equal": false, "attachments_i_subset_of_j": true,
              "attachments_j_subset_of_i": false,
              "links_equal": true, "links_i_subset_of_j": true, "links_j_subset_of_i": true,
              "rewritten_links_i": 0, "rewritten_links_j": 1,
              "images_equal": false, "images_i_subset_of_j": false, "images_j_subset_of_i": true,
              "sender_headers_equal": false}]}]}
```

Copies are ordered by folder order, then highest UID first. The body is the decoded `text/plain` parts (the `text/html` parts with tags stripped when there is no plain part), normalized: line endings, trailing spaces, runs of blank lines, Unicode NFC. Diffs run from copy 0 to each other copy, capped at 4,000 characters. An inline image is an `image/*` part with a `Content-ID` or an inline disposition; it goes under `images`, never `attachments`. Links are every `href` in the `text/html` parts and every `http(s)://` URL in the `text/plain` parts, de-duplicated and sorted; `original` is the destination decoded from a Microsoft Safe Links (`url` parameter) or Proofpoint URL Defense (v2 `u` parameter, v3 `__<url>__`) link, else the link as found. A sender header with one value is a string, with none `null`, with several a sorted list. Hints are mechanical facts, not verdicts; link hints compare `original`, image hints `sha256`.

### Move file (`--move-uids`)

```json
{"moves": [{"group_id": "g1", "folder": "...", "uid": 9, "uidvalidity": 7, "sha256": "..."}]}
```

Built only by `python dedupe_core.py moves-from-verdicts --comparison C --verdicts V --groups g1,g3 --out M`. The verdict format and judging rule: `references/judging.md`.

## 8. Implementation

Setup id: `<provider>-<access method>`, lower case (`icloud-imap`, `gmail-imap`, `fastmail-imap`, `m365-graph`, `generic-imap`). One script per id.

Build on `dedupe_core.py`, so the logic of §6, the modes, the report and the fail-closed loop are shared. An IMAP setup is a thin file: it imports `dedupe_core` (from `$DEDUPE_CORE_DIR`, else its own folder), defines `SETUP_ID` and `connect()`, and calls `dedupe_core.main(SETUP_ID, connect)`. `connect()` reads credentials with `dedupe_core.resolve_credentials()`, signs in, and returns `dedupe_core.ImapMailbox(conn, trash_fallbacks=...)` with `.secrets` set to the password. `icloud-imap.py` is the model.

A non-IMAP setup writes its own mailbox class with these methods and still calls `dedupe_core.main`:

| Method | Does | Opens folder |
|---|---|---|
| `list_folders()` | `[{name, flags, delimiter}]`, flags lower-cased, the trash folder marked `\trash` | — |
| `trash_folder()` | the trash folder's name (§3.3; Graph: the `deleteditems` well-known folder); raise if none | — |
| `scan(folder)` | `{uidvalidity, messages: [{uid, sha256, size, internaldate, message_id, date}]}`; `sha256` over the full raw RFC 822 bytes; skip messages already marked deleted | read-only |
| `fetch_raw(folder, uids, expected_uidvalidity)` | `{uid: raw bytes}`; raise if the folder's validity changed | read-only |
| `move_to_trash(folder, uid, expected_uidvalidity)` | move one message to the trash folder in one step; raise if the server cannot (§4.2) or on any failure | read-write |
| `logout()` | end the session | — |

## 9. Tests and acceptance

A new script ships with `test_<setup_id>.py` beside it (underscores). The tests use synthetic RFC 822 messages and a fake server or API, need no network, and pass under `python -m pytest <file>`. They cover:

- identical copies grouped, with the highest UID kept;
- the same Message-ID with different bytes left alone by tier 1 and reaching the comparison file, with differing headers, a body diff and attachment hashes;
- links and inline images recorded and compared; a rewritten link decoded; a stripped inline image flagged;
- `--move-uids` moving only the listed UIDs, and refusing one whose hash changed;
- no permanent deletion: no EXPUNGE, CLOSE or `\Deleted` flag, and every removed copy found intact in the trash folder;
- a server with no one-step move: nothing moved;
- folder names with spaces, slashes and parentheses quoted correctly.

A script is accepted when its tests pass and it has never been run against a real mailbox by its writer.
