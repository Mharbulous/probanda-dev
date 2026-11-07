# Plan: Cast of Characters board (lawyer plugin)

## Context

On a real matter, finding the client's criminal defence lawyer took a folder-wide grep and a mailbox search, because no store had a place for that person. The fix is a read-only page per matter, `0. DRAFT\Cast of Characters.html`, listing everyone involved with sourced contact details, plus small practice-data store changes so every such person can be recorded. Source of truth: `docs/Specs/2026-11-06_cast-of-characters-board-spec.md` and its mockup (mockup wins on layout and behaviour).

## Decisions taken during planning (the developer, 2026-11-06)

Exploration found four gaps between the spec and the code. Each was settled by the developer:

1. **Detail sources.** Contacts store emails, phones and addresses as plain strings. Counsel and party details cite the matter-data party record (with `service_address_filed_date`). Contact details cite the role's `note` / `from_source_id`. Add an optional hashed boolean `privileged_source` on the role, which route 2 sets when the find came from client mail. This drives the Privileged source flag.
2. **Fact and document counts.** These are computed in a read-only Python script. Documents count when the file name holds one of the participant's file codes, or through a `filed_by_party_id` / `report_source_id` link. Facts count when their text holds the folded name or an alias, or through a `positions` / `admissions` link.
3. **Related party.** Add an optional hashed field `for_case_party_id` on the role, for `insurer`, `investigator`, `client_representative` and `client_other_counsel`. It sets the side and the Related section. `case_party_id` keeps its meaning, so `contact_checks` is unaffected.
4. **Notes box.** It shows the contact's existing firm-wide `note`.

Also decided without asking, because the spec allows it: there is no appearances table, so the tribunal member's Appearances section shows `capacity`, `tribunal_body` and `notes`, and only when present. Spec open item 6.3 is closed with `court_staff` and no new role.

These decisions are written into the spec (step 6) so it stays the source of truth.

## Step 1. Store changes (one commit)

**Tool schema.** In `source/lawyer/mcp/src/schema/practice.ts:655-672` (`upsert_matter_role`):
- Add the seven roles to the description (`client_other_counsel`, `client_representative`, `witness`, `investigator`, `insurer`, `public_body`, `court_staff`), each with a one-line meaning.
- Add the inputs `case_witness_id` (num), `case_tribunal_member_id` (num), `for_case_party_id` (num), `privileged_source` (bool) and `status` (str, enum `["proposed"]`; null clears it). Check that `source/mcp-shared/validate.js` accepts null on an enum field, and if it does not, use the same form the other clearable fields use.
- Add one sentence: a proposed role is never used to address mail.

**Handler.** In `source/lawyer/mcp/src/tools/practice/contacts.ts:85-100`, send `tags: { role, status }`. A null `status` clears the tag, because the cloud merges with `jsonb_strip_nulls`. Add the four new data fields, which are hashed like `case_party_id` (`practice/ops.ts`).

**`merge_contact`.** In `contacts.ts:389-404`:
- Add the new data fields to `shift`'s compare and fill lists, so they are carried over.
- Match twin roles on `role` and ignore `status`. A proposed twin folds into its confirmed twin, and the confirmed one is kept. This is what "Merge with…" (spec 3.4) needs.

**Cloud rule.** In `cloud/items/rules.sql`:
- Add the seven roles to the `matter_role`/`role` vocabulary (line 157).
- Add a `('matter_role','status',array['proposed'])` vocabulary row and `('matter_role','status','vocab',false)` to `rules.tag`.
- Add `hash:case_witness_id?`, `hash:case_tribunal_member_id?` and `hash:for_case_party_id?` to the `matter_role` upsert key (line 230).
- Mirror the key in `source/lawyer/mcp/test/helpers/fake-cloud.mjs:29`.

