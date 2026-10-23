# Knowledge trees — grammar, indexes, overlay, record contract and confirmation

This file is the single source of truth for **how the per-skill knowledge trees and the per-firm overlay are laid out, looked up, merged, recorded and confirmed**. Its readers are every skill that owns a tree (`/draft`, `/publish`, `/assemble`, `/legal-research`, the `docket-clerk` agent), `/localize` and its helper, and the runtime's `knowledge__*` and `sources__*` tools. Those components reference this file and do not restate it. It has no `SKILL.md` and is never wrapped. It ships only inside the litigation `.plugin`'s `skill-source/` mirror.

The layout block that opens a `/draft` type file and a `venue.md` is `shared/declared-layout.md`. The format block that opens a `/publish` physical-format file is `shared/declared-format.md`.

Provenance: spec `Engineering/1. Design/2026-09-24_draft-generalization-and-localize-spec.md` §2 and §4.6, as amended on #1047 (2026-09-25).

## 1. Vocabulary

- **Shipped tree.** A skill's tree as it ships in the plugin.
- **Overlay.** The firm's own additions and confirmations, kept beside its matter data.
- **Learned file.** Carries `learned_by: agent` in its header. Every knowledge file is learned. At each firm, each cited item is tagged `[unverified: ...]` on a mockup, and blocks the filed render, until that firm's own sidecar reads confirmed or corrected for it with a matching passage hash. A maintainer's review adds `reviewed_by` and `reviewed_on` to the header as provenance only, and lifts no tag and no refusal.

## 2. Roots

Each skill has its own tree. There is no shared tree.

