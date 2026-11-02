---
name: probanda-setup
description: "Set Probanda up on a device where it has never been set up: a practice_data tool reports probanda.json not found, or practice_data__config_status reports exists false. Finds the practitioner's 0. CASE DATA folder (or where to create one), writes this device's probanda.json, creates the practice database, records who uses this device, connects the folder suggestions are shown from, and records where the practitioner keeps each kind of document (their folder map). Also use it, on a device already set up, when another skill reports that Probanda does not yet know where the practitioner keeps each kind of document: it then runs only that step. Not for a settings file that exists but is broken (practice-data's repair), or for a tool that fails on a device already set up."
---

<!-- lawyer v0.20.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Probanda setup

A missing `probanda.json` means Probanda has not been set up on this device. It is not a fault. This skill sets the device up and then hands back to whatever the practitioner was doing.

**Rules that hold throughout:**
- Write `probanda.json` only through the practice_data tools named below. Never write it or `firm.json` by hand.
- Nothing written holds client or matter content: no client names, matter names or document text. It holds only folder paths, the firm's name and the roster.
- Setup creates only Probanda's own folders and files: the `0. CASE DATA` folder when the practitioner approves creating it, `_practice\` and `practice.db`, `_practice\firm\firm.json`, this person's folder map, and the suggestions folder beside `probanda.json`. It never deletes, moves or renames a file, and never creates a folder inside a matter. A matter's own `0. CASE DATA` folder is created by matter-data's initialize, not here.
- Setup never writes `practice_quirks` or a credential. `practice_quirks` follows practice-data's Practice quirks rules.

## Step 1 — Confirm this is a new device

Call `practice_data__config_status`.
- If `error` is set because `COCLERK_CONFIG_PATH` names a missing file, stop and report it. That file is the authority, and setup never creates the live file in its place.
- If `exists` is `true`, the device is already set up. When this run was started to record the folder map, go to Step 6 and then hand back. Otherwise a broken file goes to practice-data's Conventions repair, not here.
- Otherwise continue. Keep its `candidates`, its `cloud_credential` and its `redirected_copies` for later steps. A `redirected_copies` entry means an earlier install wrote its settings where the runtime does not read them. Tell the practitioner, and do not copy it.

## Step 2 — Find the matter-data root

The root is the practitioner's `0. CASE DATA` folder beside the matter folders: the folder that holds `_practice\practice.db`. In the default layout it sits in the same document library as the matter folders. Each matter's own case data is in a `0. CASE DATA` folder inside that matter (ADR 0013). A matter set up before then may still keep its matter-data folder under this root until it is relocated.

1. **Candidates.** `config_status` lists `candidates` with `source: "scan"`: folders under the user's profile named `0. CASE DATA`, or holding `_practice\practice.db`. The scan follows symlinks and junctions, so it finds a folder in a synced SharePoint or other cloud library reached through a link, and lists it at the path where it was found. A candidate with `practice_db_exists: true` is an existing Probanda root (another device already set it up). `scan_truncated: true` means the scan stopped early and the folder may still exist.
2. **No candidate, or none is right.** Ask the practitioner where their matter folders are, and have them grant access to that folder with the session's folder-access tool (`request_cowork_directory` in Cowork). If they decline, stop and say that the folder is needed. List it, and look for a `0. CASE DATA` folder. A folder entry whose type is "symlink" or a junction is a folder: list it too. If there is none, propose creating `0. CASE DATA` in the folder that holds the matter folders.
3. **Approve.** Under `/show-me`, show the full path, whether it already holds `_practice\practice.db`, and what will be created (nothing, or `_practice\` and `practice.db`, or also the `0. CASE DATA` folder itself). Ask one question: is this the folder?

## Step 3 — Write the root

On the practitioner's yes, call `practice_data__config_set_root` with `case_data_root`.
- When the root already holds `_practice\practice.db`, pass nothing else.
- When it does not, pass `initialize: true`. The tool creates the root folder (when only its parent exists), `_practice\` and `practice.db`, and writes `probanda.json`.
- A refusal (`root_already_working`, invalid JSON) is reported as it stands. Never retry it with another root.

## Step 4 — Who uses this device

Call `practice_data__firm_profile`.
- **firm.json exists.** Show the roster under `/show-me` and ask which entry is the person using this device. On the answer, call `practice_data__upsert_firm_profile` with `person`.
- **No firm.json (a new firm; the call fails naming firm.json or its firm name).** Ask for the firm's name and this person's roster entry (`key`, `name`, `role` and the entry's other fields, as `upsert_firm_profile` describes them). Show the proposed values under `/show-me`, then on a yes write them in one call: `firm_name`, `roster_entry` and `person`. Relay any `signer_fields_missing` or `preparer_initials_missing` that the call reports.

## Step 5 — Privacy briefing

Cover the first two points conversationally, and say the third once, in these words:
1. **Local storage.** The practice database stays on this computer. Claude reads it only in answer to the practitioner's requests in a session.
2. **Training opt-out.** Recommend turning off model training on their conversations: *Settings > Privacy > "Improve Claude"*.
3. **Suggestions.** "When you send the Probanda team a suggestion, Probanda writes a technical write-up of it for them, and that uses your Claude plan."

Whether to store client names is asked by retainer-tracking's First Import, and the accounting system by invoice-tracking's and retainer-tracking's First Import, each when first needed. Setup asks neither.

## Step 6 — Record the folder map

Follow `references/folder-layout.md`. It proposes, from one of the practitioner's matter folders, where they keep each kind of document.

## Step 7 — Connect the suggestions folder

Only on a remote-device host (its tool list holds `get_device_info`), where a file card is shown only from a connected folder. Call `suggestion_box__past_suggestions` with no arguments: it creates the suggestions folder, and the folder holding its `past_suggestions_path` is that folder. Never present or read the page here. Connect that folder, not the one above it, which holds this device's settings and secret. If `get_device_info`'s `connectedFolders` does not cover it, call `device_request_folder_access` once for it, with a one-line reason (Probanda shows suggestions from there) that names no file. On a decline or refusal, say in one line that the practitioner can connect it later with "Add folder" in the Claude desktop app, and carry on.

## Step 8 — Verify and hand back

1. Call `practice_data__matter_lookup` with any matter reference. An empty result is fine on a new install. A path-resolution error is not, and means step 3 did not take.
2. Call `practice_data__config_status` again and confirm `exists: true` and `practice_db_exists: true`.
3. If `cloud_credential` is `missing`, tell the practitioner that every practice write will fail until Probanda's key is set. If they have the key, call `cloud_key__configure_credential` and send them the link it returns. If they have none, call `key_request__submit` and send them the link it returns, so they can ask Probanda for one. practice-data's operations/credentials.md (Probanda's key) says what follows, and what to do when either tool is not in your tool list.
4. Tell the practitioner which `keys_missing` remain. Each is left to the skill that needs it (practice-data's operations/configuration.md).
5. Return to the task that was interrupted.
