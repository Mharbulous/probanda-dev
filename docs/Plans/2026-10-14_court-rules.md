# Plan: Court Rules — whole-instrument retrieval, Rule Library, commons rule text, note-up on reliance

**Status (2026-10-14).** Approved by Brahm. Nothing is built.

## Context

The design is recorded in `docs/ADRs/0001-court-rule-library.md`, `0002-court-rules-in-the-legal-commons.md` and `0003-note-up-court-rules-on-reliance.md`. The terms are those in `GLOSSARY.md`. This plan orders the work and gives each step a check that fails if the step is wrong. It states no law.

The trigger is Job 12. `sources__fetch` returns page text without link targets (`source/practice/mcp/src/sources/fetch.ts`, `htmlBlocks` drops every tag). So `legislation-fetcher` could not read the part links off BC Laws' contents page. It filed only `.../statreg/168_2009_01` and missed the Consolidation parts `_02`, `_03`, `_03_1`, `_04`, `_04_1`, `_05` and `_06`. The playbook rightly forbids guessing a part id, so the fetcher had no way to reach the other parts. Step 1 fixes this and ships on its own.

## Rules for every step

- **Source, then build.** Change `.claude/skills/` and `source/<plugin>/`, never `plugins/`. Bump `version` in `source/<plugin>/plugin.json` for each plugin that `python scripts/build_plugin.py --check` lists, run `python scripts/build_plugin.py`, commit and push. A push to `main` is the release. A change under `.claude/skills/shared/` bumps all five plugins.
- **Standing checks, every step:** `python scripts/build_plugin.py --check` is clean after the build, `python scripts/check_plugin.py` passes, `python scripts/check_layering.py` passes, and `python scripts/check_publishable.py --new-since origin/main` reports nothing new. Each step's own check is listed under it.
- **Layering.** `practice` names nothing above it. The note-up and the `court_rules__*` tools are in the `practice` data server, because `docket-clerk` (practice) calls them. `court-rules-clerk` and every commons tool are in `research`. A step that needs `practice` to reach the commons stops and returns the result to a `research` caller instead.
- **Commandments.** No SQL or schema DDL is committed (the cloud schema for Step 7 is built in Probanda's Cloud, not here). No maintainer path, matter number or client data goes into a file, a test fixture or a commit message. Test fixtures are synthetic pages on the `fixture.test` host, never BC Laws text. Commandment 5: the Rule Library is laid out by instrument (Venue, Rule Set, part), with no file per tag type or link role.
- **State no law.** No step's file, fixture or report says what a Court Rule provides.

## Step 1 — Fetch every Consolidation part (fixes Job 12). Release: `practice`, `research`

### 1a. Survey BC Laws' contents page and parts (no code)

Unchecked so far: whether each BC Laws part page prints a "current to" marker, and which page lists the parts. A local development session fetches, for B.C. Reg. 168/2009, the candidate contents pages (the bare id, `_00`) and each part `_01`, `_02`, `_03`, `_03_1`, `_04`, `_04_1`, `_05`, `_06`. It uses `curl`, because `sources__fetch` cannot return links yet. For each URL it records: HTTP status, whether the page prints a line matching the map's `currency_marker_pattern` (the line's wording and date only), and, for the contents page, the `href` form of each part link. It records no rule text.

The table goes into this plan file under "Survey result", in the same commit as Step 1b.

**Check:** the table has one row per URL above, each with a status and a marker of either "present: <line>" or "absent". A missing row, or a row with no marker, fails. The contents page row names the `href` pattern its part links share.

**Branch.** If every part prints a marker, Step 1c verifies each part on its own. If any part prints none, stop after 1b and bring the table to Brahm before writing 1c. The fetcher files nothing without a "current to" date, and the fix for a part with no marker of its own is his call.

### 1b. `sources__fetch` returns same-host link targets

