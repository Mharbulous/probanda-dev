Read when: `/draft`'s `draft/references/revise-on-the-fly.md` makes a quick edit (§8) or swaps or moves material to be relied on (§7) on a Writing, in any session, holding a job or not, or a session reads `paragraph_revisions`.

# On-the-fly paragraph revision

Owned by `/drafting-data` (schema/SQL live here, never in a consuming skill's own files — Database Access Encapsulation). Schema v57. **A rewording and a fact move now write only through `drafting_forms__preview_edit` and `drafting_forms__apply_edit` (§8), and a session composes none of §2 to §6's SQL.** §2 to §6 record the hand-run route the tools replaced, the checks the tools still make, and the scripts the practitioner-words gate still reads on `drafting_data__execute`. The tools audit to the quick-edits log (§8), not to `paragraph_revisions`. The audit table `paragraph_revisions` is append-only and revision-exempt (`filing-checklists.md` §8): no `UPDATE` and no `DELETE` path, anywhere. Every value below is a literal composed into the script text, never a bound parameter, and a single quote inside a text is doubled (`jobs-common.md`, "No bind parameters"). `created` is `jobs-common.md` §0's timestamp. Examples use row 12 of `facts`, Writing 7 and this session's token `'sess-a1'`; substitute your own.

## 1. Revisable text columns

The route revises the text the mockup prints for the paragraph:

| Paragraph type | `entity` (table) | `field` (column) | Row-id trace on the mockup |
|---|---|---|---|
| fact | `facts` | `postulate` | `<!-- fact_id N -->` |
| statement of fact (evidence) | `statements_of_fact` | `excerpt` | `<!-- statement_of_fact_id N -->` |
| proposition of law | `law_assertions` | `proposition` | `<!-- law_assertion_id N -->` |
| statement of law | `statements_of_law` | `excerpt` | `<!-- statement_of_law_id N -->` |
| submission | `submissions` | `contention` | `<!-- submission_id N -->` |
| order sought | `order_sought` | `wording` | `<!-- order_sought_id N -->` |
| order sought, printed with this Writing's own wording | `filing_orders` | `wording_override` | (the order's) |
| rhetorical paragraph | `rhetorical_paragraphs` | `wording` | `<!-- rhetorical_paragraph_id N -->` |

`entity_id` is the row id, the `ticket_scope` shape. An order whose `filing_orders` row for this Writing has `wording_override` set prints that override, so the revision updates `wording_override` on that one row, `entity_id` being the `filing_orders` row's `id`, and leaves `order_sought.wording` and every other Writing's row alone. Its `wording_override` NULL: the revision updates `order_sought.wording`. A rhetorical paragraph's revision updates `wording` alone; when the revision changes whether the paragraph states law or fact, the same script also sets `states_law` or `states_fact`, which no trigger resets. No other column or table is revised here: clauses and prose slots are out of this route.

**A statement of fact citing an exhibit** (`exhibit_id` set) prints `exhibit_excerpt`, not `excerpt`, which this route does not edit. Refuse it in one line, writing nothing: "This statement prints its exhibit's excerpt, which an on-the-fly revision does not edit."

Every trigger on these columns fires as on any other write: the revision moves, a verified or settled statement of law whose `excerpt` changes returns to `'lead'`, a contention moved off its no-facts-needed wording clears that decision, and a deployed order's wording or override change clears a pure-law record. 🧐 re-fires against the row's latest approval (`review.md`), an override revision against the `filing_orders` row's own.

## 2. Finding the row