**Cloud tests.** In `cloud/items/tests/scratch_test.template.sql`:
- Update the P3 counts (lines 313-314).
- Add tests for each new role being accepted, for `status: proposed` being accepted and then cleared, and for an unknown status being refused. Keep R12 (`co_party` refused).
- Run them through `build_scratch_test.mjs` with `supabase db query --linked -f`, in scratch schemas.

**Deploy.** Apply `rules.sql` to the Supabase project, as `cloud/items/README.md:23-25` directs. The file is idempotent. This is a write to the live cloud, so it is authorised only by approving this plan. Then run `cloud/items/tools/check_items.mjs` against it, and add a check that a `witness` role with `status: proposed` saves.

**Node tests.** In `source/lawyer/mcp/test/practice-contacts.db.test.mjs`, test that:
- the new roles and fields write and sync, and the data fields are hashed, never sent in clear;
- `status` is set and then cleared;
- a merge carries the new fields and folds a proposed twin;
- an old copy still reads the store (the existing test at line 310).

**Docs.**
- `.claude/skills/practice-data/SKILL.md`, Contacts section (lines 53-59):
  - the new role list;
  - the two recording routes from spec 3.3;
  - the "never create a contact without asking" rule (line 57), amended to name its one exception, worded so it covers route 2 and nothing else: a session that has just found a person by searching mail or matter files, to answer who they are or how to reach them, records the find as a proposed role, sets `privileged_source` when the find came from client mail, and says in one line what it recorded;
  - proposed roles never address mail;
  - a pointer to the board and its render tool.
- `docs/ADRs/0009-firm-wide-contacts-in-practice-data.md`: add `## Amendment 2026-11-06: contact details for witnesses and tribunal members`, before "Considered options", in the 0010 style. It says that witness and tribunal-member contact details go on a practice-data contact, tied by `case_witness_id` / `case_tribunal_member_id`, and points to spec 3.2. Add an inline "(amended 2026-11-06, below)" at line 11.
- `docs/Specs/2026-11-04_service-list-email-reads-party-contact-spec.md`: add one line saying it reads confirmed roles only (`status` absent). That spec owns the one future send path that reads roles.

## Step 2. Data reader

