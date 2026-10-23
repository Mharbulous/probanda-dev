# Spec: Firm-wide contacts in practice data

Status: proposed, 2026-10-16. Implements `docs/ADRs/0009-firm-wide-contacts-in-practice-data.md`.
Cloud: applied and deployed, 2026-10-16. `cloud/items/rules.sql` with the `contact`, `affiliation` and `matter_role` kinds is applied to `nbzkuhgiqscjkypedqff`. `check_items.mjs` checks 9a to 9c pass against the deployed `items-write`: a client and matter written with a client contact and its `matter_role`, an affiliation, and the refused delete of a linked contact.
Plugin: `legal` only. Paths and line numbers were read at HEAD `68bcd7a` unless marked **UNVERIFIED**.
Glossary terms used: **Contact**, **Affiliation**, **Matter role**, **Client account**, **Counsel of record**.
Out of scope: the conflict search, which gets its own spec.

---

## 1. Problem

Contact details are copied into each matter's case-data `parties` row. The same lawyer on three files is three unlinked records that drift, and nothing ties a party across matters. ADR 0009 moves contacts into practice data. This spec says what to build.

## 2. Evidence

- Case-data holds contact details per matter: `parties.contact_info`, the `lawyer_*` columns and `address` (`.claude/skills/case-data/references/design-decisions.md` #55). `parties.party_type` is one of `individual`, `corporation`, `partnership`, `other` (`.claude/skills/case-data/references/schema.sql:247-248`).
- Practice data is an item store. The cloud holds each item's id, kind, state, tags and links in clear and each data field only as an HMAC keyed locally (`source/legal/mcp/src/practice/ops.ts:88-133`). A link maps one role to one item id.
- The cloud rulebook declares kinds in `cloud/items/rules.sql` in the tables `rules.kind`, `rules.vocabulary`, `rules.tag`, `rules.link_role`, `rules.transition` and `rules.natural_key`. Per-kind functions are dispatched in `rules.write_op` (lines 1269-1278). A refusal goes through `rules.refuse(question)` and returns `{saved: false, question}`.
- A natural-key part is `<tag|link|hash>:<name>` with a mode: none (required and equal), `?` (equal, no value matching no value) or `*` (compared only when the op has a value) (`rules.sql:80-86`).
- The plugin keeps no list of kinds. Every read filters by `item.kind` (`source/legal/mcp/src/practice/items.ts:42-46`), and sync stores an item of any kind unchanged (`source/legal/mcp/src/practice/store.ts:227-242`).
- Item data never leaves the machine that wrote it. A second machine sees only what its `practice.db` holds (`store.ts:233-241`).
- `rules.seed` refuses a tenant that already holds items (`rules.sql:1593-1596`), so it cannot serve a backfill.
- No practice tool reads case-data today. The pattern for a read is to spawn a case-data script, as `source/legal/mcp/src/case/parties-of-record.ts` spawns `parties_of_record.py` (#56). No existing script lists every party with its `party_id`: `get_matter_profile.py` omits the id, and `parties_of_record.py` works per file number.
- A matter is open when its state is not `closed` (`source/legal/mcp/src/tools/practice/reads.ts:289`).

## 3. Goal and non-goals

Goal:
- one `contact` per person or organization, tied to organizations by `affiliation` and to matters by `matter_role`;
- who the client is comes from the matter's `matter_role` items tagged `client`;
- every new party or counsel is proposed as a contact at ingest;
- existing matters are backfilled once, with approval;
- two checks report the gaps.

Non-goals: the conflict search and what counts as a conflict; any case-data DDL; witnesses and tribunal members, who stay in case-data; writing to the CardDAV address book; changing counsel of record.

## 4. Design

### 4.1 Item kinds in `cloud/items/rules.sql`

All three kinds are in store `practice` with `has_state` false, so they have no state and no transitions.

**`contact`**
- `rules.tag`: (`contact`, `entity`, `vocab`, required). `rules.vocabulary`: `entity` is `person` or `organization`.
- No links.
- Data, local in clear and hashed in the cloud: `name` (required), `emails[]`, `phones[]`, `addresses[]` (the address shape `contacts__get` returns), `other_names[]` (added 2026-10-16 for `merge_contact`, 4.2), `carddav_url?`, `note?`.
- `rules.kind_contact`: on create, refuse when `hashes.name` is null, asking "What is the name of {{item:%s}}?"
- No natural key. Two people can share a name and two contacts can share an office email, so whether two records are one contact is the practitioner's decision (4.5, 4.6), never an automatic upsert match.

**`affiliation`**
- `rules.link_role`: (`affiliation`, `person`, `contact`, required, synced) and (`affiliation`, `organization`, `contact`, required, synced).
- Data: `from?`, `to?`, `title?`.
- `rules.kind_affiliation`: refuse when the `person` target is not tagged `entity` = `person`, asking "Is {{item:%s}} a person?", and when the `organization` target is not tagged `organization`, asking "Is {{item:%s}} an organization?" The question asks about the item and states no rule (Commandment 6).
- Natural key: `upsert`, rank 1, `array['link:person', 'link:organization', 'hash:from?']`. Re-entering the same tie is idempotent, and a lawyer who returns to an earlier firm gets a second affiliation with a new `from`.

**`matter_role`**
- `rules.link_role`: (`matter_role`, `matter`, `matter`, required, synced) and (`matter_role`, `contact`, `contact`, required, synced).
- `rules.tag`: (`matter_role`, `role`, `vocab`, required). `rules.vocabulary` for `role`: `client`, `prospective_client`, `opposing_party`, `opposing_counsel`, `co_counsel`, `expert`, `adjuster`, `referral_source`.
- Data: `from?`, `to?`, `note?`, `case_party_id?`, `case_proceeding_id?`.
- Natural key: `upsert`, rank 1, `array['link:matter', 'link:contact', 'tag:role', 'hash:case_proceeding_id?', 'hash:case_party_id?', 'hash:from?']` (amended 2026-10-23 for counsel history, case-data design decision #72). Proposing the same role twice is idempotent, and one contact can hold the same role in two proceedings of a matter, for two parties, or for a second period with a new `from`.
- An ended role keeps its item with `to` set. Nothing is deleted when a matter closes.

No existing kind changes. `matter` gains no required link or tag, and `client` keeps all its data, `name` included, as the account label. `rules.seed` is unchanged.

### 4.2 Tools

Each is a `practice_data__*` tool, defined in `practiceToolDefinitions()` (`source/legal/mcp/src/schema-gen.ts`), routed in `source/legal/mcp/src/tools/practice/index.ts`, with writes in `writes.ts` and reads in `reads.ts` beside it. Every write goes through the existing store path (pending, cloud, `applySaved`). `entity` and `role` are plain strings in the schema, with no enum: the vocabulary lives in the cloud rulebook (Commandments 4 and 5), and a wrong value comes back as the cloud's question.

| Tool | Input | Does |
|---|---|---|
| `upsert_contact` | `id?`, `entity`, `name`, `emails?`, `phones?`, `addresses?`, `carddav_url?`, `note?` | Creates a contact, or updates the one named by `id`. Returns `{contact_id, created}`. |
| `upsert_affiliation` | `id?`, `person_id`, `organization_id`, `from?`, `to?`, `title?` | Writes one affiliation. |
| `upsert_matter_role` | `id?`, `matter` (resolved as `matter_lookup` resolves it), `contact_id`, `role`, `from?`, `to?`, `note?`, `case_party_id?`, `case_proceeding_id?` | Writes one role. |
| `contact_lookup` | `id?` or `query?` (a case-insensitive substring of name, email or phone), `limit?` | Local and offline. Returns each contact with its affiliations and its matter roles (matter number, role, from, to), plus `near`: contacts with the same normalized name (lower case, punctuation and corporate suffixes such as Ltd., Inc. and LLP removed) or a shared email or phone. |
| `contact_checks` | `matter?`, `matter_root?` | Runs the two checks in 4.4. Read only. |
| `merge_contact` | `keep_id`, `spare_id` | Merges a duplicate into the contact kept, deleting no information. Returns `{merged: true, contact_id, moved, combined}`, or `{merged: false, conflicts}` with nothing written. |

**Amended 2026-10-16: `merge_contact` replaces deleting the spare.** Practice data has no item delete that a tool exposes, and deleting a spare would lose its own emails, phones and addresses unless every caller copied them first. `merge_contact` makes that guarantee in code. In one write it:

- combines `emails`, `phones`, `addresses` and `other_names`, dropping exact duplicates, and adds the spare's `name` to `other_names` when it differs;
- keeps any field set on one side only;
- moves each matter role and affiliation of the spare to the kept contact, and combines a pair that would share an upsert key into the kept item;
- deletes the spare and the combined items.

When the two hold different values for anything else (`entity`, `carddav_url`, `note`, or a combined pair's `from`, `to`, `title`, `note` or `case_party_id`), it writes nothing and returns each difference, for the practitioner to settle with the upsert tools before merging again. The cloud refuses to delete a contact that any affiliation or matter role still points to (`rules.kind_contact_delete`), so a merge write that missed one is refused whole.

### 4.3 `upsert_client_matter`

- New optional input `client_contacts`: an array whose elements are either `{contact_id}` or the `upsert_contact` fields of a new contact.
- When it is given, the same cloud write carries, after the `client` and `matter` ops, one `contact` op for each new contact and one `matter_role` op (`role` = `client`, `from` = today) for each element. Because it is one write, the matter and its client roles are saved together or not at all.
- When it is absent and the matter is created, the tool saves as today and also returns `client_role_ids: []` and `question: "Who is the client on this matter?"`.
- The return gains `client_role_ids` in every case.
- The practice-data skill's matter-opening step always passes `client_contacts`. It asks the practitioner who the client is, offering existing contacts from `contact_lookup` and pre-filling a new one from `contacts__search` on the client name.
- `client` data is unchanged, and a caller that omits the input gets today's behaviour.

### 4.4 The two backstop checks (`contact_checks`)

1. **Open matter with no client role.** Each `matter` whose state is not `closed` and which has no `matter_role` tagged `client` whose `to` is empty or later than today. A practice-data read only.
2. **Case-data party with no matter role.** For a matter with a case-data folder, found from `matter_root` through `locate_case_data_dir` (`source/legal/mcp/src/case/backend.ts`), each `parties` row whose `party_id` is not the `case_party_id` of a `matter_role` on that matter.

Check 2 reads parties through a new read-only script, `.claude/skills/case-data/references/scripts/list_parties.py`, spawned on the #56 pattern. It prints every `parties` row as JSON: `party_id`, `name`, `party_type`, `lawyer_name`, `lawyer_firm`, `lawyer_email`, `lawyer_phone`, `address`, `contact_info`, and the `proceeding_id`s and roles from `proceeding_parties`. It opens the database read-only and adds no table or column. Tests go in `.claude/skills/case-data/tests/test_list_parties.py`.

Output: `{matters_without_client: [{matter_id, matt_num, client_name}], parties_without_role: [{matter_id, party_id, name, party_type, proceeding_ids, lawyer_name, lawyer_firm}], unresolved: [{matter_id, matt_num, reason}]}`. Without `matter`, check 1 covers every open matter and check 2 every open matter whose case-data folder resolves.

As built (2026-10-16): with no `matter`, no `matter_root` is known, so a matter's case-data folder is the one child of the case data root whose name starts with its matter number and holds `main.sqlite`, as `locate_case_data_dir`'s own fallback matches it. A matter with two such folders, or no matter number, or a database check 2 cannot read, is listed in `unresolved` with the reason rather than guessed.

Callers: the executive-assistant morning briefing shows the two counts; the backfill (4.5) uses the output as its worklist; `/ingest` runs check 2 for its matter at the end of a run.

### 4.5 One-time backfill

A new skill file, `.claude/skills/practice-data/operations/contacts-backfill.md`, linked from the practice-data `SKILL.md` for "set up contacts from existing matters". Its worklist is always the live output of `contact_checks`, so a stopped run resumes where it stopped and a second run finds only the parties the practitioner skipped.

1. Run `contact_checks` across every open matter. Matters with no client role come first.
2. For each uncovered party, build candidates:
   - the party, with `entity` from `party_type` (`individual` gives `person`; `corporation` and `partnership` give `organization`; `other` or empty is asked);
   - where `lawyer_name` is set, a person contact for the lawyer, an organization contact for `lawyer_firm`, an affiliation between them, and an `opposing_counsel` or `co_counsel` role;
   - the proposed role of the party: `client` for the party the firm acts for, otherwise from its side in the proceeding, as a proposal for the practitioner to correct.
   Emails, phones and addresses are pre-filled from `contacts__search` and `contacts__get`. An existing `parties.contact_info` value is a pre-fill source only and is not changed.
3. Group likely duplicates across matters (the same normalized name, or a shared email or phone) and match each group against existing contacts through `contact_lookup`'s `near`.
4. Present one group at a time under `/show-me`, by the rule that governs aliases (#65, `.claude/skills/case-data/operations/participants.md` §Record): show the exact contact, affiliation and role items that would be written, each role with its matter, `case_party_id`, `case_proceeding_id` and proposed role. The practitioner approves, splits the group, changes a role, or skips. Nothing is written without a yes, and a yes covers exactly the items shown.
5. On a yes, write the contacts, then the affiliations and roles. A refusal's question goes to the practitioner as it stands.
6. Where a matched contact's details differ from the counsel of record, ask whether a notice of change was filed. Overwrite neither record.

Case-data is not written.

### 4.6 Ingest proposes the contact

Wherever case-data adds a party or counsel (`.claude/skills/case-data/operations/proceedings-profile.md` §3 and §4, and the new-party and counsel rows of `.claude/skills/case-data/operations/order-effects.md`), the existing confirmation table gains, for each party and each counsel, the proposed contact and its role. The contact is matched through `contact_lookup` (exact or near), or proposed as new with a CardDAV pre-fill. One approval covers both the case-data rows and the practice items shown.

On a yes, case-data is written first, to get the `party_id`, and then the practice items with `case_party_id` and `case_proceeding_id`. If the practice write is refused, the case-data rows stand, the question goes to the practitioner, and check 2 reports the gap until it is filled.

Neither file writes `parties.contact_info` any more, and existing values are left alone. The writable-surface table in `order-effects.md` drops `contact_info`. When a matched counsel contact's details differ from the counsel of record, the practitioner is asked whether a notice of change was filed (#55), and nothing is overwritten.

Case-data design decisions gain **#69**, "Contacts and their matter roles are practice data (ADR 0009)": `contact_info` is no longer written, and any write that adds a party or counsel proposes the contact and its role in the same approval step.

## 5. Constraints that must still hold

- Commandment 3: names, emails, phones and addresses stay on the User's Machine. The cloud gets HMACs and the Metadata (kind, tags, links). The cloud can see that matters share a contact, though not who it is; the ADR accepts this.
- Commandment 5: no local table, column or file per kind, tag or role. Items stay in `kv_store` namespace `item`. No role enum in plugin code.
- Commandment 6: each new refusal is a question about the item.
- Commandment 7: nothing here renames, moves or deletes a user file.
- Exception 2: no case-data DDL. Case-data gains one read-only script.
- Layering: everything ships in `legal` and names nothing in another plugin.
- Contact data lives in `practice.db` like every other item's data, so it is on a second machine only if that machine shares the same `practice.db`.

## 6. Options considered

The ADR records the design options. Within this spec, a natural-key upsert on a contact's name or email was rejected (4.1). A merge tool was first deferred in favour of deleting the spare, then built instead of it (4.2, amended 2026-10-16), because a delete loses the spare's own data.

## 7. Implementation plan

1. **Cloud.** In `cloud/items/rules.sql`, add the kinds, tags, vocabularies, link roles and natural keys, `rules.kind_contact` and `rules.kind_affiliation`, and their dispatch lines in `rules.write_op`. Add sections to `cloud/items/tests/scratch_test.template.sql`: create each kind; refuse a contact with no name, no `entity` or an unknown `entity`; refuse an unknown role; refuse an affiliation whose `person` link is an organization; refuse a role linked to a deleted contact; upsert the same role twice and get one item; the same role in two proceedings gives two items. Run them with `cloud/items/tests/build_scratch_test.mjs` and `supabase db query`. Deploy `ledger.sql` then `rules.sql` (`cloud/items/README.md`) and run `node cloud/items/tools/check_items.mjs`. The cloud goes first, so no new copy of the plugin is ever refused.
2. **MCP server.** The five tools, the `upsert_client_matter` change, `contact_checks` and `list_parties.py`. Tests: a new `source/legal/mcp/test/practice-contacts.db.test.mjs` (writes, lookup, near matching, both checks); the new names in `PRACTICE_TOOL_NAMES` in `practice-tools.unit.test.mjs`; the new upsert keys in `UPSERT_KEYS` in `test/helpers/fake-cloud.mjs`; and an old-copy test showing that a store holding the new kinds returns the same `matter_lookup`, `ar_data` and practice-board results as one without them.
3. **Skills.** The practice-data matter-opening step and `operations/contacts-backfill.md`; case-data `proceedings-profile.md`, `order-effects.md` and design decision #69; the executive-assistant briefing line; the end-of-run check in `/ingest`.
4. **Build and release.** `python scripts/build_plugin.py`, `python scripts/check_plugin.py`, `python scripts/check_layering.py`, `python scripts/check_publishable.py --new-since origin/main`, then `/release`.

## 8. Implementation criteria

- Every scratch-test row passes, and the live `check_items.mjs` passes after the deploy.
- `npm test` passes in `source/legal/mcp`, the old-copy test included, and `test_list_parties.py` passes.
- A matter opened through the skill has a client role, and `contact_checks` reports nothing missing for it.
- Ingesting a pleading that names a new party and counsel shows the contacts and roles in the same approval table, and after a yes check 2 reports no gap for that party.
- No case-data operation file writes `contact_info`.
- The diff holds no case-data DDL.

## 9. Settled questions

1. A co-party on the firm's side who is not its client, such as a co-defendant with other counsel, gets no role: the vocabulary gains no `co_party`. Check 2 keeps listing such a party, and the practitioner skips it.
2. ~~No merge tool is built, even after the backfill (4.2).~~ Reversed 2026-10-16: `merge_contact` is built, and no contact delete is exposed (4.2).

## 10. Release: patch

**`legal` 0.5.0 to 0.5.1.** No other plugin's built folder changes.

Under the CLAUDE.md version rule, a patch needs everything the user had working to keep working with no action, and an old copy and a new copy to be able to share the same data. Both hold here:

- The three kinds are new. An old copy syncs their items unchanged and ignores them on every read, because every read filters by kind (2).
- No existing kind gains a required tag or link, so the cloud accepts every write an old copy makes. A matter an old copy opens without a client role is reported by check 1, not refused.
- `client` keeps all its data, so an old copy's `client_name` still resolves.
- `upsert_client_matter` only gains an optional input, and no tool is removed.
- No setup step, credential or allowlist is added, and `requires` is unchanged.

If the build adds a required tag or link to `matter` or `client`, changes what `client` holds, or makes either check refuse a write, the release becomes a minor.
