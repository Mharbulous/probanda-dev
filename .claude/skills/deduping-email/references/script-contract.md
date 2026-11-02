# Setup script contract

Every setup script at `references/scripts/<setup-id>.py`, shipped or written later, meets this contract. The tests in `references/scripts/test_dedupe_core.py` check it for the shipped core.

## Setup ids

`<provider>-<access method>`, lower case: `icloud-imap`, `gmail-imap`, `fastmail-imap`, `m365-graph`, `generic-imap`. One script per id. A provider reached two ways has two ids.

## Build on the core

An IMAP setup is a thin file: it imports `dedupe_core` (from `$DEDUPE_CORE_DIR`, else its own folder), defines `SETUP_ID` and `connect()`, and calls `dedupe_core.main(SETUP_ID, connect)`. `connect()` resolves credentials with `dedupe_core.resolve_credentials()`, signs in, and returns `dedupe_core.ImapMailbox(conn, trash_fallbacks=...)` with `.secrets` set to the password. `icloud-imap.py` is the model.

A non-IMAP setup (Microsoft Graph, a provider API) writes its own mailbox class with the same five methods and still calls `dedupe_core.main`, so the rules, modes, report and fail-closed loop stay the core's:

| Method | Does | Opens folder |
|---|---|---|
| `list_folders()` | `[{name, flags, delimiter}]`, flags lower-cased, the provider's trash marked `\trash` | — |
| `trash_folder()` | the Deleted Items / Trash folder's name, by the `\Trash` special-use flag or the provider's equivalent (Graph: the `deleteditems` well-known folder); raise if none | — |
| `scan(folder)` | `{uidvalidity, messages: [{uid, sha256, size, internaldate, message_id, date}]}`; `sha256` over the full raw RFC 822 bytes; skip messages already marked deleted | read-only |
| `fetch_raw(folder, uids, expected_uidvalidity)` | `{uid: raw bytes}`; raise if the folder's validity changed | read-only |
| `move_to_trash(folder, uid, expected_uidvalidity)` | move one message to the trash folder; return the method used; raise on any failure | read-write |
| `logout()` | end the session | — |

`uid` is an integer stable within the folder, increasing with arrival: the IMAP UID, or for an API a stable sequence the script derives and documents. `uidvalidity` changes whenever those ids would be reused.

## Modes

| Invocation | Does |
|---|---|
| `<setup>.py FOLDER [FOLDER ...]` or `--all` (`scan`, the default) | tier 1 dry run, plus the tier 2 comparison file. Moves nothing. |
| `... --apply` | the tier 1 moves, then the tier 2 comparison file from the survivors |
| `--move-uids FILE` | exactly the moves in FILE, nothing else |
| `--out-dir DIR` | where the report and the comparison file go (default `$DEDUPE_OUT_DIR`, else `~/.probanda/deduping-email/runs/<time>`) |

## Inputs

- One or more folder names, exactly as the mail program shows them, or `--all` (every selectable folder except the trash; also skipped: `\Noselect`, `\NonExistent`, `\All`).
- By default each folder is deduplicated on its own. With `--across-folders` the listed folders are one set and the copy in the first folder listed is kept.
- A folder name that does not exist, or the trash folder, fails the run before anything moves.

## Folder names

Send every folder name as one IMAP quoted string (`dedupe_core.quote_mailbox`): modified UTF-7 for non-ASCII, `\` and `"` escaped, and spaces, slashes, dots and parentheses literal. `1. OPEN FILES/Smith v. Jones (2024)/Pleadings` goes out as `"1. OPEN FILES/Smith v. Jones (2024)/Pleadings"`.

## Rules

- **Tier 1, identical.** SHA-256 of the full raw message equal. Keep the highest UID in the folder (with `--across-folders`, the highest UID in the first listed folder holding a copy). The others are removed.
- **Tier 2, duplicative.** Same Message-ID among the tier 1 survivors, different bytes. The script never moves these on its own. Each group goes to the comparison file. Messages with no Message-ID are counted and left alone.
- **Delete** means a move to the trash folder. Never EXPUNGE, never CLOSE a read-write folder, never delete permanently, never empty the trash. Without IMAP MOVE, copy to the trash and flag the source `\Deleted` with no expunge.

## Comparison file (`tier2-comparison.json`)

```json
{"setup": "...", "created": "...", "rule": "...", "across_folders": false,
 "groups": [{"group_id": "g1", "message_id": "<...>",
   "copies": [{"index": 0, "folder": "...", "uid": 12, "uidvalidity": 7, "sha256": "...",
               "date": "...", "internaldate": "...", "size": 1234,
               "body_sha256": "...", "body_chars": 410,
               "attachments": [{"filename": "...", "size": 1, "sha256": "..."}],
               "differing_headers": {"subject": ["..."]},
               "differing_transport_headers": ["received"]}],
   "body_diffs": [{"from": 0, "to": 1, "diff": "unified diff, capped", "truncated": false}],
   "hints": [{"copies": [0, 1], "body_equal": false, "body_i_within_j": true, "body_j_within_i": false,
              "attachments_equal": false, "attachments_i_subset_of_j": true,
              "attachments_j_subset_of_i": false}]}]}
```

Copies are ordered by folder order, then highest UID first. The body is the decoded `text/plain` parts (the `text/html` parts with tags stripped when there is no plain part), normalized: line endings, trailing spaces, runs of blank lines, Unicode NFC. Diffs run from copy 0 to each other copy, capped at 4,000 characters. Hints are mechanical facts, not verdicts.

## Move file (`--move-uids`)

```json
{"moves": [{"group_id": "g1", "folder": "...", "uid": 9, "uidvalidity": 7, "sha256": "..."}]}
```

Built only by `python dedupe_core.py moves-from-verdicts --comparison C --verdicts V --groups g1,g3 --out M`, which takes each UID's validity and hash from the comparison file and refuses a verdict that removes every copy of a group, or a copy not in its group. Before each move the script re-fetches the message and refuses it unless its folder validity and SHA-256 still match.

## Credentials

Only from `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_HOST` (and `MAIL_PORT`), or the OS keyring through `keyring` when installed: service `deduping-email/<setup-id>`, the user name under the key `MAIL_USER`, the password under the user name. Never written to a file, never printed (the report redacts the password from every error), never passed through chat or on the command line.

## Folder access

Scans open folders read-only (IMAP EXAMINE). Only `--apply` and `--move-uids` open a folder read-write, and only to move.

## Errors

Fail closed. Any error stops the run at once. The report's `status` is `error`, `errors` says why, and `moved` lists exactly the messages already moved. Exit code 2. A move is recorded only after the server confirms it.

## Output

One JSON report on stdout, also saved as `report-<mode>.json` in the out dir:

`setup`, `mode`, `status`, `dry_run`, `expunged` (always false), `trash_folder`, `out_dir`, `folders` (per folder: `uidvalidity`, `messages`, `tier1_groups`, `tier1_to_remove`), `folders_skipped`, `tier1` (`rule`, `groups` each with `keep` and `remove`, `to_remove`), `tier2` (`rule`, `comparison_file`, `groups`, `copies`, `messages_without_message_id`, `proposed`), `moved` (each with `folder`, `uid`, `tier`, `method`), `moved_count`, `errors`.

## Tests

A new setup script ships with tests beside it, `test_<setup_id>.py` (underscores), that use synthetic RFC 822 messages and a fake server or API, need no network, and cover: identical copies with the highest UID kept; same Message-ID different bytes reaching the comparison file only; `--move-uids` moving only the listed UIDs; no permanent deletion; folder names with spaces, slashes and parentheses. They pass under `python -m pytest <file>`.