- **Matter-data script.** Add `.claude/skills/matter-data/references/scripts/cast_of_characters.py`. It reads through `read_staged` (`list_parties.py:52`) with the `_behind` version guard, and keeps every table and column name in Python (decision #56). It returns:
  - parties with their proceeding roles;
  - counsel of record, with overrides applied the way `parties_of_record.py:94-95` does, plus `replaced_representative`;
  - witnesses, with `called_by_party_id` and `retained_by_party_id`;
  - tribunal members;
  - aliases and file codes;
  - the counts from decision 2. Matching uses `_fold` from `resolve_participant.py:79`, and the script reads `main.sqlite` only.

  Add a pytest in `.claude/skills/matter-data/tests/`.
- **TS wrapper.** Add `source/lawyer/mcp/src/case/cast-of-characters.ts`, which calls it through `runCaseScript` (`case/case-script.ts:12`).
- **Join.** Add `source/lawyer/mcp/src/cast/cast-data.ts`. It is a pure function from (matter-data result, the matter's roles with contacts and affiliations, as `contact_lookup` + `withTies` give them, and `parties_without_role`) to a model of tabs, sections and entries. It derives:
  - the entries and their tie-ups, following spec 4.2;
  - the side (P/D/N) from proceeding roles, using the matter's own labels;
  - the tab and section for each entry, following the table in spec 4.3;
  - the entries that are not cards (`client_other_counsel`, `client_representative`, `insurer`, adjusters), which go into the related card's Counsel and Related sections;
  - former entries (`to` passed, or `replaced_representative`);
  - the flags from spec 4.5, where Conflicting means a contact value differs from counsel of record, or two values exist for one detail;
  - the copy-instruction sentences from spec 4.6.

  The Service List set follows `to_service_list`'s rules as the 2026-11-04 specs define them.

## Step 3. The page

**Template.** Add `source/lawyer/mcp/src/templates/view-pages/cast-of-characters.html`, `.css` and `.js`.
- The entry includes `view-head.html` and `view-folder.css`, keeps `<title>`/`<h1>` = "Cast of Characters", and reproduces the mockup's CSS: radio tabs with `:has`, a `.opener` radio per card plus `#o-none`, the Show former checkbox in CSS only, dashed unconfirmed cards, `.former` dimmed, and everything else hidden while a card is open.
- The JS does only the mockup's filter (search folded for case and accents), Side, Flags, Esc, closing on tab change, the remembered tab (`localStorage` in try/catch, key `cast-of-characters-tab`, as `arguments.js:165-187` does) and the copy buttons (the Loose Threads Restore pattern, `loose-threads.js:128-152`, falling back to showing the text).

**Server-side rendering.** Add `source/lawyer/mcp/src/cast/cast-page.ts`, which renders the model to **full markup on the server**, with every value HTML-escaped. This is a new pattern: every existing view page is built in the browser from JSON, and that does not work with JavaScript off.
- The page's meta row (Matter, Client, Rev, Rendered) is rendered in the markup.
- `shared.js` is still included. If it would duplicate or break the server-rendered meta, add a guard to skip a `.meta` that already has children, and re-pin the other pages' hashes in `view-pages.unit.test.mjs` only if their output changes.
- The `@@data@@` slot carries only `window.VIEW_PAGE` meta, and the page carries the marker `data-view-page`.

**Page write.**
- `matter-pages-build.ts`: build Cast after Loose Threads, in the same `html` array and `guardTargets` order (`matter-page-files.ts:68-75`), with Cast in `keep` and `paths.cast_of_characters_path` returned.
- The background job cannot read practice data. Read both the cast inputs (the roles and the matter-data script result) in `pageContext` (`dispatch.ts:516-541`) and hand them in, the way the to-dos and dates already are.
- Register Cast in `pages/preview.ts` `PAGE_TEMPLATES` and `VIEW_FIXTURES`, with a fictional T512 fixture under `src/board-fixtures/`, and in `schema/file.ts` `PAGE_NAMES`. The parity test at `pages-preview.unit.test.mjs:66` enforces this.

**Render tool.** Add `practice_data__render_cast_of_characters` in `schema/practice.ts` and `tools/practice/index.ts`, modelled on `render_practice_board` (`tools/practice/practice-board.ts:143-167`).
- It takes a matter ref and finds the matter's `0. DRAFT` folder (via `case/locate.ts`).
- It applies the marker guard and writes with `writeStatusFile`.
- It returns `{cast_of_characters_path, counts per tab, flagged}` and nothing else. Its description says to present the path as a file card and never read it.

**Gate.** Add `"cast of characters"` to `VIEW_NAMES` and `"Cast of Characters.html"` to `SAMPLE_PAGES` in `.claude/skills/drafting-data/hooks/html-pages-gate.py`. Add the name to `STAGEABLE_NAMES`, `PREVIEW_NAMES` and `PAGE_PATHS` in `.claude/skills/drafting-data/tests/test_html_pages_gate.py`.

**`.claude/skills/shared/html-pages.md`.** Add one line beside line 18: Cast of Characters is returned as `cast_of_characters_path`, built with the matter pages and by its render tool, and a session answers its questions from `contact_lookup` and `resolve_participant`.

**Tests.**
- `cast-data.unit.test.mjs` covers the model for the T512 fixture.
- A sha256 pin goes in `view-pages.unit.test.mjs`.
- A script test in a `vm` fake DOM (the `arguments-page-script.unit.test.mjs` pattern) covers search, Side, Flags, Esc and the remembered tab.
- `matter-pages.db.test.mjs` adds Cast to the folder listings, a marker refusal, and sweep survival.

## Step 4. T512 walkthrough (spec 7)

A db test builds the test matter T512 with fictional people, using `matter-data-fixture.mjs` and the fake-cloud `PracticeStore`. It holds the nine entry kinds spec 7 lists: a party with counsel, a self-represented party, a witness with a contact, an expert, a `client_other_counsel` recorded from email, a proposed role, a tribunal member, a public body, and an ended role. It asserts on the model from `cast-data.ts`: the tab, section and side of each entry, the former flag, every flag in 4.5, and each copy-instruction text.

## Step 5. Visual check and JavaScript-off check

- Render T512 into the scratchpad with the render tool's code path, as generator development, which `html-pages.md:5` allows.
- Make a second copy with every `<script>` removed. Because all script is inline, this copy is exactly the page with JavaScript off.
- Dispatch `browser-driver`, one run, with a full script. It opens the mockup and the rendered page side by side and checks the tabs in order, the sections, two-row closed cards, one card open with everything else hidden, Show former, search by alias and by file code, the Side and Flags filters, and copy (clipboard text). On the script-free copy it checks only that the tabs switch and that a card opens and closes. It reports in writing.
- If the Chrome tools are not connected, I report this check as not done and give you the two file paths to open yourself.

## Step 6. Spec, checks and landing

- Update the spec: write the planning decisions into 3.2, 3.3, 4.2, 4.4 and 4.5, close open item 6.3, and set the status to "Built".
- Run:
  - the MCP build and bundle;
  - the node tests (with APPDATA set to a scratch folder);
  - pytest on `.claude/skills/matter-data/tests` and `.claude/skills/drafting-data/tests`;
  - the TypeScript type-check;
  - `python scripts/build_plugin.py`, then `--check`;
  - `python scripts/check_plugin.py`;
  - `python scripts/check_layering.py`;
  - `python scripts/check_file_ops.py`;
  - `python scripts/check_publishable.py --new-since origin/main`.
- Commit each finished unit by pathspec, pull with `--ff-only`, and push to `main`: (a) store, cloud and docs, (b) data reader, page, tool and gate, (c) spec. Then run `/release`. The lawyer plugin will most likely get a **minor** bump, because an old copy cannot write the new fields and would read a proposed role as a confirmed one. The litigator plugin changes too, because it ships the gate hook.

## Report at the end

Each spec 7 item with how it was verified, plus what was not verified. A likely gap is that the cloud acceptance is checked by `check_items.mjs`, not by a real session.

## Orchestration

### 0. Start the run in a fresh session
Accept the plan with "clear context". The plan, the spec and the mockup are the primary sources, and this planning conversation is not needed (rule 18). The orchestrator writes a run file at `<scratchpad>/cast-run.md` that records each slice's status, commit SHAs, whether the deploy is done, and the check results. It updates the file as each event happens and resumes from it after a compaction (rule 14).

### 1. Slices
The workers are `general-purpose` agents with the model pinned per dispatch. The project defines no implementer agents.

| Slice | Plan part | Paths it owns | Model | Starts after |
|---|---|---|---|---|
| A: store | Step 1 except Deploy, plus writing the decisions into spec sections 3.2, 3.3, 4.2, 4.4, 4.5 and 6.3 (status stays unchanged) | `schema/practice.ts` (`upsert_matter_role` only), `tools/practice/contacts.ts`, `cloud/items/**`, `test/helpers/fake-cloud.mjs`, `test/practice-contacts.db.test.mjs`, practice-data `SKILL.md`, ADR 0009, the 2026-11-04 spec, the cast spec | sonnet | the start |
| B: script | Step 2, first bullet | `.claude/skills/matter-data/references/scripts/cast_of_characters.py`, `.claude/skills/matter-data/tests/` | sonnet | the start, in parallel with A |
| C: join | Step 2 wrapper and join, the T512 fixture, Step 4, `cast-data.unit.test.mjs` | `src/case/cast-of-characters.ts`, `src/cast/cast-data.ts`, `src/board-fixtures/` (T512), the T512 db test | opus | A and B |
| D1: page | Step 3: template, `cast-page.ts`, the `vm` script test, the sha256 pin, the `shared.js` guard | `src/templates/view-pages/cast-of-characters.*`, `src/cast/cast-page.ts`, `shared.js`, `view-pages.unit.test.mjs`, the new script test | sonnet | C |
| D2: wiring | Step 3: page write, `pageContext`, preview registration, render tool, gate, `html-pages.md`, `matter-pages.db.test.mjs`. Then render T512 and its script-free copy into the scratchpad and return both paths. | `matter-pages-build.ts`, `matter-page-files.ts`, `dispatch.ts`, `pages/preview.ts`, `schema/file.ts`, `schema/practice.ts` (render tool), `tools/practice/index.ts`, `practice-board.ts`, the gate hook and its test, `html-pages.md` | sonnet | D1 |

The order follows from what each slice needs:
- A and B run in parallel because their paths do not overlap (rule 10).
- C waits because it needs A's field names and B's output shape.
- D1 and D2 run one after the other because D2 calls D1's render function, and its preview parity test needs D1's template. Running them in parallel would save time but not tokens, and it risks rework.
- A and D2 both edit `schema/practice.ts`, and the order already keeps them apart.
- D is split in two so that each half fits one fresh context and can run on Sonnet. A single long run driven by tool calls is what rule 12 keeps off Sonnet.
- C goes to Opus because spec 4.2 to 4.6 hold the judgment-heavy mapping.

### 2. What every worker brief contains (rule 13)
- **Paths, not pasted text:** the plan file and the step it covers, the spec, the mockup (D1 only), and the slice's path set. The worker edits nothing outside that set.
- **Settled names.** C's brief names the shape of B's output, taken from B's return. D1's brief fixes the export name D2 will call, for example `renderCastPage(model, meta)`.
- **Prohibitions:**
  - Never run `scripts/build_plugin.py`. It replaces each `plugins/<plugin>/` folder wholesale, so one worker's run clobbers another's.
  - Never deploy `rules.sql`. Scratch-schema tests are allowed.
  - Never run `/release`.
  - Run only the slice's own test files, with output sent to a log file, and report the pass and fail counts. Do not paste the test output.
- **Commit:** after its own tests pass, the worker commits its source hunks by explicit pathspec, runs `git pull --ff-only` and pushes, which follows the global rule. Nothing under `plugins/` gets committed.
- **Return:** first line `status: done|blocked`, then the files changed, the commit SHA, the tests with their counts, and any question the plan does not settle, which the worker returns as a proposal without deciding it. Last line `end:`. Keep it under about 1,500 tokens.
- **On failure.** If the worker has unfinished work of its own, resume it with SendMessage. A retry after a failed gate goes to a fresh worker, briefed with the failing check only and never with the failed transcript (rule 17).

### 3. What the main session does itself
- **Deploy (after A).** Apply `rules.sql`, then run `check_items.mjs`. This live cloud write is a one-way-ish act, so it stays out of the workers, and it is only a few commands.
- **Gate script.** One deterministic script at `<scratchpad>/cast-checks.sh` runs everything in Step 6's run list: bundle, node tests (with APPDATA set to scratch), both pytest folders, `tsc`, `build_plugin` then `--check` (retrying on WinError 5), `check_plugin`, `check_layering`, `check_file_ops` and `check_publishable --new-since origin/main`. It prints one line per check (`PASS name` or `FAIL name → log path`) (rules 03 and 06). The main session runs it after A+B, after C and after D2, and opens a log only when a check fails. A worker's report is never the completion check (rule 11).
- **Browser check (after D2).** One `browser-driver` dispatch, as in the plan's Step 5, with the two paths from D2.
- **Landing.** Set the spec status to "Built" (a one-line edit), commit it by pathspec, then run `/release`. Release rebuilds `plugins/` and commits it.

### 4. Dispatches and where the cost goes
There are five coding workers and one browser worker. The main session holds only the plan, the briefs, the returns of about 1.5k tokens each, the one-line gate results and the run file. All source reads and test loops happen in contexts that are thrown away, and four of the five coding workers run on Sonnet.

