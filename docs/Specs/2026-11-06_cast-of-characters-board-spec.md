# Spec: Cast of Characters board

Status: confirmed by the developer, 2026-11-06, after a grilling session. Not yet built.
Plugin: `lawyer` (the page builder and both data stores are in its `data` server).
Builds on: [ADR 0009](../ADRs/0009-firm-wide-contacts-in-practice-data.md) and [the firm-wide contacts spec](2026-10-16_firm-wide-contacts-spec.md), which own contacts, affiliations and matter roles; [matter-data participants](../../.claude/skills/matter-data/operations/participants.md), which owns parties, counsel of record, witnesses, tribunal members and their aliases; and ADR 0033 (view pages), as described in [`view-pages.ts`](../../source/lawyer/mcp/src/submission/view-pages.ts). Where this spec touches those, they stay the source and this spec only refers to them.

---

## 1. Problem

The practitioner needs to answer "who is X's lawyer?" or "how do I reach Y?" in seconds. On one matter, finding the name and contact details of the client's criminal defence lawyer took a grep across the whole matter folder (hundreds of matching files, and one grep timed out), then a mailbox search. The answer was in a client email. It was not in any store, because:

- matter-data holds parties, one counsel of record per party, witnesses, experts and tribunal members, but has no place for a non-party such as the client's lawyer on another matter. It may gain no new tables (Exception in COMMANDMENTS.md).
- practice-data contacts (ADR 0009) can hold anyone, but the matter-role vocabulary has no role for that person, and on that matter the contacts backfill had never been run.

## 2. Goal and non-goals

Goal: one read-only page per matter that lists every person and organization involved, with role, side, representation and contact details, built from the existing stores, plus the small store changes needed so that everyone in that list can be recorded.

Non-goals:
- A store of its own. The board copies nothing.
- Editing from the page.
- "Last contact" dates. No store records who a document or email is from or to, and keeping that current would cost more than it gains. Leave it out until a concrete need appears.
- Proposing contacts for non-parties during `/ingest`.
- Links to facts or to emails.

## 3. Store changes

### 3.1 New matter roles

Add these values to the matter-role vocabulary that Probanda's Cloud holds (`cloud/items/rules.sql`, the `role` list beside `referral_source`), and to the `upsert_matter_role` description in [`schema/practice.ts`](../../source/lawyer/mcp/src/schema/practice.ts) and practice-data's SKILL.md Contacts section:

| Role | Who |
|---|---|
| `client_other_counsel` | The client's lawyer on another matter (for example criminal defence counsel), who is not co-counsel on this one |
| `client_representative` | A person who speaks for the client without being an officer or director (a family member, an assistant). Officers and directors remain affiliations (ADR 0009) |
| `witness` | A fact or expert witness's contact details (3.2) |
| `investigator` | A private or insurer's investigator |
| `insurer` | The insurer as an organization. Its adjusters stay `adjuster` roles, each affiliated with the insurer |
| `public_body` | A police detachment, regulator, municipality or other public body |
| `court_staff` | Registry or scheduling staff. Judges, associate judges, arbitrators and registrars stay in matter-data's `tribunal_members` |

A role is a tag value, so Commandment 5 is met. Whether an old copy refuses the new values decides patch or minor at release (CLAUDE.md, Releasing).

### 3.2 Contact details for witnesses and tribunal members

This amends ADR 0009's line "Witnesses and tribunal members stay in case-data only". Their identity, aliases and file codes stay in matter-data. Their phones, emails and addresses go on a practice-data contact, tied by a matter role that carries a new optional data field, `case_witness_id` (role `witness`) or `case_tribunal_member_id` (role `court_staff`, or a new role if the forum's member is the point of contact), in the same way `case_party_id` ties a party. Add the field to the cloud rule's hashed fields (`cloud/items/rules.sql`, beside `hash:case_party_id?`) and to `upsert_matter_role`. No table is added. ADR 0009 gets a short amendment that points here.

### 3.3 Recording someone found only in email or files

Two routes, both under practice-data's existing rules (never create a contact without asking, `contact-lookup` first with its `near` list, approval under `/show-me`):

1. The practitioner says "add X to the cast" (or names the role). The session pre-fills from `contacts__search` and the email in hand.
2. A session that has just found a person by searching mail or matter files, to answer a question about who someone is or how to reach them, offers once to record them, with the contact and role it would write.

The role's `note` records where it was learned ("client email, <date>, <subject>"). When the email or document is a matter-data source, `from_source_id` points to it instead.

## 4. The page

### 4.1 File, build and access

