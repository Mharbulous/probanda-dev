# Spec: Cast of Characters board

Status: confirmed by the developer, 2026-11-06, after a grilling session and a mockup review. Built 2026-11-06; the decisions taken at build time are written into the sections below and listed in 8.
Plugin: `lawyer` (the page builder and both data stores are in its `data` server).
Mockup: [`2026-11-06_cast-of-characters-board-mockup.html`](2026-11-06_cast-of-characters-board-mockup.html), fictional data. It is the reference for layout and behaviour. Where this spec and the mockup disagree, the mockup wins, and the spec is corrected to match.
Builds on: [ADR 0009](../ADRs/0009-firm-wide-contacts-in-practice-data.md) and [the firm-wide contacts spec](2026-10-16_firm-wide-contacts-spec.md), which own contacts, affiliations and matter roles; [matter-data participants](../../.claude/skills/matter-data/operations/participants.md), which owns parties, counsel of record, witnesses, tribunal members and their aliases; ADR 0033 (view pages), as described in [`view-pages.ts`](../../source/lawyer/mcp/src/submission/view-pages.ts); and the service-list specs of 2026-11-04 ([counsel's assistant](2026-11-04_service-list-email-omits-counsels-assistant-spec.md), [self-represented parties](2026-11-04_service-list-email-omits-self-represented-parties-spec.md), [party contact](2026-11-04_service-list-email-reads-party-contact-spec.md)), which own who is on the service list. Where this spec touches those, they stay the source and this spec only refers to them.

---

## 1. Problem

The practitioner needs to answer "who is X's lawyer?" or "how do I reach Y?" in seconds. On one matter, finding the name and contact details of the client's criminal defence lawyer took a grep across the whole matter folder (hundreds of matching files, and one grep timed out), then a mailbox search. The answer was in a client email. It was not in any store, because:

- matter-data holds parties, one counsel of record per party, witnesses, experts and tribunal members, but has no place for a non-party such as the client's lawyer on another matter. It may gain no new tables (Exception in COMMANDMENTS.md).
- practice-data contacts (ADR 0009) can hold anyone, but the matter-role vocabulary has no role for that person, and on that matter the contacts backfill had never been run.

## 2. Goal and non-goals

Goal: one read-only page per matter that lists every person and organization involved, with role, side, representation and contact details, built from the existing stores, plus the small store changes needed so that everyone in that list can be recorded.

Non-goals:
- A store of its own. The board copies nothing.
- Editing from the page. Every button that would change a record copies an instruction instead (4.6).
- "Last contact" dates. No store records who a document or email is from or to, and keeping that current would cost more than it gains. Leave it out until a concrete need appears.
- Proposing contacts for non-parties during `/ingest`.
- Links to facts or to emails. The opened card shows counts of facts and documents only.

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

Two more optional hashed data fields, added at build time (8):
- `for_case_party_id`: the party an `insurer` insures, an `investigator` was engaged by, or a `client_representative` or `client_other_counsel` acts for. It sets their side (4.2) and where they show (4.4). `case_party_id` keeps its meaning, so `contact_checks` is unchanged.
- `privileged_source`: true when the role's details came from a client communication. It drives the Privileged source flag (4.5).

`case_witness_id`, `case_tribunal_member_id` and `for_case_party_id` are part of the role's upsert key.

### 3.3 Recording someone found only in email or files

Both routes start with `contact-lookup` and its `near` list, so a find attaches to an existing contact where one fits:

1. The practitioner says "add X to the cast" (or names the role). The session pre-fills from `contacts__search` and the email in hand, and writes after approval under `/show-me`, as practice-data already requires.
2. A session that has just found a person by searching mail or matter files, to answer a question about who someone is or how to reach them, records the find as a **proposed** matter role (3.4) without asking first, and says in one line what it recorded. This is the one exception to practice-data's "never create a contact without asking". Amend that rule's wording in practice-data's SKILL.md to name it.

The role's `note` records where it was learned ("client email, <date>, <subject>"). When the email or document is a matter-data source, `from_source_id` points to it instead. A find from a client communication also sets `privileged_source`.

### 3.4 Proposed matter roles

Add an optional tag field `status` to the matter role, with the one value `proposed`. Absent means confirmed. Add it to `upsert_matter_role` and to the cloud rule as a tag.

- A proposed role is shown on the board (4.4) and flagged Unconfirmed (4.5).
- Confirming clears the field. "Not a character" ends the role (sets `to`) with a note. "Merge with…" moves the role to the contact the practitioner names, through practice-data's existing merge (`merge_contact`).
- A proposed role is never used to address mail. `to_service_list` and every send path read confirmed roles only.

## 4. The page

### 4.1 File, build and access

- One page per matter: `0. DRAFT\Cast of Characters.html`, beside `Loose Threads.html` and `Litigation Strategy.html`.
- Written at session entry (`drafting_forms__open_session`, after its page write), with the view-page marker and the overwrite guard the other pages use; the old-page sweep keeps it. The background job and the renders after each job do not rewrite it, because they cannot read practice data. (Build decision, 8.)
- Also built on demand by a new `practice_data` render tool that returns the page's path for a file card and relays only counts, the way `practice_data__render_practice_board` does. Not re-rendered after each contact write.
- Its own entry template under `source/lawyer/mcp/src/templates/view-pages/`, sharing `view-head.html`, `shared.js` and `view-folder.css`.
- Add `"cast of characters"` to `VIEW_NAMES` in [`html-pages-gate.py`](../../.claude/skills/drafting-data/hooks/html-pages-gate.py). No session reads the page ([`shared/html-pages.md`](../../.claude/skills/shared/html-pages.md)). A session answers the same questions from `contact_lookup` and `resolve_participant`.

### 4.2 Data

For each matter, the data reader joins:

- From matter-data: every party (name, `party_type`, proceeding roles), its counsel of record (`lawyer_name`, `lawyer_firm`, `lawyer_email`, `lawyer_phone`, `address`, `service_address_filed_date`, `replaced_representative`), every witness and expert (with `proceeding_witnesses.called_by_party_id` and `retained_by_party_id`), every tribunal member, every alias and file code in `participant_aliases`, and per participant the count of facts and of source documents that name them.
- From practice-data: every matter role on the matter, its contact (`emails`, `phones`, `addresses`, `other_names`, `note`), the contact's affiliations, and the role's `from`, `to`, `note`, `from_source_id`, `for_case_party_id`, `privileged_source` and `status`.

A contact stores its details as plain values with no source each. A detail from counsel of record or a party's case-data row cites that record ("Counsel of record", with the address for service's filed date). A detail from a contact cites its role: the title and date of the `from_source_id` source, linked to its file, or else the role's `note`.

The count of facts and documents that name a participant is a lead, not an identity. A fact counts when a position or admission ties it to the party, when it comes from the expert's report, or when its description or informant holds the participant's folded name or a spelling alias of four or more letters. A document counts when the party filed it, when it is the expert's report, when its file name holds one of the participant's file codes as a word, or when its title holds the name or a spelling alias.
- A matter-data participant and a contact are one entry when a role's `case_party_id`, `case_witness_id` or `case_tribunal_member_id` points to it.

**Side** is derived, never stored, and takes one of three values: Plaintiffs, Defendants, Neutral. ("Plaintiffs" and "Defendants" stand for the matter's own party labels: claimant and respondent, petitioner and respondent, and so on, taken from the proceeding roles.)
- A party's side is its proceeding role.
- Counsel of record takes the side of the parties they act for.
- A witness's side is the side of the party that calls them, and an expert's the side of the party that retained them. With no calling or retaining party, Neutral.
- A contact-only entry takes the side its role implies. `client_other_counsel` and `client_representative` take the client's side. `insurer` takes the side of its insured. `investigator` takes the side of the party that engaged them, else Neutral. `public_body`, `court_staff` and tribunal members are Neutral.

### 4.3 Header, tabs and filters

Look and feel match the other view pages (Legal Research, Arguments): the same stylesheet, the teal title with the gold bar, and the monospace meta row with Matter, Client, Rev and Rendered (no Writing, since the board belongs to the matter). See the mockup.

**Folder tabs**, in this order, Service List open by default:

| Tab | Sections, in order | Who |
|---|---|---|
| Service List | Plaintiffs, Defendants | One card per counsel of record, headed with the parties they act for ("For: …"), and one card per self-represented party with its own service details. The set is the one `to_service_list` addresses, as the service-list specs define it. Former counsel are shown only with Show former |
| Litigants | Plaintiffs, Defendants | Every party, one card each |
| Witnesses | Plaintiffs' Witnesses, Defendants' Witnesses, Expert Witnesses | Fact witnesses by calling side, experts (with a badge naming the side that retained them), and investigators by engaging side |
| Public Bodies | Court, Enforcement & Public Bodies | Tribunal members and `court_staff` under Court. `public_body` roles under Enforcement & Public Bodies |

Entries that fit no tab (`client_other_counsel`, `client_representative`, `insurer`, adjusters) are not cards of their own. They show inside the opened card of the person or party they relate to (4.4), and search finds them there.

A person may appear on more than one tab (a party who is also a witness). Within a section, entries are sorted by name. A fact witness or investigator with no calling or engaging party goes in an "Other Witnesses" section after Expert Witnesses, shown only when it has entries; a party with no side, in "Other parties" likewise. The Service List shows every counsel of record, the client's own included, as the mockup does.

**Filter row**, above the cards, as on Legal Research:
- **Side** drop-down: All sides, Plaintiffs, Defendants, Neutral.
- **Flags** drop-down: All entries, Unconfirmed, Missing details, Conflicting details, Privileged source (4.5).
- **Show former** checkbox, off by default: shows entries whose role `to` has passed, dimmed.
- **Search** box below: filters as you type on name, aliases, file codes, firm, email and phone, ignoring case and accents.

Each section heading carries a count badge of the entries shown. An empty section shows "None." in a dashed box. The selected tab is remembered in `localStorage`, in a try block, as on the Arguments page.

### 4.4 Cards

**Closed card**, at most two rows:
1. File code, name, and role badges (for example Plaintiff, Client, Director). Flags show as badges here too.
2. Email · phone · mailing address, on one line, cut off with an ellipsis. A missing email or phone shows as "no email" or "no phone" in the warning colour.

A proposed entry (3.4) has a dashed border.

**Opened card.** Clicking a closed card opens it. Only one card is open at a time. While a card is open, every other card, every section heading, the empty-section boxes and the filter row are hidden, so the open card is the only thing in the panel. **Close ✕** on the card, or the Esc key, returns to the list. Changing tab also closes it. The opened card holds, each under its own small heading and only when it has content:
- Aliases and other names.
- Contact: each email, phone and address with a copy button and its source and date underneath. A source with a `file_path` links to the file. An email source shows its date and subject as plain text. A missing value shows "Missing".
- Service (Service List cards): firm, address for service with its filed date, and email for service.
- Counsel: counsel of record (pointing to the Service List), and other counsel (`client_other_counsel`) with its source.
- Related: affiliations (director of, officer of, employee of), insurer and adjuster, `client_representative` people. These replace nesting cards inside one another.
- Appearances (tribunal members): the member's case-data `notes`. Matter-data records no appearances of its own.
- In the case data: counts of facts and of documents.
- Notes: a warning box with the contact's own firm-wide `note`, for anything the practitioner must keep in mind, for example a no-contact order between two people on the board.
- For a proposed entry: Confirm, Not a character and Merge with… (4.6).

**Works without JavaScript.** Every card, tab and section is in the page's markup. Switching tabs and opening and closing a card work in CSS (radio inputs and `:has`), so the page is complete in a file preview that runs no script. JavaScript only adds search, the Side and Flags filters, the Esc key and the remembered tab.

### 4.5 Flags

Each flag is a badge on the card and an option in the Flags drop-down.

| Flag | When |
|---|---|
| Unconfirmed | The role is proposed (3.4) |
| Missing details | A witness, expert or investigator missing a phone or an email; counsel, a public body, court staff or another contact-only entry with neither; a matter-data party with no matter role (`contact_checks`' `parties_without_role`); or a party with neither counsel of record nor an address for service. A represented party and a tribunal member are reached through counsel or the registry, so their own missing details are not flagged. As in the mockup, this flag shows as the "no email" or "no phone" warning on the card, with no badge |
| Conflicting details | A contact's details differ from counsel of record, or two sources give different values for the same detail. Both values are shown with their sources. Neither record is overwritten. For counsel, the instruction asks whether a notice of change was filed (ADR 0009) |
| Privileged source | A shown detail's source is a client communication or a record in matter-data's privileged store. The badge sits on the card and beside the detail. A detail with this flag is left out of anything built for someone outside the firm |

Counsel replaced (`replaced_representative` set) shows the former counsel as a former entry (Show former) and the new one as current. There is no age-based staleness rule.

### 4.6 Copy instructions

The page writes nothing. Each flag with a fix, and each of Confirm, Not a character and Merge with…, is a **Copy instruction** button that copies one sentence for the practitioner to paste into a session (as Loose Threads' Restore does). Service List also has "Copy all service emails" and "Copy service list as table".

## 5. Constraints

- Commandment 3: the page and every field it shows stay on the User's Machine. The new role values, `case_witness_id`, `case_tribunal_member_id` and `status` reach the cloud only as tags and keyed hashes, the same way `case_party_id` already does. The mockup in this folder uses fictional data only.
- Commandment 5: no table, column or file per role. Roles are tag values.
- Matter-data gains no DDL.
- Commandment 7: the page writes only its own file.

## 6. Open items

- "Last contact" stays out (section 2) until a concrete need appears.
- Proposing non-party contacts during `/ingest` of correspondence is deferred (section 2).
- ~~Whether a tribunal member who is a point of contact needs a role other than `court_staff`~~: decided at build time, `court_staff` only.

## 7. Done when

- The new roles, `case_witness_id`, `case_tribunal_member_id` and `status: proposed` are accepted by `upsert_matter_role` and the cloud rule, ADR 0009 carries the amendment, and practice-data's SKILL.md names the proposed-role exception.
- On a test matter (T5xx) holding a party with counsel, a self-represented party, a witness with a contact, an expert, a `client_other_counsel` contact recorded from an email, a proposed role, a tribunal member, a public body and an ended role:
  - the page matches the mockup: the four tabs in order with Service List first, the sections in 4.3, two-row closed cards, and one opened card at a time with everything else hidden;
  - each entry is on the right tab, section and side, and Show former reveals the ended role dimmed;
  - search finds each entry by an alias and by a file code, and the Side and Flags drop-downs filter as in 4.3 and 4.5;
  - every flag in 4.5 is shown where it applies, and the copy buttons work;
  - with JavaScript turned off, the tabs switch and cards open and close.
- `"cast of characters"` is in `VIEW_NAMES`, and the gate's tests cover it.
- `python scripts/build_plugin.py --check`, `python scripts/check_plugin.py` and `python scripts/check_publishable.py --new-since origin/main` pass.

## 8. Decisions taken at build time

Settled by the developer on 2026-11-06, or by the mockup where it and this spec disagreed. Each is written into the section named.

- Detail sources and the Privileged source flag come from the role, through `privileged_source` (3.2, 4.2).
- Fact and document counts are name, alias and file-code matches plus the case-data links (4.2).
- `for_case_party_id` names the related party of an insurer, investigator, representative or other counsel (3.2).
- Notes shows the contact's own `note` (4.4).
- Missing details follows the mockup's flags and has no badge (4.5).
- The page is written at session entry and by `practice_data__render_cast_of_characters`, not in every page write, and its header row is written in the markup, so the page does not include `shared.js`, which fills that row by script (4.1).