| Skill | Shipped root | Overlay root | Holds | Reader |
|---|---|---|---|---|
| `/draft` | `draft\references\` | `_practice\knowledge\draft\` | `venue.md`, per-kind type files with their layout block, `Sources\` excerpts | `/draft`, and the runtime at Writing creation |
| `/publish` | `publish\references\` | `_practice\knowledge\publish\` | a venue physical-format file, per-kind form-identity files | `publish-general` (physical format), the bespoke subskills' source check (form identity) |
| `/assemble` | `assemble\references\` | `_practice\knowledge\assemble\` | a per-venue binding-practice file, per-kind binding deltas | none yet |
| `/legal-research` | `legal-research\references\` | `_practice\knowledge\legal-research\` | `sources.json` per jurisdiction and per venue, `Sources\` publisher maps, no `Documents\` | `legislation-fetcher` |
| `docket-clerk` (agent) | `shared\docket-clerk\references\` (its existing references) | `_practice\knowledge\docket-clerk\` | period files | none yet |

- Overlay roots sit under `<case_data_root>\_practice\knowledge\`.
- The shipped layer of a skill is the root the runtime's shipped-root resolver serves for it: the installed plugin's `skill-source/` mirror when the skill is in it, otherwise the checkout.
- `/publish`'s tree holds no layout contract, output-folder code or file name, period, fee, binding or filing practice, per-form caption rule, or template binary. A per-venue `.dotx` template exists only beside a bespoke filler.
- `/assemble`'s script contracts stay beside their subskill, outside the tree.
- `/legal-research`'s tree records where law is published and is never a statement of law. A paid subscription is recorded in the overlay only.
- `/localize` writes no `/assemble` file until that tree has a reader, and no `/legal-research` file. `legislation-fetcher` writes that tree's publisher maps.
- A skill may **read** another skill's tree. `assemble-bcca-book` reads the BCCA page cap from `/draft`'s tree. No tree is ever written on another skill's call.

## 3. Folder grammar

Inside each shipped root, and each overlay root, at fixed depth:

```text
<Country>\<Jurisdiction>\venues.json
<Country>\<Jurisdiction>\<Venue>\venue.md                          (/draft tree only)
<Country>\<Jurisdiction>\<Venue>\format.md                         (/publish tree only)
<Country>\<Jurisdiction>\<Venue>\Documents\kinds.json
<Country>\<Jurisdiction>\<Venue>\Documents\<kind>.md
<Country>\<Jurisdiction>\<Venue>\Sources\<excerpt>.md
<Country>\<Jurisdiction>\<Venue>\Locations\<unit>\[<sub-unit>\]    (optional)
<Country>\<Jurisdiction>\<Venue>\Judges\<judge>\                    (optional)
<Country>\<Jurisdiction>\_NoVenue\Documents\...
<Country>\<Jurisdiction>\_NoVenue\format.md                         (/publish tree only)
```

- **Country** is the three-letter ISO code (`CAN`, `USA`). **Jurisdiction** is the province or state code (`BC`, `CA`, `NY`), or `FED` for federal courts and tribunals.
- **In `/legal-research`'s tree only**, the third segment may also be a locality, for a municipal publisher's map: `legal-research\CAN\BC\<City>\Sources\<publisher>.md`, the city written by the name-characters rule below. This is a documented reading for that tree, not a grammar change.
- **Venue** is the official neutral-citation code where one exists (`BCSC`, `BCCA`, `BCPC`, `BCCRT`, `SCC`, `FC`, `FCA`, `TCC`, `CHRT`). For the United States it is the Bluebook-style code with punctuation removed (`SCOTUS`, `NDCal`, `CA9`). Where no standard code exists, it is the full official name with each space made a hyphen, as with `Vancouver-International-Arbitration-Centre`. Never invent an abbreviation and never use a generic name such as "Supreme Court".
- **Name characters.** A tree folder or file name holds only letters, digits, `.`, `_` and `-`, in the shipped tree and the firm overlay alike, because the plugin upload validator rejects any other character in an archive path (e45186c). Where a venue's code is its full official name, each space becomes a hyphen; the spaced name stays in the venue row's `name` (Brahm on #1113, 2026-09-25).
- **Reserved folder names** are `Documents\`, `Locations\`, `Judges\` and `Sources\`.
- `Sources\` holds excerpts cut at sub-paragraph pinpoint, and only for rules a file may need to quote. In `/legal-research`'s tree it also holds publisher maps: where an official publisher puts an instrument's text, its URL patterns and its "current to" marker, and never any text of an instrument.
- `Locations\` holds whatever local unit the venue uses (county, division, registry, courthouse), may nest, and records which kind of unit each folder is. It is left out where a venue has one location. `Judges\` exists only where a venue has judge-specific standing orders.
- `venue.md` and `format.md` are files, not folders.
- **`_NoVenue`** is the only member of the reserved `_` prefix. `Locations\`, `Judges\` and `venue.md` are refused under it.
- **The venue test.** A recipient is a venue when it prescribes the form or procedure of the document sent to it: published rules, a prescribed form, or a filing deadline of its own. Under this test the Civil Resolution Tribunal, the BC Human Rights Tribunal, CRA Appeals, the BC Office of the Information and Privacy Commissioner and a regulator with a published intake form are venues. Opposing counsel, an unrepresented party, a ministry and the police are `_NoVenue`. For a borderline body, the calling skill asks the practitioner once, and the answer is recorded in the jurisdiction index (section 4).
- **Correspondence addressed to a forum** is that venue's own kind, never `_NoVenue`.
- **The `_NoVenue` jurisdiction** is the one whose conduct rules govern the writer for the matter. The calling skill passes it and never infers it. A jurisdiction-independent kind such as `internal-memo` still sits under the writer's jurisdiction.
- **`_NoVenue` kinds are keyed by audience:** `letter-to-opposing-counsel`, `letter-to-opposing-party`, `letter-to-witness`, `letter-to-expert`, `letter-to-public-body`, `letter-to-non-party` and `internal-memo`. `non-party` is the catch-all: any recipient that is not the client, not a venue and not covered by another audience. A letter's document types (a demand, a notice of default, a settlement letter, a service cover letter) are sections inside its audience file. A `_NoVenue` document that is not a letter gets its own type file under an existing audience, because each type file carries one layout block. A settlement release is `release.md` under `opposing-party`, the releasee, even when it goes through opposing counsel.
- **A letter to the client is drafting guidance only.** It has no kinds-index row, never enters a tree lookup and never becomes a Writing.

## 4. Index files

Index files are JSON. Callers never parse one. They read the merged view the runtime returns (section 7).

**Alias shape**, everywhere: `{ "name", "source": "official" | "practitioner" | "agent", "ref", "recorded" }`. `ref` is a source URL, a matter, or a repo-run marker. A shipped row may omit `source`, `ref` and `recorded`, because the commit is its provenance. Aliases are per skill tree, so an answer recorded in one skill's tree is unknown to another's.

**Jurisdiction index.** `venues.json` in each jurisdiction folder: `{ "jurisdiction", "name", "venues": [...], "not_venues": [...] }`.

- A venue row holds `code` (the folder name), `name` (the full official name) and `aliases`, with optional `source`, `ref` and `recorded`.
- A `not_venues` row records a practitioner's venue-test answer for a borderline body: `name`, `aliases`, `resolves_to: "_NoVenue"`, `source: "practitioner"`, `ref` (the matter), `recorded`, and an optional `note`. A resolve that hits it returns `_NoVenue` with the row attached, so the question is not asked again.
- The `_NoVenue` row is never stored. The runtime adds it to the merged view with `reserved: true`, and every forum picker skips it.
- `/legal-research`'s tree adds a `sources.json` beside `venues.json` and inside each venue folder.

**Kinds index.** `kinds.json` in every `Documents\` folder: `{ "kinds": [ { "file", "name", "aliases", "recipient" } ] }`. A row's `file` is the type file's name without `.md` (`letter` for `letter.md`).

- `recipient` appears only under `_NoVenue`. It holds the audience key: `opposing-counsel`, `opposing-party`, `witness`, `expert`, `public-body`, `non-party` or `internal`. Several files may share one recipient.
- Under a real venue an alias belongs to one kind only. Under `_NoVenue` a shared alias ("demand letter") is listed on each audience kind, and the caller's `recipient` picks among them.

**Overlay index files.** The overlay writes `venues.local.json` and `kinds.local.json` at the same relative positions, and never a file named `venues.json` or `kinds.json`. A venue or kind learned only in the overlay is a full row. An alias or a `not_venues` ruling for a shipped venue or kind is a partial row keyed by `code` or `file`, attached to the shipped row by the merge.

**Index writes** are one row at a time, validated, and upserted under a lock file. A write is refused for a duplicate alias, for an alias equal after normalization to any code, file name or official name, and for a `name` on a code the shipped tree already holds.

**Writer's stamp on a row.** Every index row an overlay write saves carries the writer's `plugin_version` and `shipped_from`, which the runtime stamps on that row. Lawyers sharing one overlay may run different plugin versions, so the stamp belongs to each row rather than the file, and each row keeps the stamp of the write that last saved it. A `_hosts.json` entry carries no stamp. A caller that passes either field in a row is refused. An alias carries no stamp of its own, because the row is the write unit. The read accepts the two fields in either layer and leaves them out of the merged view. A row written before the stamp carries neither, and a shipped row normally carries neither, because the commit is its provenance; a promoter may strip them. A row records no `matter` or `learned_by`: the `source` and `ref` on the row or its aliases already carry those.

## 5. Resolve

`knowledge__list` takes `resolve: "<name as given>"` and matches it against the merged index. The match is deterministic and runs in the runtime. No model judges a near miss.

- **Normalization.** Unicode NFKC, case-fold, keep only letters and digits, drop a leading "the". Equality with any code, official name, alias or `not_venues` name returns `resolved`.
- **Candidate rules.** Otherwise three rules run, and each candidate names the rule that found it:
  1. **Jurisdiction affix** (venues only): the name equals a code with the jurisdiction code removed from its front or back (`CRT` against `BCCRT`), or the name with the jurisdiction code prefixed equals a code.
  2. **Acronym:** the name equals the initials of the official name's capitalized words, with or without the jurisdiction code.
  3. **Token containment:** after stopwords are removed, every token of one name appears in the other. Venue stopwords: "court", "tribunal", "of", "the", "british columbia". Kind stopwords: "of", "the", "form". A name left with no tokens yields no candidate under this rule.
- **No edit distance.** `BCSC`, `BCCA` and `BCPC` differ by one character.
- **Results.** Zero candidates returns `not_found`. One or more returns `near_miss` with `candidates: [{code, name, rule}]`. The same alias on two codes returns `ambiguous` with `alias_split`, except under `_NoVenue`, where the recipient decides.
- A `_NoVenue` resolve without `recipient` is refused.

## 6. Overlay layout

The overlay root is `<case_data_root>\_practice\knowledge\`. Beside the per-skill folders it holds a fixed reserved set of four entries, and nothing else:

- `_superseded\<same path>`: where a retired file and its sidecar are moved.
- `_inbox\`: where a practitioner saves a copy of a source after a failed fetch.
- `_fetched\<host>\<first 12 hex characters of the sha256>.pdf`: fetched PDFs, kept while an excerpt records their hash.
- `_hosts.json`: the firm's approved fetch hosts, one `{host, category, page_url, added, approved_by: "practitioner"}` per entry. An entry missing `category` or `approved_by` is ignored. It is written only through `knowledge__write` at this path, one host at a time, after the practitioner's yes to a `host_not_allowed` refusal: the caller gives `host`, `category` (`venue`, `statute` or `regulator`) and `page_url`, and the runtime stamps `added` and `approved_by`. A repo run never writes it.

`case_data_root` is the per-user `probanda.json`'s key. When that file is absent, a `knowledge__read` or `knowledge__list` given `matter_root` derives the root from that matter pointer's `case_data_dir`. For the matter's own `0. CASE DATA` it is the `0. CASE DATA` folder beside the matter folder. Otherwise it is the folder's parent, taken only when it is a `0. CASE DATA` folder (or the folder `COCLERK_CASE_DATA_ROOT` names). Either must exist, and otherwise the missing-file error stands. A present per-user file always wins. `knowledge__write` and `knowledge__retire` never fall back.

A confirmation sidecar sits beside the knowledge file it confirms (section 10).

The only deletion anywhere in the overlay is of a `_fetched\` PDF that no excerpt references any more.

## 7. Merge on read

`knowledge__read` and `knowledge__list` return the shipped and overlay layers merged.

- **Files.** Per file, the shipped file wins. The read reports `shadowed_local: <path>` with `identical: true | false`, compared after line endings are normalized.
- **Index rows** merge by key (`code` or `file`). The shipped `name` and fields win and aliases are unioned. Each row and alias carries `layer: shipped | local`, and the view carries `conflicts`. A local `name` differing from a shipped one arises only when a plugin update ships a code the firm had already learned, and is reported as `shadowed_local`.
- **Corrections.** A firm correction overrides one item of a shipped file for that firm, and is disclosed on every read, as `shadowed_local` is.
- The calling skill relays `shadowed_local`, `conflicts` and corrections to the practitioner once per session.

## 8. Record contract

Every learned file follows this contract.

- **Header.** `learned_by: agent`, `accessed`, the triggering matter or a repo-run marker, `reviewed_by` and `reviewed_on`. An overlay file also records the writer's plugin version and `shipped_from`. `verified` is not used. The overlay is shared across matters, so a matter is recorded by its file number, such as `1234.L####`, never its style of cause or a party's name. The runtime looks the caller's `matter` up in practice data and stamps that matter's own number (`L####`), never the caller's string. A value that is not the number of exactly one matter is refused with `matter_unknown`.
- **Per item.** A stable `rule_ref`, the item's verbatim passage, and its source reference. A `rule_ref` is unique across a file and the source records its `sources:` list names. A source record holds the items of one page or document. A dependent file (`venue.md`, a `Documents\` file) holds the items of its named records by reference: it cites a `rule_ref` in its layout or format block (`shared/declared-layout.md` §7, `shared/declared-format.md`) and by name in prose, and never restates a record's item in its own `items:`. A dependent file's own `items:` are only those with no record to sit in, sourced `source: practitioner`. `/legal-research` material in a dependent file stays in prose. The file holds **no status**. Status lives only in the sidecar.
- **Per source record.** `page_url`, an optional `pdf_url`, `accessed`, `checked`, `currency_marker_pattern`, `currency_marker` and `fetch_note`. A PDF adds its sha256 as `pdf_sha256`. A page gets no hash. A practitioner's saved copy is named to `knowledge__write` when its source record is written: a PDF gets `pdf_sha256` from the runtime and is copied from `_inbox\` into `_fetched\`, the original staying in `_inbox\`, and any other file stays in `_inbox\` unhashed.
- **Items transcribed from a PDF or from a practitioner's saved copy** add `checked_by: file_sha256`. A PDF item adds its page number. Its `fetch_note` reads `"excerpt transcribed from PDF; not machine-verified"`, `"saved by practitioner; live fetch failed: <detail>"` or, for the published form a practitioner layout copies (`/localize`'s `practitioner_layout`), `"saved by practitioner; form copy for a practitioner layout"`.
- **BC Laws sources** record the fields `docket-clerk` keeps for each enactment it verifies: `currency_date`, `last_amending_reg`, `pit_watermark` (or, for an enactment with no point-in-time table, its table of legislative changes), `pending_changes`, `last_checked` and the CiviX document ids. A BC Laws source has "changed" only when the amending instrument or the point-in-time watermark moves, never on `currency_date` alone.
- **Naming sources.** A source record carries its fields in its own front matter. A dependent file (`venue.md`, a `Documents\` file) carries `sources:`, a list of paths relative to itself. `source_urls:` is not used.
- **Admitted sources.** The venue's own publications (its guides tagged `guidance`), the official statute publisher, the regulator's own code for `_NoVenue`, the practitioner (`source: practitioner`), and a recorded `/legal-research` output (`source: legal-research` with its record reference). Nothing else. Where no admitted source exists, `/localize` returns `no_official_source`.
- **Periods.** A period's computable value lives only in `docket-clerk`'s tree. Any other tree may hold verbatim source text and fixed form wording, and never uses it to compute or state a date.

## 9. Write targets and promotion

- A Claude Code session whose working folder is the Probanda development repo, on the maintainer's explicit instruction, writes the **shipped tree**. The helper writes nothing, because `knowledge__write` refuses the repo-run marker: it returns each candidate's intended path and full text. The session writes them to its scratchpad and moves them into the skills tree after the practitioner's review, in the same step as the commit. The helper never commits. The reason is review before packaging.
- Any other session with a live matter writes only the **overlay**.
- A session with neither refuses.
- **Promotion** of an overlay file into the shipped tree is an ordinary commit. A promoted file ships learned and unconfirmed. When the practitioner checks every item at promotion review, the commit adds a reviewer line, `reviewed_by` and `reviewed_on`, to the header and keeps `learned_by`. The review confirms no item for any firm: each firm's tags, refusal and notice lift only on its own sidecar (sections 10 and 11).
- A file carrying a correction is not promoted until the correction is reconciled.
- The promoting firm's overlay original is not retired at promotion.
- A promotion reaches install users only at the next plugin release.

## 10. Confirmation sidecar

- **Path.** `<file>.confirmations.local.json` beside the knowledge file, at the mirrored relative path, in the overlay only. `knowledge__write` reserves the suffix for `confirm` and `correct` and refuses it on `create`. A shipped file with the suffix is refused at packaging. Sidecars are never promoted.
- **Shape.**

  ```json
  { "file": "<path>", "items": [ { "rule_ref": "<ref>", "status": "confirmed | corrected", "by": "<person key>", "on": "<date>", "confirmed_against": { "passage_hash": "<sha256>", "currency": "<marker>" }, "value": "<corrected only>", "plugin_version": "<version or null>", "shipped_from": "install | checkout" } ] }
  ```

  No row means unconfirmed. `value` appears only on `corrected`. A row carries no `source` field, because `corrected` implies the practitioner as source.
- **`plugin_version` and `shipped_from`** are the confirming machine's, stamped by the runtime on each row, because the passage hash binds to the copy that machine was served and lawyers sharing one overlay may run different versions. A row written before the stamp carries neither. A row records no `matter` or `learned_by`: `by` and `on` say who confirmed and when.
- **Writes** are row-level upserts under a lock file, so two confirmations of different items both land.
- **`by`** is the confirming machine's `person` roster key, which the runtime reads from that machine's `probanda.json` when the write runs. The caller never passes it. The key is stored, not the name, because roster entries are never deleted.
- **Only a roster lawyer confirms or corrects.** The runtime checks the key's role against the firm roster at write time and refuses a `staff` key. Staff may prepare and present the mockup. The reason is that a confirmation lifts the filed refusal, which is professional reliance.
- **`person` unset.** The write refuses with a hard error naming the missing key. The calling skill asks once, writes the key through `practice_data__upsert_firm_profile`, and calls again.
- **Matter sessions only.** Confirmation always happens in a matter session. A repo-session `confirm` or `correct` refuses.

**`corrected` values.** A `corrected` row's `value` replaces the item at its own `rule_ref`, in the shape that tree's file contract declares for that item. At write time the `rule_ref` must exist in the merged file and the value's type must match the item's kind. The runtime then substitutes the value into the merged file and runs that tree's validator, failing hard.

- `/draft` type files and `venue.md`: the shapes in `shared/declared-layout.md`.
- `/publish` physical-format files: the shapes in `shared/declared-format.md`.
- `docket-clerk` periods: length, unit, trigger anchor and reckoning class, validated by that tree's period schema. A period's value is never returned to another skill's session.
- Not correctable: a `Sources\` excerpt, whose wrong passage is fixed by `refresh`, and any item that carries no `rule_ref`.

**Effective status at read.**

- A row applies only while its `rule_ref` exists and its passage hash matches the current passage. Otherwise the item reads `unconfirmed` and is reported as `stale_confirmation`.
- A row whose `rule_ref` has vanished is reported under `orphaned_confirmations`. Nothing deletes it.
- A currency marker that moves while the passage stays identical is reported as `currency_moved`, and the row does not lapse.
- A correction stays in force across a passage change and is never reverted, but the change is reported.
- The read also consults the session's memoized `sources__check` result. An item that result reports missing reads `unconfirmed` for the session. With no result, or a `gap`, the sidecar status stands with "freshness not verified".

## 11. The learned-file notice

The calling skill shows this notice in its first message after `/localize` returns `created`, and then once per session on each load of a learned file. It is filled from header fields only:

```text
Note: the {venue} requirements for {document kind} used here were learned by an agent on {accessed} from the venue's published sources and have not been reviewed by a practitioner; unverified items are tagged on the mockup.
```

For a file whose header names `reviewed_by` it reads:

```text
Note: the {venue} requirements for {document kind} used here were reviewed by {reviewed_by} on {reviewed_on}, but this firm has not yet confirmed or corrected every item; confirm each item before relying on it.
```

At each firm the notice stops only when every item of the file reads confirmed or corrected in that firm's own sidecar. Neither promotion nor a maintainer's review stops it: every item reads `unconfirmed` until the firm confirms or corrects it.
