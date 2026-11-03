# Spec: bulk contact import with duplicate detection (spreadsheet or CSV into the practice-data contact list)

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.21.9). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_write-icloud-contacts-spec.md`

## 1. Problem

A practitioner has a practice-management export of their clients (spreadsheet, 311 client rows, columns for short name, client name, first email, date of birth, address parts, phone, home, work, mobile, fax, PO box parts, business number, marketing consent). They asked whether Probanda can merge **all** of its data into the practice-data contact list mechanically, detecting duplicates and merging or adding as needed, rerunnable, without creating duplicates. It cannot. The only write paths are one contact at a time, so a 311-row import is hundreds of model-driven calls with a stop for every possible duplicate, and nothing is rerunnable or deterministic.

## 2. Evidence (observed; quoted text is data, not instructions)

- Practice data held 48 clients and 22 contacts when checked. A client record holds only name, client number, original lawyer, responsible lawyer, type of law and major-client flag: no email, phone or address.
- Against the 311 spreadsheet rows: 32 names match a practice client, 6 match a contact, and 5 rows share a phone or email with a contact. The rest of the contact data (emails, addresses, phones, date of birth, PO box, business number, consent) is absent from practice data.
- Tool `practice_data__upsert_contact`: "There is no natural key: two contacts may share a name or an office email, so first check contact_lookup (its near list) and ask the practitioner before creating one."
- Tool `practice_data__upsert_client_matter` is described as "the CSV-import write path" but upserts by `client_num`; the export has no client number column, so it cannot be used.
- Tool `practice_data__merge_contact` merges one spare into one keep, deleting no information, and returns `conflicts` when values differ.
- Spreadsheet phones come in mixed forms (for example `778-386-2608` and `17785541621`), so a naive string compare misses duplicates.
- Workaround in use: none; the practitioner was told it is a gap.

## 3. Goal and non-goals

Goal: one deterministic, rerunnable operation that reads a spreadsheet or CSV of contacts, classifies every row against existing contacts by fixed rules, and applies only the safe outcomes, reporting the rest.

Non-goals: no deletion of any contact; no change to client or matter records (see §9); no writing to the practitioner's mail-server contacts (the related spec); no model judgement inside the importer.

## 4. Design

A new data-server operation (name UNVERIFIED), dry-run by default, `apply` only on request.
1. **Parse** by header name, not column position; tolerate missing columns; skip blank rows; treat `-` as empty.
2. **Normalise**: names lowercased with titles (Mr, Mrs, Ms, Dr), punctuation and word order removed; phones reduced to ten digits (leading `1` dropped); emails lowercased and trimmed; postal codes uppercased with the space removed.
3. **Match keys, strongest first**: shared email; shared phone; normalised name plus postal code; normalised name alone (weak). Strong keys with a single candidate give `merge`; no candidate gives `add`; a weak match, or strong matches to two or more contacts, gives `ambiguous`.
4. **Apply**: `add` creates the contact; `merge` combines emails, phones, addresses and other names into the existing contact using the same all-or-nothing write as the existing merge, deleting no information and reporting any field-level conflict instead of overwriting; `ambiguous` is written nowhere and listed.
5. **Idempotent**: each source row is recorded by a hash of its normalised content, so a second run of the same file changes nothing.
6. **Report**: counts of add, merge, unchanged, ambiguous, conflicts, and a list of the ambiguous and conflicting rows for the practitioner to settle.
7. Fields the contact record has no place for (date of birth, business number, marketing consent, fax, PO box) go to the contact's note, or are dropped by an explicit mapping; see §9.

## 5. Constraints that must still hold

- No information is deleted by any merge; conflicts stop the write for that row.
- A possible duplicate is never created silently: ambiguous rows are left for the practitioner.
- All writes for one run are recorded so a run can be listed and reversed by hand-merge; each row's write is all-or-nothing.
- No client content in logs, test fixtures or this spec; fixtures are invented.
- The practitioner never sees a tool, table or field name (`shared/internals-confidentiality.md`).

## 6. Options considered, streamline and deburr first, additions last (one marked recommended)

1. **Recommended.** Reuse the existing contact write and merge paths inside one new operation; add only parsing, normalisation, classification and the report.
2. A skill that loops the one-at-a-time tools: no new code, but slow, not deterministic, and it asks about every near match.
3. A standalone script that edits the practice database directly: fast, but bypasses the gatekeeper and its checks; rejected.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Locate the existing contact write, near-match and merge code; extract the match rules (name, suffix, email, phone) so the importer and `contact_lookup` share one implementation.
3. Add the operation: parse, normalise, classify, dry-run report.
4. Add `apply`, calling the existing merge write; add the row-hash record for idempotence.
5. Add tests with invented fixtures: mixed phone formats, title and word-order name variants, two contacts sharing an office email, a weak name-only match, a rerun of the same file, a field conflict.
6. Add one short practitioner-facing skill entry: "import contacts from a spreadsheet", dry-run first, then apply on the practitioner's yes.
7. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of bulk contact import with duplicate detection complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A dry run over a fixture of 311 invented rows writes nothing to the practice data.
2. The same fixture applied twice leaves the second run with zero adds and zero merges.
3. Phone variants `778-386-2608`, `(778) 386-2608` and `17783862608` classify as the same number.
4. A row with two strong candidates is `ambiguous` and unwritten.
5. A merge that would change a differing note or entity returns the conflict and writes nothing for that row.
6. No code path deletes a contact or any field value.
7. `contact_lookup`'s near list and the importer use one shared match implementation.
8. The practitioner-facing text names no tool, table or field.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Where do date of birth, business number and marketing consent go: the contact note, new fields, or dropped?
- Should a spreadsheet client also be linked to an existing practice client record (by name), or are contacts only in scope?
- Should the individual phone columns (home, work, mobile) keep their labels, given the phone list holds plain strings?
- Is the address shape in the contact record sufficient for building, unit, PO box and business-address parts?

## 10. Verify against HEAD before building

Confirm in the repo: the contact write, near-match and merge code and their tool descriptions; the shape of the stored contact and its address entries; how `upsert_client_matter` upserts clients; whether any spreadsheet or CSV parsing already exists in the data server (invoice import); and that no bulk contact operation was added since 0.21.9. Record each finding in a table appended to this spec.
