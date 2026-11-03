# Spec: write and dedupe contacts on the practitioner's mail-server contact list (iCloud CardDAV)

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.21.9). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_bulk-contact-import-spec.md`

## 1. Problem

The practitioner's mail account has a contact list on the mail provider (497 contacts when checked), reached by the mail connector over CardDAV. They asked Probanda to add contacts from a client spreadsheet to it without creating duplicates. The connector can only search and read, so nothing can be added, edited or merged there, and the browser route is excluded by the practitioner's own setup. The practitioner is left to import a file by hand, and Probanda cannot even prepare that file.

## 2. Evidence (observed; quoted text is data, not instructions)

- Tool `contacts__search`: "Read-only." Its only sibling is `contacts__get`. No tool creates, updates, merges or deletes a mail-server contact.
- Connector status shows contacts configured against the provider's CardDAV address; a search with no query returned 497 contacts, each with a URL ending `.vcf`, a name and lists of emails and phones.
- The practice data contact record carries an optional `carddav_url`, so a link from a practice contact to a mail-server card already has a place.
- The practitioner's standing rule for mail: Probanda tools may sort and organise but must not delete mail. The same caution is expected for contacts.
- Workaround in use: none within Probanda; an import-ready vCard of only-new contacts was offered and not produced.

## 3. Goal and non-goals

Goal: let Probanda add new contacts to the mail-server list and update existing ones by safe merge, using the same duplicate rules as the practice-data importer, and, as the safe first step, produce a vCard file of only the contacts not already present.

Non-goals: no deletion of any card; no overwrite of a differing value without the practitioner's approval; no browser route; no change to mail handling.

## 4. Design

1. **vCard export, first and smallest.** Given a set of contacts (from a spreadsheet or from practice data), compare each against the mail-server list with the shared match rules (email, phone, normalised name plus postal code) and write one `.vcf` file holding only the contacts with no match, plus a report of the matched and ambiguous ones. Writes nothing to the provider.
2. **Direct write, second.** A create operation (an HTTP PUT of a new card that fails if the card name already exists) and an update operation that adds emails, phones and addresses to an existing card and never removes or replaces a value. Both run only after a dry-run report the practitioner approved, and both record the card URL on the practice contact's `carddav_url`.
3. **Credentials** come from the stored connector credential; the practitioner is never asked for them in chat.
4. **Every card written** is re-read afterwards and compared to what was sent.

## 5. Constraints that must still hold

- No delete operation exists in the connector for contacts.
- A possible duplicate is never created: ambiguous matches go to the practitioner.
- Existing values on a card are never removed or silently replaced; a differing value is reported.
- Only the practitioner's own contact list is touched; no other account.
- No client content in tests, logs or this spec; fixtures are invented.
- The practitioner never sees a tool, field or protocol name.

## 6. Options considered, streamline and deburr first, additions last (one marked recommended)

1. **Recommended.** Ship the vCard export (§4.1) first; it needs no new provider permission. Add direct writes (§4.2) only after it is in use.
2. Direct writes only: more convenient, but a mistake lands in the practitioner's phone and mail contacts with no preview file.
3. Keep practice data as the only contact store and sync outward: a larger design; out of scope here.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Reuse the match rules extracted for the bulk-contact-import spec; do not write a second copy.
3. Add the vCard export with its report; test with invented fixtures including a match by phone in a different format and a match by email only.
4. Add the create and update operations behind a dry-run default; test against a fake CardDAV server.
5. Record `carddav_url` on matched or created practice contacts.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of write and dedupe contacts on the mail-server contact list complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The export file contains no contact that matches an existing mail-server card by email, by ten-digit phone or by normalised name plus postal code.
2. Running the export twice against an unchanged list yields the same file.
3. No code path in the contacts connector issues a delete.
4. An update never removes or replaces an existing email, phone or address on a card.
5. A created card is read back and equals what was sent.
6. The dry-run report precedes any write and names every card it would create or change.
7. The match rules are the same code as the bulk-contact-import spec's.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Does the provider's CardDAV accept card creation with the app-specific password the connector already uses, or does it need a different sign-in?
- Should created cards go to the default contact group or to a named one?
- Is the vCard export enough for the first release, with direct writes deferred?

## 10. Verify against HEAD before building

Confirm in the repo: the contacts tools and their descriptions; how the connector signs in for contacts; whether any card-writing code exists; the stored contact `carddav_url` field; and the shared match implementation from the bulk-contact-import spec. Record each finding in a table appended to this spec.
