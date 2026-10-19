# Spec: Firm-wide conflict search over contacts, affiliations and matter roles

Status: proposed, 2026-10-16. Decisions taken with Brahm on 2026-10-16 (§10).
Plugin: `legal`.
Depends on: ADR 0009 (`docs/ADRs/0009-firm-wide-contacts-in-practice-data.md`) and `docs/Specs/2026-10-16_firm-wide-contacts-spec.md`, which defines the `contact`, `affiliation` and `matter_role` items this spec searches (its §4.1). That spec is the source for the items. Nothing here can be built before they exist.

---

## 1. Problem

ADR 0009 makes each person or organization the firm deals with one `contact`, so a party can finally be linked across matters. It leaves two things to this spec: how the firm-wide conflict search works, and what counts as a possible conflict. Today the only conflict state in practice data is the `conflict_check_completed` signal, which holds a new matter at `prospective` and which `declined` requires (`cloud/items/rules.sql`, `rules.status_policy`). Nothing produces the check that the signal records.

## 2. What is searched

1. **The input** is one or more *subjects*. Each is a person or organization on a new or changed matter, with the role it would hold there. A subject is either an existing contact or the details proposed for a new one (name, other names, email, phone). A subject need not be saved first.
2. **The pool** is every `contact` item, with its `name`, `other_names`, `emails[]` and `phones[]`, plus every `matter_role` and `affiliation` item.
3. **Every matter counts**, whatever its status (open, closed or declined) and however old. Each hit shows the matter's status and, where it has one, its closing date.
4. **Roles on the subject's own matter are excluded.** A subject is never a conflict with itself.
5. **Affiliations are followed one step, past and current.** A subject that is a person is also checked through every organization it is or was affiliated with. A subject that is an organization is also checked through every person who is or was affiliated with it. A hit found this way is marked "via affiliation" and shows the affiliation's `from`, `to` and `title`. The search does not take a second step, from that person to their other organizations.
6. **Witnesses and tribunal members are not searched.** Under ADR 0009 they stay in matter-data only and have no `matter_role`.

## 3. The `other_names` field

`contact` gains one data field beside those in the contacts spec §4.1, `other_names[]`: a list of former names, trade names and other spellings of the same person or organization. Each entry is written only with the practitioner's approval, under the same rule as matter-data aliases (`.claude/skills/matter-data/references/design-decisions.md` #65): a near match the search turns up is proposed, never recorded. Like every data field, it is held locally in clear and sent to the cloud only as a keyed hash (`source/legal/mcp/src/practice/ops.ts`). The contacts spec §4.1 gets a one-line note naming this field when it is built. The search does not read matter-data's `participant_aliases`. When two contacts turn out to be one, they are joined by the contacts spec's route (re-point the roles and affiliations, delete the spare), never by the search.

## 4. Matching rules

A pool contact matches a subject when any of the following holds. Each hit says which one.

1. **Names, by #66's rules** (`design-decisions.md` #66, `case_data__resolve_participant`), applied to the contact's name and each of its `other_names` against the subject's name and each of its other names:
   - exact first, ignoring case and accents, on the whole name, an other name or the surname;
   - then a surname within edit distance 2, only under #66's limits (both surnames at least four letters, and the distance under half the shorter one's length), labelled `near` with its distance;
   - given names exact or by initial, never fuzzed, and a given name on both sides must agree;
   - an organization by its whole name, an other name, or one of its words of four letters or more, exactly, after the normalization `contact_lookup` uses for `near` (contacts spec, tool table: lower case, punctuation and corporate suffixes such as Ltd., Inc. and LLP removed).
2. **Email:** any address in the subject's list equals any in the contact's `emails[]`, after trimming and lower-casing.
3. **Phone:** any number in the subject's list equals any in the contact's `phones[]`, after reducing both to digits and dropping a leading North American `1`.

Name rules apply only between contacts with the same `entity` tag (`person` against `person`, `organization` against `organization`). Email and phone match across types. The implementation reuses #66's matcher logic rather than writing a second one. Where that logic is Python in matter-data's tree and the search is TypeScript in the data server, the port must pass the same cases as #66's tests (§9).

## 5. What counts as a possible conflict

The firm's side is `client` and `prospective_client`. The adverse side is `opposing_party`.

- **Possible conflict:** a hit whose role on another matter is on one side while the subject's role on its own matter is on the other, in either direction. Examples: a former client now adverse, an adverse party now the client, a declined prospect now adverse.
- **Known to the firm:** every other hit, whatever the two roles are. That includes the same client again, an opposing counsel the firm has met before, or a former client who now appears as an expert. These are listed and not flagged.

A subject whose role on its own matter is neither side (for example opposing counsel) can only produce "known to the firm" hits. The search states possibilities only. It never says a hit is or is not a conflict, and it never mentions consent or the Code.

## 6. When it runs