The markdown `drafting_forms__render` returns carries a trace comment on each paragraph's line, and on a statement's marker line under its excerpt. A label ending `_id` is the row id, naming its table (#379); a bare label is positional, the paragraph's number in its part. The shared submission paragraphs (a Notice of Application's Part 3, a Written Argument, a general Writing's legal basis, an Application Response's and the BCCA books' submissions) print a row id on every submission, fact, statement of fact, proposition and statement of law; every surface prints `rhetorical_paragraph_id` on each rhetorical paragraph (v71); the BCCA factum and response book, the requisition and the companion documents print `order_sought_id` on their orders; a general Writing prints `statement_of_law_id` on each cited statement. A Notice of Application's Part 1 orders (`<!-- order N -->`) and Part 2 facts (`<!-- fact N -->`), an Application Response's and a BCCA stay response's facts, a requisition's numbered orders and a general Writing's orders list (`<!-- relief_item b -->`) print a positional trace only.

"The text as rendered" is the stored text: the paragraph without its number, markers, citation line, trace, bold marks or the three-space indent of an excerpt's fence.

- **A row-id trace**: that is the row. Read it and check its text equals the paragraph as rendered:

```sql
SELECT id, postulate FROM facts WHERE id = 12;
```

- **A positional trace only**: read this Writing's join rows of that kind (`filing_facts`, `filing_submissions` or `filing_orders`) and take the one whose text equals the paragraph as rendered:

```sql
SELECT ff.ordinal, f.id, f.postulate FROM filing_facts ff JOIN facts f ON f.id = ff.fact_id
 WHERE ff.filing_id = 7 AND f.postulate = 'The invoice was delivered on April 2nd 2025.' ORDER BY ff.ordinal;
```

- **Every order**, whichever trace it carries, is read through this Writing's `filing_orders` row, which says which column it prints: `wording_override` NULL revises `order_sought` row `o.id`, set revises `filing_orders` row `fo.id`:

```sql
SELECT fo.id, fo.ordinal, o.id, o.wording, fo.wording_override FROM filing_orders fo JOIN order_sought o ON o.id = fo.order_sought_id
 WHERE fo.filing_id = 7 AND COALESCE(fo.wording_override, o.wording) = 'The defendant pay costs.' ORDER BY fo.ordinal;
```

A read whose rows name no row id, or more than one distinct row id, stops and asks. A row whose text differs from the paragraph as rendered means the mockup is stale: re-render and start again. A paragraph with no trace at all (an excerpt repeated in the BCCA factum's Enactments appendix) is found where the mockup prints the same text with a trace; if nowhere, stop and ask.

## 3. Foreign-scope read

Run before every on-the-fly write, whether or not the session holds a job, with the `entity` and `entity_id` of the row the write updates (§1):

```sql
SELECT t.id, t.title FROM tickets t JOIN ticket_scope s ON s.ticket_id = t.id
 WHERE t.status = 'wip' AND t.rejected_at IS NULL AND t.deleted_at IS NULL
   AND t.locked_by <> 'sess-a1'
   AND s.entity = 'facts' AND (s.entity_id = 12 OR s.entity_id IS NULL);
```

Any row back means refuse, naming `Job #<id>: <title>` for each row, and write nothing. No row: proceed. A session holding its own job still runs `jobs-common.md` §2's scope read for its own job as well; nothing about that read changes. Counsel's review in progress scopes all six tables, `rhetorical_paragraphs` and `filing_orders` with `entity_id` NULL (`jobs-stock.md` §3c), so this read refuses every on-the-fly edit while counsel's review runs in another session.

## 4. The one-script write

One `drafting_data__execute` script: the substance `UPDATE` and the audit `INSERT` together. The `UPDATE` is guarded on the text as rendered, so a stale mockup matches nothing. The `INSERT ... SELECT` is guarded on `changes() = 1`, the row count of the `UPDATE` just before it, so it lands only when the `UPDATE` did, and a re-run of a script that already landed writes nothing:

```sql
UPDATE facts SET postulate = 'The invoice was delivered on 2 April 2025.'
  WHERE id = 12 AND postulate = 'The invoice was delivered on April 2nd 2025.';
INSERT INTO paragraph_revisions (entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, review_flags, choice, origin, session_token, created)
  SELECT 'facts', id, 'postulate', 'The invoice was delivered on April 2nd 2025.', 'The invoice was delivered on 2 April 2025.',
         'The invoice was delivered on 2 April 2025.', 'The invoice was delivered on 2 April 2025.', NULL, 'proposed', 'practitioner', 'sess-a1',
         strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
    FROM facts WHERE id = 12 AND postulate = 'The invoice was delivered on 2 April 2025.' AND changes() = 1;
```

An override revision has the same shape on its own row: `UPDATE filing_orders SET wording_override = '<new>' WHERE id = <fo.id> AND wording_override = '<old>';`, then the `INSERT` with `'filing_orders'`, `'wording_override'`, selecting `FROM filing_orders WHERE id = <fo.id> AND wording_override = '<new>' AND changes() = 1`.

The columns:

- `old_text`: the text as rendered. `new_text`: the text chosen, written by the `UPDATE` with the identical literal.
- `proposed_text`: the practitioner's request as they gave it, their wording or their description of the change. `alternative_text`: the revised paragraph as shown and approved, equal to `new_text`.
- `review_flags`: NULL when no flag stood, else a JSON array of the flag sentences shown, for example `'["The record dates delivery 3 April 2025 (Ex. 4)."]'`.
- `choice` and `origin`: `proposed` and `practitioner` when the approved paragraph is, character for character, wording the practitioner typed in one turn; otherwise `alternative` and `model`; `move` (a fact swap, §6, `entity` `'filing_facts'` only) is `practitioner`. A CHECK refuses any other pairing. `current` and `other` are rows written before the one-paragraph approval and are not written now.
- `session_token`: this session's token (`jobs-common.md` §1).

**A withdrawal** writes nothing: no substance `UPDATE` and no audit row.

The practitioner-words gate (`hooks/practitioner-words-gate.py`) reads every `INSERT INTO paragraph_revisions` before the tool runs. It admits a wording revision only when the session's reply before the practitioner's last turn held exactly one fenced code block, that block is `new_text` character for character, and the last turn is a bare yes. It refuses a script writing two revisions, and a revision after another one written or attempted since that turn: one approval, one paragraph. A refusal starting `Refused (practitioner-words gate, #784): ` is quoted verbatim and stops the revision: no retry and no reworded text. `changes` 0 means the guard matched nothing: the row changed since the render. Re-render and start again, never re-run against a guess.

## 5. Confirm-read

```sql
SELECT id, choice, origin, new_text FROM paragraph_revisions WHERE entity = 'facts' AND entity_id = 12 ORDER BY id DESC LIMIT 1;
```

It must carry this session's write: the choice, the origin and the `new_text` just written. Then re-query the substance row (§2's row read) and check it holds `new_text`.

## 6. Move

Swapping two Part 2 facts on a Writing's form, or moving one to another position. A move changes `filing_facts.ordinal` only: no wording, so no revised paragraph shown and no approval, and 🧐 is not re-raised (`filing_facts` is not a reviewed table and the ordinal is no reviewed field). The rendered paragraph number is the row's position in the form's Part 2 list sorted by `ordinal`, not the ordinal itself. Part 3's fact cross-references follow at render time; a number typed into wording ("see paragraph 3") is not renumbered. Only `document = 'form'` rows move: no renderer reads the Written Arguments order, so a request naming the Written Arguments, or a Writing whose facts sit only there, is refused in one line, writing nothing: "The Written Arguments print no fact order, so a move there would change nothing." Examples use Writing 8, form, part 2, rows 31 and 32 holding facts 5 and 9 at ordinals 3 and 4, and session `'sess-a1'`.

1. **Locate.** Part 2 facts print a positional trace only (§2), so the practitioner's positions are read off the ordered list:

```sql
SELECT ff.id, ff.fact_id, ff.ordinal, f.filed_on, f.retired_on
  FROM filing_facts ff JOIN filings f ON f.id = ff.filing_id
 WHERE ff.filing_id = 8 AND ff.document = 'form' AND ff.part = 'part2'
 ORDER BY ff.ordinal, ff.id;
```

Positions N and M are rows N and M of this list, counting from 1. Stop, writing nothing and saying why, if the Writing is sent or retired (`filed_on` or `retired_on` set), a position is out of range, either row's ordinal is shared with another row (the rendered order is undefined there), or the request names the Written Arguments.

2. **Foreign-scope read.** In place of §3's read, a move reads three scopes: `filing_facts` naming either row, `facts` naming either fact, and `filings` naming this Writing, each also matching a NULL `entity_id`:

```sql
SELECT DISTINCT t.id, t.title FROM tickets t JOIN ticket_scope s ON s.ticket_id = t.id
 WHERE t.status = 'wip' AND t.rejected_at IS NULL AND t.deleted_at IS NULL AND t.locked_by <> 'sess-a1'
   AND ((s.entity = 'filing_facts' AND (s.entity_id IN (31, 32) OR s.entity_id IS NULL))
     OR (s.entity = 'facts'        AND (s.entity_id IN (5, 9)   OR s.entity_id IS NULL))
     OR (s.entity = 'filings'      AND (s.entity_id = 8         OR s.entity_id IS NULL)));
```

Any row back: refuse with `Job #<id>: <title>` and write nothing.

3. **The one-script swap.** Row A at ordinal a, row B at ordinal b; here A is row 31 at 3 and B is row 32 at 4:

```sql
UPDATE filing_facts SET ordinal = 4
 WHERE id = 31 AND ordinal = 3
   AND (SELECT ordinal FROM filing_facts WHERE id = 32) = 4
   AND filing_id IN (SELECT id FROM filings WHERE filed_on IS NULL AND retired_on IS NULL);
UPDATE filing_facts SET ordinal = 3
 WHERE id = 32 AND ordinal = 4
   AND (SELECT ordinal FROM filing_facts WHERE id = 31) = 4;
INSERT INTO paragraph_revisions (entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, review_flags, choice, origin, session_token, created)
  SELECT 'filing_facts', 31, 'ordinal', '3', '4', NULL, NULL, NULL, 'move', 'practitioner', 'sess-a1', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') WHERE changes() = 1;
INSERT INTO paragraph_revisions (entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, review_flags, choice, origin, session_token, created)
  SELECT 'filing_facts', 32, 'ordinal', '4', '3', NULL, NULL, NULL, 'move', 'practitioner', 'sess-a1', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') WHERE changes() = 1;
```

Statement order matters. The first `UPDATE` lands only if A is still at a, B at b, and the Writing is neither sent nor retired. After it, A and B both hold b, so the second `UPDATE`'s check that A holds b is the proof the first landed. If the first matched nothing (a peer moved either row, or already made the same swap), the second matches nothing too. Each `changes()` reads the statement just before it: the first `INSERT` lands only if the second `UPDATE` changed one row, the second only if the first `INSERT` did. Writes made by triggers (the revision bump) do not count. Guard the `INSERT`s on `changes()`, never on the row's new ordinal: that guard would record a false audit row when a peer had already made the identical swap. The audit row's `old_text` and `new_text` are the ordinals as text, equal to the `UPDATE`'s `WHERE ... ordinal =` and `SET ordinal =` literals; the practitioner-words gate refuses any other pairing.

4. **Confirm by re-query, never by `changes`** (the returned count includes trigger writes):

```sql
SELECT id, ordinal FROM filing_facts WHERE id IN (31, 32);
SELECT entity_id, old_text, new_text FROM paragraph_revisions
 WHERE entity = 'filing_facts' AND entity_id IN (31, 32) AND session_token = 'sess-a1' ORDER BY id DESC LIMIT 2;
```

Exchanged ordinals with two new audit rows: landed. Old ordinals with none: nothing was written; say so and re-render.

5. **Move to position K.** Consecutive adjacent swaps, each its own script, re-locating (step 1) before each. Stop at the first swap that writes nothing and report the order as it then stands. Every intermediate order is valid, so a stop leaves no damage. A move over d positions writes d scripts and 2d audit rows.

## 7. Material move

Swapping two lines of a Writing's material to be relied on (a Notice of Application's Part 4, an Application Response's Part 6), or moving one to another position. A move changes `filing_documents.ordinal` only: no wording, so no revised paragraph shown and no approval, and 🧐 is not re-raised. The rendered line number is the row's position in the list sorted by `ordinal`, witness statements left out, not the ordinal itself. Unlike §6, a material move writes **no** `paragraph_revisions` row: that table's CHECKs admit `choice` `'move'` for `entity` `'filing_facts'` alone, so the swap is the two `UPDATE`s and nothing else. The #712 triggers refuse any write to a filed Writing's rows; the swap's own guard also refuses a retired one. Examples use Writing 8, rows 51 and 52 holding documents 14 and 17 at ordinals 2 and 3, and session `'sess-a1'`.

**Exhibit numbers.** "Ex. N" follows this order. On every Writing but a VanIAC submissions package, Ex. N is the document's position in this list, so a swap changes the two documents' Ex. N, and every Ex. N the mockup prints follows at render time. On a VanIAC submissions package, numbers run across the proceeding: a document an earlier round already numbered keeps its number, and only a document first numbered in this draft takes one from the new order. On either, an affidavit's own exhibit letters do not change, and an "Ex. 3" typed into wording is not renumbered.

1. **Locate.** The material lines print a positional trace only (`<!-- document N -->`), so the practitioner's positions are read off the ordered list:

```sql
SELECT fd.id, fd.document_id, fd.ordinal, f.kind, f.filed_on, f.retired_on
  FROM filing_documents fd JOIN filings f ON f.id = fd.filing_id
 WHERE fd.filing_id = 8 AND fd.role <> 'witness_statement'
 ORDER BY fd.ordinal, fd.id;
```

Positions N and M are rows N and M of this list, counting from 1. The standard closing lines printed after the list are template text and never move. Stop, writing nothing and saying why, if the Writing is sent or retired (`filed_on` or `retired_on` set), a position is out of range, or either row's ordinal is shared with another row of the list (the rendered order is undefined there).

2. **Foreign-scope read.** In place of §3's read, a material move reads three scopes: `filing_documents` naming either row, `documents` naming either document, and `filings` naming this Writing, each also matching a NULL `entity_id`:

```sql
SELECT DISTINCT t.id, t.title FROM tickets t JOIN ticket_scope s ON s.ticket_id = t.id
 WHERE t.status = 'wip' AND t.rejected_at IS NULL AND t.deleted_at IS NULL AND t.locked_by <> 'sess-a1'
   AND ((s.entity = 'filing_documents' AND (s.entity_id IN (51, 52) OR s.entity_id IS NULL))
     OR (s.entity = 'documents'        AND (s.entity_id IN (14, 17) OR s.entity_id IS NULL))
     OR (s.entity = 'filings'          AND (s.entity_id = 8         OR s.entity_id IS NULL)));
```

Any row back: refuse with `Job #<id>: <title>` and write nothing.

3. **The one-script swap.** Row A at ordinal a, row B at ordinal b; here A is row 51 at 2 and B is row 52 at 3:

```sql
UPDATE filing_documents SET ordinal = 3
 WHERE id = 51 AND ordinal = 2
   AND (SELECT ordinal FROM filing_documents WHERE id = 52) = 3
   AND filing_id IN (SELECT id FROM filings WHERE filed_on IS NULL AND retired_on IS NULL);
UPDATE filing_documents SET ordinal = 2
 WHERE id = 52 AND ordinal = 3
   AND (SELECT ordinal FROM filing_documents WHERE id = 51) = 3;
```

Statement order matters, as in §6. The first `UPDATE` lands only if A is still at a, B at b, and the Writing is neither sent nor retired. After it, A and B both hold b, so the second `UPDATE`'s check that A holds b is the proof the first landed. If the first matched nothing (a peer moved either row, or already made the same swap), the second matches nothing too.

4. **Confirm by re-query, never by `changes`** (the returned count includes trigger writes):

```sql
SELECT id, ordinal FROM filing_documents WHERE id IN (51, 52);
```

Exchanged ordinals: landed. Old ordinals: nothing was written; say so and re-render.

5. **Move to position K.** Consecutive adjacent swaps, each its own script, re-locating (step 1) before each. Stop at the first swap that writes nothing and report the order as it then stands. Every intermediate order is valid, so a stop leaves no damage.

## 8. Quick edits through the tools

The route of `draft/references/revise-on-the-fly.md`. The session names each op with the document, Part and printed number the practitioner saw, and the revision printed on that mockup (`seen_revision`). The tools resolve, check, write and audit. No SQL is composed by the model.

**The paragraph map.** Every mockup render of a database at v79 or later records, once per revision, the map of what it printed: `paragraph-maps\<filing id>\rev-<revision>.json` in the matter's `0. DRAFT\Drafting records\` folder, the newest 20 kept. It is written only when the revision did not move during the render. Each entry names the document (`form` or `written_argument`: the venue document and the Written Arguments companion), the Part (`Part N` for a `## PART N` heading, else the heading's text), the printed number, the excerpt index under the paragraph (0 for the paragraph itself), the entity and row id, the sha256 of the stored text it prints (an order's `wording_override` when it prints one), its placement row (table, id, ordinal, part), a proposition's submission, and an override's `filing_orders` row. It is read off §2's trace comments. A positional trace (`<!-- fact N -->`, `<!-- order N -->`) carries the printed number, which counts a rhetorical paragraph printed between, so the k-th paragraph carrying it is the k-th row of the list the renderer printed, kept only when that row's text is on the paragraph's line. A paragraph naming no record this route edits is not in the map. A missing map refuses `seen_revision_unknown`.

**The ops.** A preview is one batch on one Writing. Every op resolves through the map once, so a later op still names the record the practitioner meant after an earlier op renumbers, and each is planned against the state the earlier ones leave.

| Op | What it writes | Its log line |
|---|---|---|
| `reword` | §4's `UPDATE`, guarded on the current text, on one row of §1's table. At most one per preview | `entity` §1's table (`filing_orders` for an order's `wording_override`), `entity_id` the row; `old_hash` and `new_hash` the sha256 of the text before and after |
| `move` | Puts the target before or after its anchor in its placement list and gives the list its own ordinals again, sorted, so a rhetorical paragraph on the same scale keeps its place among the rows; writes only rows whose ordinal changes, each guarded on its current ordinal. A fact moves on the form only; a submission or order on one document or both. An anchor on a proposition places a submission at that proposition's submission | one per document moved on: `entity` and `entity_id` the paragraph, `deployment_id` its placement row (`filing_facts`, `filing_submissions`, `filing_orders`); `from` and `to` the row's position in its list, counting from 1, before and after |
| `recast` | Inserts a fact or submission with the source's text, placed at the anchor (one ordinal past the list's last, then renumbered as a move), then takes the source off the documents named, each as a `remove`. With `detach`, first deletes the source fact's `submission_facts` rows for the submissions on this Writing's form, which detaches it wherever those submissions print | the source's `remove` lines, then one: `entity` `facts` or `submissions`, `entity_id` the new row; `old_hash` and `new_hash` the sha256 of the text, which is the source's |
| `remove` | Deletes the placement row on each document named (`form`, `written_argument` or `both`). The row stays in the pool, held in reserve | one per document: `entity` and `entity_id` the paragraph, `deployment_id` the row deleted, `from` its stored ordinal |
| `restore` | Re-inserts a removed row, named by its `remove` line in this Writing's log (`remove_line`, counting from 1), on that line's document, before the first row now at or past its `from`. A fact goes back into the Part a remove takes it from | `entity` and `entity_id` the paragraph, `deployment_id` the new row, `to` its stored ordinal |
| `kill` | `killed_on` set to today on a submission or proposition not yet killed. A submission also comes off every drafting Writing in the same write (sent and retired Writings keep their rows) | `entity` `submissions` or `law_assertions`, `entity_id` the row, `to` the date written |

