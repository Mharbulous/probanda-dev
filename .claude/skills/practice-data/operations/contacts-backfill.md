# Operation: contacts-backfill

Set up contacts from existing matters, once (ADR 0009). It proposes a contact for each party and counsel already in each open matter's case data, and a matter role for each, and writes only what the practitioner approves. Case data is not written.

The worklist is always the live output of `contact-checks`, so a run that stops resumes where it stopped, and a second run finds only what the practitioner skipped.

## 1. Find the gaps

Run `contact-checks` with no matter ref. Work through `matters_without_client` first, then `parties_without_role`. Report each `unresolved` entry to the practitioner with its reason, and leave it.

## 2. Build the candidates

For each party in `parties_without_role`:

- **The party.** `entity` comes from `party_type`: `individual` gives `person`, and `corporation` or `partnership` gives `organization`. When `party_type` is `other` or empty, ask.
- **Its counsel.** Where `lawyer_name` is set: a person contact for the lawyer, an organization contact for `lawyer_firm`, an affiliation between them, and an `opposing_counsel` or `co_counsel` role.
- **The party's role.** `client` for the party the firm acts for, otherwise from the party's side in the proceeding. It is a proposal for the practitioner to correct. A co-party on the firm's side who is not its client gets no role: say so, and skip it.

Each role carries its matter, `case_party_id` (the party's `party_id`) and `case_proceeding_id` (one role per proceeding the party is in, from `proceeding_ids`).

Pre-fill emails, phones and addresses from `contacts__search` and `contacts__get`. A `contact_info` value in case data is a pre-fill source only, and is not changed.

## 3. Group likely duplicates

Group candidates across matters that share a name (ignoring case, punctuation and a corporate suffix such as Ltd., Inc. or LLP) or an email or phone. Match each group against existing contacts with `contact-lookup`, and include its `near` list.

## 4. Approve one group at a time

Present one group at a time under `/show-me`, by the rule that governs aliases (`../../case-data/operations/participants.md` §Record): show the exact contact, affiliation and role items that would be written, each role with its matter, `case_party_id`, `case_proceeding_id` and proposed role. The practitioner approves the group, splits it, changes a role, or skips it.

Nothing is written without a yes, and a yes covers exactly the items shown.

## 5. Write

On a yes, write the contacts with `upsert-contact`, then the affiliations with `upsert-affiliation` and the roles with `upsert-matter-role`. A refusal's question goes to the practitioner as it stands.

Where a matched contact's details differ from counsel of record, ask whether a notice of change was filed. Overwrite neither record.

## Fixing a duplicate found later

When the practitioner says two contacts are one, call `merge-contact` with the one to keep and the spare. It combines them and deletes no information. When it returns `conflicts`, put each to the practitioner under `/show-me`, settle it with the upsert operations, and merge again.
