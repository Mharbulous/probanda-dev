Read when: a skill needs probanda.json, the firm roster, the letterhead, the folder map or the database path, or before calling an operation the routing table points here.

# Configuration

Device and accounting-workflow state lives in a persistent config file:

```
AppData\Roaming\Probanda\probanda.json
```

Resolve relative to the user's home directory (packaged installs may redirect; use the path the directory tool returns). **Never hardcode a username.** The file used to be `AppData\Roaming\Coclerk\probanda.json`, and before that `Coclerk\coclerk.json`. When only a Coclerk file exists, the runtime's first read copies every file in the Coclerk folder into the Probanda folder and changes nothing in Coclerk. While the Coclerk folder exists, a writer also writes both Coclerk names with the same content, so an older copy of the plugin keeps reading current settings. The `COCLERK_*` environment variables keep their names. This file locates the local practice database — the MCP runtime reads `case_data_root` (the path to the `0. CASE DATA` folder) and resolves the DB at `<case_data_root>\_practice\practice.db` (overridable in tests via `COCLERK_DB_PATH`). A session can read another file in its place: `COCLERK_CONFIG_PATH` names it, and every reader of this file (the runtime and the publish scripts) then reads that file alone, for `case_data_root`, `person`, `signature`, `firm` and `repo_root` alike. The file must exist, or the call fails naming it, and it never falls back to this one. A session gets the variable through the `env` block of a `.claude/settings.local.json` in the folder it opens in, so it reaches Code tab sessions only, never a session in a folder without that file. In such a session this file is not the authority: the prose steps below that say to read `probanda.json` mean the file the variable names. It also holds accounting-system configuration:

```json
{
  "version": 1,
  "case_data_root": "<absolute path to the practitioner's \"0. CASE DATA\" folder>",
  "firm": {
    "address": "<the firm's address for service, as it should appear on a filed form>",
    "email": "<the firm's e-mail address for service, or \"\" if none>",
    "fax": "<the firm's fax number for service, or \"\" if none>"
  },
  "review": {"scope": "full | changed", "comments": "at_end | per_paragraph"},
  "person": "<this machine's key in the firm roster>",
  "signature": "<absolute path to that person's scanned signature image>",
  "practice_quirks": "<this practitioner's environment notes, at most 1,000 characters>",
  "briefing": {
    "mailbox": "<the address the morning briefing is sent from>",
    "to": "<the address the morning briefing is sent to>",
    "greeting_name": "<the name the briefing's opening line greets>"
  },
  "accounting": {
    "system": "<name of user's accounting software, e.g. UNITY, QuickBooks, Clio>",
    "csv_mapping": {
      "csv_report_name": "<name of the trust listing report in the accounting system>",
      "date_format": "<date format used in CSV exports>",
      "sign_convention": "<how trust balances are represented, e.g. negative_is_funded>",
      "column_map": {
        "clientID": "<CSV column name for client number>",
        "matterID": "<CSV column name for matter number>",
        "clientNames": "<CSV column name for client name>",
        "responsibleLawyer": "<CSV column name for responsible lawyer>",
        "TrustBalance": "<CSV column name for trust balance>",
        "lastUpdated": "<CSV column name for last trust date>"
      },
      "quirks": ["<any system-specific parsing notes>"]
    }
  }
}
```

The `firm` block holds the firm's own contact details for the address-for-service block on filed court forms. They are firm-wide constants, not matter records, so they are not in the practice database. `address` is mandatory; `email` and `fax` render as "(if any)" lines and may be empty strings. A skill that needs them reads the block, and if it is absent asks the practitioner for the three values and writes them back here before proceeding.

The `review` block holds the practitioner's preferred mode for counsel's review in `/draft`: `scope` is `full` or `changed`, and `comments` is `at_end` or `per_paragraph`. It follows the `firm` block's pattern: read it, and if it is absent ask the practitioner for both values and write them back here before proceeding. A mode switched during a review is not written back.

The `style` block holds the spelling convention `/draft`'s on-the-fly revision follows (`spelling`: `canadian`, `us`, `uk` or `australian`), read and written the same way.

The `person` and `signature` keys are machine-local: they describe this machine's author and are never copied to the firm folder or a plugin. `person` is this machine's `key` in the firm roster. `signature` is the path to that person's scanned signature image, and a path whose file is missing is refused when it is set. Both are set with `practice_data__upsert_firm_profile`.

The optional `page_api_port` key is machine-local too: the port, a whole number from 1 to 65535, of the localhost listener through which a matter page's buttons write (`shared/html-pages.md`). Unset, it is 47615. Set it only when another program holds that port. Pages rendered before a change keep the old port until they are rendered again. Beside this file, `page-api.secret` holds the per-device key the listener checks each page's token with. The runtime creates it on first need. Never copy or edit it.

