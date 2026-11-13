---
status: accepted
---

# A person or organization the firm deals with is one `contact` item in practice data, tied to matters by `matter_role` items

Contact details are copied into each matter's case-data `parties` row, so the same lawyer on three files is three unlinked records that drift, and nothing links a party across matters for a conflict search. Practice data is a store of items (`source/legal/mcp/src/kv/backend.ts`) whose cloud copy holds each item's id, kind, state, tags and links in clear and every data field only as a locally keyed HMAC (`source/legal/mcp/src/practice/ops.ts`), and a link maps one role to one item id (`source/legal/mcp/src/practice/items.ts`). So contacts live there, and every tie that is many-to-many or dated is an item of its own:

- **`contact`**: one person or organization, tagged `person` or `organization`, holding email, phone and address. It is the source of truth. The practitioner's CardDAV address book (`contacts__get`, `contacts__search`) is only a pre-fill source.
- **`affiliation`**: links {person, organization}, data {from, to, title}. A lawyer who changes firms stays one contact with two affiliations. Directors and officers are recorded this way when known.
- **`matter_role`**: links {matter, contact}, a `role` tag from a cloud-checked vocabulary (client, prospective_client, opposing_party, opposing_counsel, co_counsel, expert, adjuster, referral_source), data {from, to, note, case_party_id?, case_proceeding_id?}. The optional ids point to the case-data party and proceeding, so case-data is unchanged. Witnesses and tribunal members stay in case-data only (amended 2026-11-06, below).
- **`client`** stays the billing account (client number, lawyers, account label). Who the client is comes from the matter's `matter_role` items tagged `client`, one per client contact, so joint clients need no special case. `upsert_client_matter` creates them when a matter opens.

Counsel of record stays in case-data as filed (`.claude/skills/case-data/references/design-decisions.md` #55): `parties.lawyer_name`, `lawyer_firm`, `lawyer_email`, `lawyer_phone`, `address`, `service_address_filed_date` and `replaced_representative`. Only `parties.contact_info` duplicates the contact. It is no longer written, and existing values are left alone. Where a contact's details differ from counsel of record, the practitioner is asked whether a notice of change was filed, and nothing is overwritten.

## Amendment 2026-11-06: contact details for witnesses and tribunal members

Decided by the developer in `docs/Specs/2026-11-06_cast-of-characters-board-spec.md` §3. A witness's or tribunal member's identity, aliases and file codes stay in case-data. Their phones, emails and addresses go on a `contact`, tied by a `matter_role` whose data carries `case_witness_id` (role `witness`) or `case_tribunal_member_id` (role `court_staff`), the way `case_party_id` ties a party. The role vocabulary gains `client_other_counsel`, `client_representative`, `witness`, `investigator`, `insurer`, `public_body` and `court_staff`, and a role may carry `for_case_party_id` (the party an insurer insures, an investigator was engaged by, or a representative or other counsel acts for), `privileged_source`, and a `status` tag whose one value `proposed` marks a role a session recorded without asking. No table is added.

## Considered options

- **Keep contact details per matter in case-data**: the duplication and drift stay, and there is still no firm-wide conflict search.
- **Use the address book as the source of truth**: it holds only the practitioner's own entries, and cannot record roles or ties to matters. It was also read-only to Probanda when this was decided. Since 2026-11-12 Probanda adds contacts and details to it and merges its duplicates, each on the practitioner's approval (`docs/Specs/2026-11-03_write-icloud-contacts-spec.md`), which does not change this decision.
- **Add contact tables or a contact snapshot to case-data**: case-data is a legacy store under Exception 2 of COMMANDMENTS.md, so it may gain no new DDL, and a snapshot would bring the duplication back.
- **Separate person and organization kinds**: two kinds would double the rules and tools for no gain, so one kind carries a tag.
- **Store the client's contact on the `client` item**: a link holds one item id, so joint clients would need a special case.

## Consequences

- The cloud sees which matters share a contact, though not who it is. That is Metadata, and it is the accepted cost of the design.
- Every party on every matter becomes a contact with a role, adverse parties and declined prospects included. The conflict search, and what counts as a possible conflict, go in a separate spec.
- A one-time backfill proposes contacts from existing matters, groups likely duplicates and proposes roles with their case-data ids. The practitioner approves or splits each group, under the same rule as aliases (#65). Case-data is not written.
- Any case-data write that adds a party or counsel, such as `/ingest`, proposes the contact (new, or matched to an existing one) and its role in the same approval step. When that changes, case-data's design decisions get a short entry pointing here.
- Two checks back this up: an open matter with no `client` role, and a case-data party with no `matter_role`.
- A matter's file carries no contact snapshot. Moving a whole file out, if ever needed, is a practice-data export filtered by matter.
- New item kinds and a new rule vocabulary likely make the build a minor release, if an old copy would refuse or damage the new items. The version is decided at build time.