1. **On request**, for any subjects the practitioner names.
2. **At matter opening**, when `upsert_client_matter` creates the matter's `client` roles. The subjects are the clients and every opposing party known at that point.
3. **Whenever a `client`, `prospective_client` or `opposing_party` role is proposed**, for example by `/ingest` under ADR 0009's "proposes the contact and its role in the same approval step". The results go into that same approval step, so the search costs no extra turn.

Unattended runs report their hits and stop. They never set the signal.

## 7. Output and record

1. **The tool** returns, for each subject, its hits, grouped as possible conflicts first and then known to the firm. Each hit carries: the contact, how it matched (§4, with `near` and the distance where so), whether it was found via affiliation (§2.5), and each other matter with its role, status and closing date. The working name is `practice_data__conflict_search`. It is read-only and is called through the `practice-data` skill, which owns it.
2. **The practitioner decides.** The session shows every hit and asks for the decision. Only on the practitioner's word does it:
   - set `conflict_check_completed` on the matter (`upsert_signal`), at matter opening or the first time it is not yet set; and
   - save a dated report in the matter's folder under the `CONF` code (`.claude/skills/file-naming/references/code-registry.md`, typical folder 2). The report lists who was searched and with which role, every hit as in item 1, and the decision in the practitioner's own words.
3. **A later run** (§6.3) saves a new dated report and leaves earlier reports alone. It does not change a signal already set. A new possible conflict there is shown in the approval step, and what follows is the practitioner's call.
4. The report is a file Probanda creates, so Commandment 7 does not restrict writing it.

## 8. Where it runs, and constraints that must still hold

- **The search and its classification run locally, as Cross Data under Exception 1.** The cloud holds names, emails and phones only as keyed hashes, which edit distance and normalization cannot work on, and reads must work offline. This follows L2 and L4 of `docs/Plans/2026-10-14_practice-db-conversion.md`. The `matter_role` and `affiliation` links it reads are links a local read needs, so they are local Cross Data under decision 5 of that plan.
- The search sees only what this machine's `practice.db` holds, because item data never leaves the machine that wrote it (contacts spec §2).
- No subject's details leave the machine, and nothing is written to the cloud by the search itself. The only cloud write is the practitioner-approved signal.
- A near match is a search result, never an identity. Two contacts are merged, or an other name recorded, only on the practitioner's approval (§3).
- matter-data is not read or written by the search (ADR 0009).
- Prose points down only: everything here lives in `legal`.

## 9. Implementation plan

1. Verify against HEAD (§11) and append a verification table to this spec.
2. Add `other_names[]` to the `contact` item and its approval rule, and add the one-line note to the contacts spec §4.1.
3. Write the matcher (§4) in the data server, ported from #66's resolver, with unit tests that replay #66's cases plus the email and phone rules.
4. Write the search and classification (§2, §5) and the `practice_data__conflict_search` tool (§7.1), with unit tests for: each role pair in §5 in both directions, the own-matter exclusion, closed and declined matters, one-step affiliations both ways with no second step, and other names.
5. Add the operation to the `practice-data` skill: the ask, the signal write and the `CONF` report (§7.2 to §7.3).
6. Call it from matter opening and from each approval step that proposes one of the three roles (§6.2, §6.3).
7. Build, check and release by the repo's own route (`CLAUDE.md`, "Releasing"). The version follows the version rule.

## 10. Decision record (Brahm, 2026-10-16)

| # | Question | Decision |
|---|---|---|
| 1 | Which role pairs are a possible conflict | Firm side (`client`, `prospective_client`) against `opposing_party`, either direction. Every other match is listed as known to the firm, unflagged |
| 2 | Which matters are searched | All, open, closed and declined, at any date, with status and closing date shown |
| 3 | How far affiliations are followed | One step, past and current, marked "via affiliation" with dates and title |
| 4 | Name-matching rules | #66's rules, plus exact normalized email or phone |
| 5 | Other names | An approved `other_names` field on `contact`. matter-data aliases are not read |
| 6 | When it runs | On request, at matter opening, and whenever a `client`, `prospective_client` or `opposing_party` role is proposed |
| 7 | What it records | Only on the practitioner's word: `conflict_check_completed` and a dated `CONF` report in the matter folder |

Options rejected: flagging only the pairs in 1 and hiding other matches (hides an opposing expert who is a former client); flagging every match (buries the real conflicts); a cut-off in years (a former client's duty does not lapse); current affiliations only, or two steps; exact names only, or fuzzed given names; reading each matter's matter-data aliases (slow, and ties the two stores together); running only on request or only at opening (misses a party who joins mid-file); keeping no report.

## 11. Verify against HEAD before building

- The contacts spec's `contact`, `affiliation` and `matter_role` kinds exist in `cloud/items/rules.sql` and the data server. On 2026-10-16 none did.
- `contact_lookup`'s normalization, to reuse it for organization names.
- `conflict_check_completed` is still the signal key, and `prospective` and `declined` still depend on it.
- #66's matcher rules and tests, to port them unchanged.
- `upsert_client_matter` is still where a matter's client roles are created.
- `CONF` is still the registry code and folder for an approved conflict search.