The optional `timing_log` key is machine-local: `false` stops Probanda keeping its own record of how long each step takes on this machine, from the next session. Unset, the record is kept. It never holds client or matter content. Set it only when the practitioner asks.

The firm roster lives in `<case_data_root>\_practice\firm\firm.json`, with the firm name and one entry per lawyer or staff member, each keyed by a stable `key`. Entries are never removed: someone who has left is marked `active: false`. The firm letterhead is `letterhead.docx` beside it. Each person's optional email signature template is `email-signatures\<key>.htm` beside them, in Outlook's signature layout (an optional `<key>.txt` plain-text version and `<key>_files\` image folder beside it). It is placed by hand, no tool writes it, and `write_email` uses it in place of Outlook's signature (`shared/email.md`). The roster and letterhead are read with `practice_data__firm_profile` and set with `practice_data__upsert_firm_profile`. The optional `cc_on_counsel_email` key, a list of roster keys set through the same tool, names the firm's own people copied on every email `write_email` addresses to counsel from case data, such as the firm's legal assistant (`shared/email.md`). Set it only as the practitioner states the firm's practice, never by inference.

The `briefing` block serves `executive-assistant`'s morning-briefing delivery, which reads it itself. It runs unattended, so it never asks: a missing block or value stops the send and is reported as a data gap.

The `csv_mapping` key is populated on first CSV import. If missing, the importing skill examines the CSV headers and asks the user to confirm column mappings, then saves the confirmed mapping here for future imports. (invoice-tracking stores its own `accounting.invoice_mapping` alongside `csv_mapping`.)

## Operation notes

| Operation | Tool | Notes |
|---|---|---|
| firm-profile | `practice_data__firm_profile` | no inputs; returns `firm_name`, `roster`, the letterhead path (null when none is registered) and this machine's `person` key (null when unset); fails naming the missing piece (firm.json or its firm name) with its path, and fails when `person` names no roster entry (see above) |
| upsert-firm-profile | `practice_data__upsert_firm_profile` | any of `firm_name`, `roster_entry` (upsert by `key`; a new entry needs every field; never removed, `active: false` retires one), `person` and `signature` (this machine's probanda.json), `practice_quirks` (the whole note in this machine's probanda.json, at most 1,000 characters, `""` clears it; see `practice-quirks.md`; a call that sets only it and/or `signature` needs no firm folder, and creates probanda.json when it is absent), and `letterhead` (a .docx whose header and footer tokens must each sit in one run; a split token refuses the registration and nothing is written); reports `theme_faces_differ` when the theme's two faces differ, `signer_fields_missing` (a list of `key`, `fields`) naming every active lawyer the resulting roster leaves without a field a letter's letterhead needs, and `preparer_initials_missing` (a key) when this machine's `person` points to an entry with blank initials; both are checked on every call and the call still writes, so tell the practitioner that any letter the lawyer signs, or any letter prepared on this machine, is refused until a `roster_entry` with that key supplies the fields |
| folder-map | `practice_data__folder_map` | read-only; optional `paths` and `types`; returns the document-type glossary and the folder map of this machine's `person` (`<case_data_root>\_practice\firm\folder-maps\<person>.json`), or `no_map` when no person is set or that person has none, which the caller tells the practitioner, offering `/probanda-setup`, never assuming a layout or using another person's map; with `paths`, each path's types and flags; with `types`, each type's folders |
| set-folder-map | `practice_data__set_folder_map` | `entries`, the whole map (`/probanda-setup` step 6); refused, writing nothing, on an unknown or repeated type, a folder glob that is not relative to the matter folder, or no `person` on this machine |
| config-status | `practice_data__config_status` | read-only, writes nothing; optional `matter_root`; reports the settings file's path, `exists`, `parse_error`, `keys_present`/`keys_missing`, its `case_data_root` with `root_exists`/`practice_db_exists`, `candidates` (the root a matter's pointer sits in, when given `matter_root`; with no `matter_root` and no settings file, the folders a scan of the user's profile finds, with `scan_truncated`) and `redirected_copies` (copies under a packaged app's redirected AppData, which the runtime does not read), `cloud_credential` (`present` or `missing`: the credential writes need) and `pending_writes` (writes Probanda's Cloud saved that practice.db has not yet applied), and `practice_quirks` (verbatim, or null when the file is absent or sets none; see `practice-quirks.md`); see SKILL.md Conventions |
| config-set-root | `practice_data__config_set_root` | `case_data_root`, only after the practitioner approves it; refused, writing nothing, unless `<root>\_practice\practice.db` already exists or `initialize: true` is passed (only `/lawyer:probanda-setup` passes it, for a new device's approved root, and the tool then creates `_practice\` and `practice.db`), when the file is not valid JSON, and when the file's current root already works (`root_already_working`); creates the file with only `version` and `case_data_root`, or changes only that key; returns `keys_missing`; see SKILL.md Conventions |