In `source/practice/mcp/src/sources/fetch.ts`, add an optional `links: true` argument. With it, an HTML result also carries `links: [{text, url}]`: every `<a href>` whose resolved URL is `https` on the same host as `final_url`, with its fragment removed, deduplicated, in page order. `text` is the anchor's text, normalized as `htmlBlocks` normalizes a block. When `match` is given, a link is kept only if its text or its URL contains a term. The links count toward `FETCH_TEXT_LIMIT_BYTES`. A returned link is data and is never fetched. The host guard (`assertSourcesHost`, first statement of `requestSource`) is unchanged. Update the tool schema in `src/schema-gen.ts`.

**Check:** new tests in `source/practice/mcp/test/sources-fetch-tool.unit.test.mjs`, written first. The fixture page holds a relative link, an absolute same-host link, a same-host link with a fragment, a duplicate, an other-host link, an `http:` link and a `javascript:` link. Assert the exact `links` array, its filtering under `match`, and that no `links` key appears without `links: true`. Run `npm test` in `source/practice/mcp/` (it builds, bundles and runs the suite). Commit the rebuilt bundle.

### 1c. The publisher map and playbook read the parts off the contents page

In `.claude/skills/legal-research/references/legislation-fetcher-playbook.md`:

- Section 3 gains two map keys: `<kind>_contents_url_pattern` (how a citation becomes the contents page's URL) and `<kind>_part_link_pattern` (a regular expression that a part link's URL matches). The values come from the 1a table.
- Section 4's BC seed gains both keys for regulations.
- Section 8 gains a parts procedure. When the map has a contents pattern for the kind, fetch the contents page with `links: true` and `match` the instrument's id. Keep the links whose URL matches the part pattern. Fetch and verify each part as step 6 does, and file each under section 5's name followed by ` - <last URL segment>` (for example `... - 168_2009_02.md`). The instrument is `filed` only when every part is filed. Otherwise return `stopped`, reason `part_not_filed: <url>: <reason>`, with the parts filed so far.
- Step 2 ("Already on disk?") counts the instrument on disk only when every part's file is there.
- The return gains `parts: [{url, path, currency_marker}]`. Update the same field in `source/research/agents/legislation-fetcher.md`.
- Step 9: a live map missing a key that the seed has counts as a field this run proved wrong. The fetcher adds the seed's key, keeps the map's other values, and overwrites the map. Without this, the existing live `bclaws.md` in the firm overlay would never learn the part keys, and Job 12 would fail again.
- Section 10's "A consolidation part" bullet is replaced by a pointer to the parts procedure.

**Check (prose):** `grep` shows the playbook no longer says a regulation published in parts stops at step 6, and still says "Never guess a part id". **Check (end to end, after release):** check the time on the machine's `.last-complete-round` file under `~/.claude/plugins/synced/` to confirm the new version is installed. Then re-dispatch Job 12's instrument into a `6. LAW` issue folder Brahm names. It passes only if the return is `filed`, `parts` lists every part URL the 1a table lists, and the folder's manifest has one line per part, each with a currency marker. One missing part fails.

## Step 2 — Publisher map drift. Release: `research`, plus all five if `shared/` changes

The live `bclaws.md` in the firm overlay has drifted from the seed. Its `regulation_id` adds a rule that the seed lacks: on a 404 at the bare id, fetch the `_01` form once. The playbook's step 4 and section 6 allow the `_01` retry only for an act, in the opposite direction.

- Copy the live map's `regulation_id` wording into the seed. Extend step 4 and the section 6 404 row to cover the regulation direction (bare 404, then `_01` once).
- `.claude/skills/shared/bclaws-sccr-doc-map.md` hard-codes part ids, and its table lacks `_04_1` and `_06`. That conflicts with ADR 0001's rule of reading parts off the contents page. Replace its id table with a pointer to the parts procedure, and keep its access notes. Its reader, `shared/docket-clerk/references/rule-freshness.md`, keeps its link. This item is added beyond the brief because it is the same drift.