**The quick-edits log.** `drafting_forms__apply_edit` audits each edit in `quick-edits-<filing id>.jsonl` in the matter's `0. DRAFT\Drafting records\` folder, one JSON line per change, appended once the write's transaction commits, never before. Every line carries `applied_at`, `session_token`, `preview_token`, `seen_revision`, `new_revision` (the revision the write left), `op`, `document`, `entity`, `entity_id`, `deployment_id`, `from`, `to`, `old_hash` and `new_hash`, with null where the table above names nothing. It holds ids, ordinals and text hashes, never an editable copy of matter text. The file is append-only: nothing rewrites or deletes a line, and a restore names a remove by its line. A refused apply appends nothing. `paragraph_revisions` is untouched: a quick edit writes no row there, so the table's choices, CHECKs and columns stay as they are, and no schema change carries the quick edits. §7 is the precedent: a material move writes no `paragraph_revisions` row either.

**`drafting_forms__preview_edit`.** It writes nothing to the database. In order:

1. Resolve every target and anchor through the map of `seen_revision`.
2. Pin check: for every paragraph named, compare its current text hash, its placement row's ordinal and existence, and a proposition's link to its submission with the map. Any difference refuses `changed_since_seen`, listing each. After planning, the same check runs over every printed paragraph whose placement row the plan renumbers. Edits elsewhere in the Writing do not refuse.
3. Run the exact statements `drafting_forms__apply_edit` will run on a disposable copy of the database, with every trigger and guard firing, reading the drafting tables before and after to name every row the statements and their triggers inserted, updated or deleted. A raise refuses `guard_refused` and returns the guard's message verbatim. The live database is never opened for writing: the trial's transaction commits on the copy, which is deleted after the trial render.
4. The foreign-scope read, §3's query over every row named, written or touched by a trigger, each such table's whole-table scope (`entity_id` NULL), and `filings` for this Writing. Any row back refuses `foreign_job`, naming each job.
5. Render the live database and the trial copy in memory, map both, and diff them: one block per affected document, the before and after text of every paragraph whose text, number or Part changes. Consequences: markers added and cleared per paragraph, 🧐 re-raised, completion criteria gained or lost, other Writings printing a changed row, and attachments detached. The trial mockups go to `previews\<filing id>\` in the records folder.
6. An appliable preview stores its token host-local, beside the write lock: the statements, each precondition, the scope rows, the session token, and an expiry 30 minutes out. It is single use.

**`drafting_forms__apply_edit`.** It refuses a token that is unknown, expired, used or another session's, and spends the token on the first call. It re-reads every precondition: each row named, written or touched by a trigger, whole; the rows of each list it renumbers or inserts into (membership only: an untouched row's ordinal is no precondition); and each proposition's link. Any change refuses `stale_preview`, naming the rows. It re-runs the foreign-scope read. It then writes the statements in one transaction, each guarded statement required to change exactly one row (a mismatch rolls everything back as `stale_preview`), appends the log lines (returning the file as `audit_log` and the lines as `audit_lines`), and re-renders the Writing.

**The gate.** `hooks/practitioner-words-gate.py` also runs before `drafting_forms__apply_edit`. It reads the preview's own result in the session transcript, by its token, and allows the call only when the session's reply before the practitioner's last turn printed exactly the preview's diff blocks, each verbatim as its own fenced code block and no other, the last turn is a bare yes, no other write has been answered since that turn, and a reword with `choice` `proposed` is an unbroken run of one practitioner turn.
