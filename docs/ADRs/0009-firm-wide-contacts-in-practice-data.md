---
status: accepted
---

# A person or organization the firm deals with is one `contact` item in practice data, tied to matters by `matter_role` items

Contact details are copied into each matter's matter-data `parties` row, so the same lawyer on three files is three unlinked records that drift, and nothing links a party across matters for a conflict search. Practice data is a store of items (`source/legal/mcp/src/kv/backend.ts`) whose cloud copy holds each item's id, kind, state, tags and links in clear and every data field only as a locally keyed HMAC (`source/legal/mcp/src/practice/ops.ts`), and a link maps one role to one item id (`source/legal/mcp/src/practice/items.ts`). So contacts live there, and every tie that is many-to-many or dated is an item of its own:

- **`contact`**: one person or organization, tagged `person` or `organization`, holding email, phone and address. It is the source of truth. The practitioner's CardDAV address book (`contacts__get`, `contacts__search`) is only a pre-fill source.
- **`affiliation`**: links {person, organization}, data {from, to, title}. A lawyer who changes firms stays one contact with two affiliations. Directors and officers are recorded this way when known.
- **`matter_role`**: links {matter, contact}, a `role` tag from a cloud-checked vocabulary (client, prospective_client, opposing_party, opposing_counsel, co_counsel, expert, adjuster, referral_source), data {from, to, note, case_party_id?, case_proceeding_id?}. The optional ids point to the matter-data party and proceeding, so matter-data is unchanged. Witnesses and tribunal members stay in matter-data only.
- **`client`** stays the billing account (client number, lawyers, account label). Who the client is comes from the matter's `matter_role` items tagged `client`, one per client contact, so joint clients need no special case. `upsert_client_matter` creates them when a matter opens.

Counsel of record stays in matter-data as filed (`.claude/skills/matter-data/references/design-decisions.md` #55): `parties.lawyer_name`, `lawyer_firm`, `lawyer_email`, `lawyer_phone`, `address`, `service_address_filed_date` and `replaced_representative`. Only `parties.contact_info` duplicates the contact. It is no longer written, and existing values are left alone. Where a contact's details differ from counsel of record, the practitioner is asked whether a notice of change was filed, and nothing is overwritten.

## Considered options

- **Keep contact details per matter in matter-data**: the duplication and drift stay, and there is still no firm-wide conflict search.
- **Use the address book as the source of truth**: it is read-only to Probanda, holds only the practitioner's own entries, and cannot record roles or ties to matters.
- **Add contact tables or a contact snapshot to matter-data**: matter-data is a legacy store under Exception 2 of COMMANDMENTS.md, so it may gain no new DDL, and a snapshot would bring the duplication back.
- **Separate person and organization kinds**: two kinds would double the rules and tools for no gain, so one kind carries a tag.
- **Store the client's contact on the `client` item**: a link holds one item id, so joint clients would need a special case.

## Consequences

- The cloud sees which matters share a contact, though not who it is. That is Metadata, and it is the accepted cost of the design.
- Every party on every matter becomes a contact with a role, adverse parties and declined prospects included. The conflict search, and what counts as a possible conflict, go in a separate spec.
- A one-time backfill proposes contacts from existing matters, groups likely duplicates and proposes roles with their matter-data ids. The practitioner approves or splits each group, under the same rule as aliases (#65). matter-data is not written.
- Any matter-data write that adds a party or counsel, such as `/ingest`, proposes the contact (new, or matched to an existing one) and its role in the same approval step. When that changes, matter-data's design decisions get a short entry pointing here.
- Two checks back this up: an open matter with no `client` role, and a matter-data party with no `matter_role`.
- A matter's file carries no contact snapshot. Moving a whole file out, if ever needed, is a practice-data export filtered by matter.
- New item kinds and a new rule vocabulary likely make the build a minor release, if an old copy would refuse or damage the new items. The version is decided at build time.