**Check:** a script in the scratchpad parses the seed's front matter from the playbook and the live map's front matter, and prints every key whose value differs. It passes when the only differences are `accessed`, `checked` and the header fields the runtime stamps (`learned_by`, `matter`, `plugin_version`, `shipped_from`). After Step 1's end-to-end run, run it again: the live map must now hold both part keys. `grep` shows no `168_2009_0` id table in `bclaws-sccr-doc-map.md`.

## Step 3 — Stale text. Release: all five (`shared/`)

- `.claude/skills/shared/knowledge-tree.md` line 3 says the file "ships only inside the litigation `.plugin`'s `skill-source/` mirror". `shared/` is copied whole into every plugin, and no `.plugin` archive is built. Section 9 has the same staleness: "Coclerk checkout" (line 144), and "packaged version" and "repackage trigger" (line 150). Replace them with the current facts from `CLAUDE.md`: the source is this repo, and a push to `main` is the release.
- `.claude/skills/shared/research-paralegal/legislation-currency.md` line 6 names `plugins/litigation/canlii-mcp/src/legislation-currency.ts`. The module is `source/research/canlii-mcp/src/legislation-currency.ts`. Its "rule of court" scope (lines 3-4) changes in Step 6, not here.

**Check:** `grep -n "\.plugin\|plugins/litigation\|Coclerk checkout\|repackage\|packaged version"` over the two files returns nothing. `test -f source/research/canlii-mcp/src/legislation-currency.ts` succeeds.

## Step 4 — Rule Library and `court_rules__*` tools. Release: `practice`, all five if `shared/` changes