- One page per matter: `0. DRAFT\Cast of Characters.html`, beside `Loose Threads.html` and `Litigation Strategy.html`.
- Built in the same page write as Loose Threads ([`matter-pages-build.ts`](../../source/lawyer/mcp/src/submission/matter-pages-build.ts)), with the view-page marker, the overwrite guard and the old-page sweep that the other pages use.
- Also built on demand by a new `practice_data` render tool that returns the page's path for a file card and relays only counts, the way `practice_data__render_practice_board` does. Not re-rendered after each contact write.
- Its own entry template under `source/lawyer/mcp/src/templates/view-pages/`, sharing `view-head.html`, `shared.js` and `view-folder.css`.
- Add `"cast of characters"` to `VIEW_NAMES` in [`html-pages-gate.py`](../../.claude/skills/drafting-data/hooks/html-pages-gate.py). No session reads the page ([`shared/html-pages.md`](../../.claude/skills/shared/html-pages.md)). A session answers the same questions from `contact_lookup` and `resolve_participant`.

### 4.2 Data

For each matter, the data reader joins:

- From matter-data: every party (name, `party_type`, proceeding roles), its counsel of record (`lawyer_name`, `lawyer_firm`, `lawyer_email`, `lawyer_phone`, `address`, `service_address_filed_date`, `replaced_representative`), every witness and expert (with `proceeding_witnesses.called_by_party_id` and `retained_by_party_id`), every tribunal member, and every alias and file code in `participant_aliases`.
- From practice-data: every matter role on the matter, its contact (`emails`, `phones`, `addresses`, `other_names`), the contact's affiliations, and the role's `from`, `to`, `note` and `from_source_id`.
- A matter-data participant and a contact are one entry when a role's `case_party_id`, `case_witness_id` or `case_tribunal_member_id` points to it.

**Side** is derived, never stored:
- A party's side is "ours" when it is a client or on the client's side, and "other" otherwise.
- A witness's side is the side of the party that calls them.
- An expert's side is the side of the party that retained them.
- A contact-only entry takes the side its role implies. `client_other_counsel` and `client_representative` are ours. `insurer`, `investigator`, `public_body` and `witness` without a calling party are neutral. `court_staff` is court.

### 4.3 Layout and behaviour

Same stylesheet, header meta row (Matter, Client, Rev, Rendered, with no Writing) and one vertical list at every width as the other boards.

- **Count row** above the tabs: total entries and the number of gaps.
- **Search box**: filters as you type on name, other names, aliases, file codes, firm, email and phone, ignoring case and accents.
- **Folder tabs**: All, Our side, Other side, Neutral, Court. The tab is remembered in `localStorage`, in a try block, as on the Arguments page.
- Within a tab, entries are grouped by role in a fixed order (client, client's people, our counsel, opposing parties, opposing counsel, client's other counsel, witnesses, experts, insurers and adjusters, investigators, public bodies, tribunal, court staff, referral source), then sorted by name.
- A person affiliated with an organization on the board is nested under it: the client's officers under the client, a lawyer under their firm.
- **Card, closed**: name, role chip, side, and "represented by" (counsel of record for a party).
- **Card, opened**: aliases and file codes, phones and emails (each with a copy button), address, address for service with its filed date, and the source with its date. A source with a `file_path` links to the file. An email source shows its date and subject as plain text.
- **"Show former" checkbox**, off by default: shows roles whose `to` has passed, dimmed.

### 4.4 Gaps

Each gap is flagged on its card in the accent colour, with a **Copy instruction** link that copies one sentence for the practitioner to paste into a session and writes nothing (as Loose Threads' Restore does):

- No phone and no email for the entry.
- A matter-data party with no matter role (`contact_checks`' `parties_without_role`).
- A contact's details differ from counsel of record. The instruction asks whether a notice of change was filed (ADR 0009). Neither record is overwritten.
- Counsel replaced (`replaced_representative` set).

There is no age-based staleness rule.

## 5. Constraints

- Commandment 3: the page and every field it shows stay on the User's Machine. The new role values and `case_witness_id` / `case_tribunal_member_id` reach the cloud only as tags and keyed hashes, the same way `case_party_id` already does.
- Commandment 5: no table, column or file per role. Roles are tag values.
- Matter-data gains no DDL.
- Commandment 7: the page writes only its own file.

## 6. Open items

- "Last contact" stays out (section 2) until a concrete need appears.
- Proposing non-party contacts during `/ingest` of correspondence is deferred (section 2).
- Whether a tribunal member who is a point of contact needs a role other than `court_staff` is decided at build time.

## 7. Done when

- The new roles and `case_witness_id` / `case_tribunal_member_id` are accepted by `upsert_matter_role` and the cloud rule, and ADR 0009 carries the amendment.
- On a test matter (T5xx) holding a party with counsel, a witness with a contact, a `client_other_counsel` contact recorded from an email and an ended role, the page lists each one under the right tab and side, search finds each by an alias and by a file code, the copy buttons work, and each gap in section 4.4 is flagged.
- `"cast of characters"` is in `VIEW_NAMES`, and the gate's tests cover it.
- `python scripts/build_plugin.py --check`, `python scripts/check_plugin.py` and `python scripts/check_publishable.py --new-since origin/main` pass.