- Storage at `<case_data_root>\_practice\rules\`, laid out as `<Country>\<Jurisdiction>\[<Locality>\]<Venue>\<Rule Set>\`, with transnational bodies under `_International\<Venue>\<Rule Set>\`. A Rule Set folder holds one text file per Consolidation part, as fetched, and one `rule-set.json` listing each part's source URL, currency marker, sha256 and fetch time. The Rule Set is held whole only when every part listed on the contents page is held.
- `_International` joins `_NoVenue` as a reserved `_` name in every knowledge tree (ADR 0001): `shared/knowledge-tree.md` section 3, and the path parser in `source/practice/mcp/src/knowledge/tree.ts`.
- New tools in the data server, under `source/practice/mcp/src/court-rules/`:
  - `court_rules__file`: fetches a Rule Set's contents page and parts server side through `sourcesFetcher`, the same parts step as Step 1, and writes them. No parameter accepts rule text from the caller, so text never passes through a model.
  - `court_rules__list`: what is held, which parts and versions, and whether the Rule Set is whole.
  - `court_rules__search`: by number, heading and full text. The result names every part searched.
  - `court_rules__quote`: the verbatim text of one provision with its part's currency marker.
  - `court_rules__retire`: moves a superseded version under `_superseded\`.
- The rule overlay's verbatim text and the docket-clerk's modelled periods are unchanged (ADR 0001).

**Check:** new `source/practice/mcp/test/court-rules.unit.test.mjs` against a two-part fixture Rule Set. Filing writes both parts, and `list` reads "whole" only after both. `quote` returns bytes identical to the fetched block. `search` names the parts searched. A schema test asserts that no `court_rules__*` input property can carry text. Knowledge tests accept `_International` and still refuse any other `_` name. Run `npm test` in `source/practice/mcp/`.

## Step 5 — `court-rules-clerk` and Venue source records. Release: `research`, `practice`

- Agent `source/research/agents/court-rules-clerk.md`, with tools `court_rules__*`, `sources__fetch`, `knowledge__read` and `knowledge__list` (to read publisher maps), under both tool-name forms. Its playbook is `.claude/skills/legal-research/references/court-rules-clerk-playbook.md`. It files, indexes, keeps current, locates and quotes verbatim with the currency marker, and reports what it searched. It never says what a rule means, whether it applies, or that none exists.
- The clerk keeps each **Venue source record**, through a `court_rules__venue_source` read and write tool: the most authoritative online source for current text, where changes are first announced, and when announced changes come into force. It holds web addresses only, at `<Venue>\venue-source.json` in the Rule Library. A Venue's own website is allowed on the practitioner's machine only, through `_hosts.json` with `category: "venue"`.
- Routing: the `/legal-research` gate sends "locate or quote a Court Rule" to the clerk. `research-agent` may cite the clerk's search record. `docket-clerk` calls `court_rules__quote` directly, because it may not call into `research`.
- Add the clerk to `source/assignment.json` and `source/research/roster.json`. Add it to `shared/knowledge-tree.md` section 2's reader column for publisher maps.

**Check:** `check_layering.py` and `check_plugin.py` pass, and the agent name is unique across the five plugins. End to end after release: the clerk files B.C. Reg. 168/2009 into the Rule Library, `court_rules__list` reads "whole", and a heading search returns a result naming every part searched.

## Step 6 — Note up a Court Rule on Reliance on a rule. Release: `practice`, `research`, `litigator`, all five (`shared/`)

- Tool `court_rules__note_up` in the data server. Input: the Rule Set, the provision, the text relied on, and an optional date window. It fetches, server side, the source the Venue source record names. It checks currency against the source's "current to" marker and the announcement page, and compares the text relied on word for word with the fetched provision. Results: `noted_up`, `differs` (with the authoritative wording and what changed), or `failed` (with a reason). Where an announced change comes into force inside the window, it reports both texts and their in-force dates, and does not choose between them. On `differs` it updates the Rule Library copy server side and sets `commons_replace: true` in `rule-set.json`, for the clerk to act on in Step 7. The tool never calls the commons.
- **Assumption, from ADR 0003 and the layering:** a Court Rule's currency check is the Venue source record's check, not CanLII's `legislation_currency`. The note-up runs in `practice`, and `canlii` is in `research`.
- **No stop, no block.** Each caller produces its date, paragraph or quotation and marks it 📇 until a later note-up succeeds.
  - `drafting-data` stores the result through the existing per-provision currency result. Only `noted_up` reads as `current`.
  - In `source/practice/mcp/src/submission/forms.ts`, the `currency_gate_failed` refusal no longer refuses for an authority of kind `rule`. The line carries 📇 instead. `drafting_data__record_sent` keeps its waivable hold, so the practitioner sees the warning before sending.
  - `docket-clerk` marks a deadline calculated under an un-noted provision. **Stop and ask Brahm** if no existing practice-data field can hold that mark: a new column in a legacy store would deepen Exception 2, which no revision may do.
- **Prose, one source.** `.claude/skills/shared/statute-currency.md` "Noting up legislation" stays the one definition. It splits: statute and regulation are unchanged, and a Rule Set provision or practice direction follows ADR 0003. Remove "Practice directions are out of scope" (lines 40-42), and take "rule of court" out of leg 1's scope (lines 3-4, 13, 23), with a pointer to the new route. `.claude/skills/shared/legal-audit-protocol.md` step e (lines 112-115) and "For every authority" item 2 (lines 163-164) point to that section, not to the currency check. `legislation-currency.md` lines 3-4 drop "or rule of court". The glossary's **Note up** entry already matches.
- How a Court Rule is recorded as kind `rule` and not `regulation` in drafting data is settled in this step. The check below covers both kinds.

**Check:** add cases to `source/practice/mcp/test/note-up-by-kind.unit.test.mjs` and `note-up-steps.db.test.mjs`. A kind `rule` provision that is not `current` renders the filed face with 📇 and is not refused. A kind `regulation` provision that is not `current` is still refused. `court_rules__note_up` against fixtures returns `noted_up`, `differs` and `failed` correctly, and the in-window case returns both texts. `grep` shows no "rule of court" in leg 1's scope and no "Practice directions are out of scope". Run `npm test` in `source/practice/mcp/`.

## Step 7 — Rule contributions to the legal commons. Release: `research`

### 7a. Commandment 1 gate (first act of the executing session)

`source/research/hooks/commons-read-only.py` and its matcher in `source/research/plugin.json` refuse every commons write. Narrowing them weakens an enforcer, so the executing session first says this to Brahm, in its own conversation:

> After this change the commons guard will no longer refuse `legal_commons__rule_text_contribute`. That tool uploads to the shared pool the official published text of a Court Rule or practice direction, exactly as fetched, with its source URL, currency marker and sha256, and no contributor. Every other commons write (`push`, `amend_*`, `link_authority`, `unlink_authority`, `merge_authority`, `record_treatment`, `stamp_verified`, `rule_period_*`) stays refused.

It then waits for his instruction. Approval of this plan is not that instruction, because it was given in another conversation. Without the instruction, steps 7b to 7e are not built.

### 7b. Cloud side (Probanda's Cloud, no DDL here)

One record per rule or practice direction per version, with its Venue, Rule Set, part, in-force window, text, source URL, currency marker and sha256. No contributor. A second contribution of the same version is compared with the first and not added. A write's response reports saved, already held or differs, and asks a guiding question when it is not saved. It never states a rule (Commandment 6). Search runs by meaning, number and heading. A holdings call reports which parts and versions are held.

### 7c. Commons tools

In `source/research/commons-mcp/src/legal-commons/`, add `rule_text_contribute` (write), `rule_text_find` (read) and `rule_text_holdings` (read). `contribute` takes a Rule Library path and the parts chosen. It reads the files itself, checks each file's sha256 against `rule-set.json`, and sends nothing on a mismatch. It never calls `contributorId()` (`contributor.ts`), unlike `rule_period_push`.

### 7d. Hook narrowing

The matcher keeps its 13 write tools and does not add `rule_text_contribute`. Update the hook's docstring and deny message. In `source/research/tests/test_commons_read_only.py`, add `ALLOWED_WRITE = {"rule_text_contribute"}`. `test_every_pool_tool_is_classified` then asserts `served == WRITE | READ | ALLOWED_WRITE`, and a new test asserts the matcher matches no `ALLOWED_WRITE` tool under either name form.

### 7e. The clerk offers contributions

When the clerk serves a part or version that the commons lacks, or finds `commons_replace: true`, it tells the practitioner and offers to contribute. The practitioner chooses one rule, some parts, the whole Rule Set or nothing. The clerk never reports that a Rule Set has no rule on a point unless the whole Rule Set is held.

### 7f. Before legal-commons.org is public

Brahm checks each publisher's terms for reusing its text. The result is recorded in that publisher map's `terms_of_use`. This plan records no conclusion on them.

**Check:** run `npm test` in `source/research/commons-mcp/`, with a test that the `contribute` payload has no contributor field and that a sha256 mismatch sends nothing. Run `python -m unittest source/research/tests/test_commons_read_only.py`. The guard still denies `legal_commons__push` (the existing subprocess test).

## Not scheduled

- Sharing Venue source records through the commons (ADR 0003) waits until more than one practitioner keeps them.

## Verification summary

| Step | Fails if wrong |
|---|---|
| 1a | Survey table missing a URL or a marker cell |
| 1b | `sources-fetch-tool` link tests |
| 1c | Job 12 re-run missing any part in `parts` or the manifest |
| 2 | Seed and live front-matter diff shows a key other than the stamped and date fields |
| 3 | `grep` for stale phrases, and `test -f` on the canlii module |
| 4 | `court-rules` unit tests, and the knowledge `_International` tests |
| 5 | Layering and plugin checks, and the clerk's end-to-end "whole" listing |
| 6 | Note-up kind tests (rule warns, regulation refuses), and `grep` on the note-up prose |
| 7 | Commons tests, the guard tests, and Brahm's instruction recorded in the executing conversation |

## Survey result

(Filled by Step 1a.)
