# Counsel's review records

Owned by `/drafting-data`. Two tables hold counsel's review: `review_approvals` and `review_points` (schema v27). Both are exempt from the `filing-checklists.md` §8 revision bump: neither carries a revision trigger. `review_approvals` is append-only: no UPDATE and no DELETE, anywhere. The marker rule lives in `work-markers.md` row 🧐. This file holds the storage rules.

## Snapshot fields

A snapshot is the object's stored fields as counsel reviewed them, never its rendered wording. SQLite's `json_object` serializes it, with the keys below in this order and a NULL column as `null`. **No other serializer ever produces a snapshot**, neither Python's `json.dumps` nor JavaScript's `JSON.stringify`. The writer stores `json_object(...)` by `INSERT … SELECT` from the object's row, and the renderer computes the same expression in its own SELECT, so equality is byte equality. A REAL column (`amount`) serializes as SQLite prints it, for example `150000.0`. A JSON-text column (`template_values`) is passed as the plain column and serializes as an escaped JSON string, so never wrap a column in `json()`. The writer builds the snapshot with `json_object` in SQL on the same database, never with a host-language serializer.

| Object kind | Table | Snapshot keys, in order | Expression |
|---|---|---|---|
| statement of law | `statements_of_law` | `excerpt`, `pinpoint`, `treatment` | `json_object('excerpt', excerpt, 'pinpoint', pinpoint, 'treatment', (SELECT a.treatment \|\| COALESCE(' — ' \|\| a.treatment_note, '') FROM authorities a WHERE a.id = statements_of_law.authority_id))` |
| statement of fact | `statements_of_fact` | `excerpt`, `pinpoint`, `exhibit_excerpt`, `exhibit_pinpoint` | `json_object('excerpt', excerpt, 'pinpoint', pinpoint, 'exhibit_excerpt', exhibit_excerpt, 'exhibit_pinpoint', exhibit_pinpoint)` |
| proposition | `law_assertions` | `proposition`, `overruled_statement_ids`, `supporting_statements` | `json_object('proposition', proposition, 'overruled_statement_ids', (SELECT group_concat(s.id ORDER BY s.id) FROM statements_of_law s JOIN authorities a ON a.id = s.authority_id WHERE s.law_assertion_id = law_assertions.id AND a.treatment = 'overruled'), 'supporting_statements', (SELECT json_group_array(json_object('id', s.id, 'excerpt', s.excerpt) ORDER BY s.id) FROM statements_of_law s WHERE s.law_assertion_id = law_assertions.id))` |
| postulate | `facts` | `postulate`, `court_record_pinpoint` | `json_object('postulate', postulate, 'court_record_pinpoint', court_record_pinpoint)` |
| submission | `submissions` | `contention` | `json_object('contention', contention)` |
| order sought | `order_sought` | `wording`, `template_key`, `template_values`, `amount`, `basis_statements`, `basis_excerpts` | `json_object('wording', wording, 'template_key', template_key, 'template_values', template_values, 'amount', amount, 'basis_statements', (SELECT group_concat(concat(r.excerpt_id, ':', a.treatment, ' — ' \|\| a.treatment_note) ORDER BY r.id) FROM order_sought_requires r JOIN statements_of_law s ON s.id = r.excerpt_id JOIN authorities a ON a.id = s.authority_id WHERE r.order_sought_id = order_sought.id AND r.basis_state = 'filled'), 'basis_excerpts', (SELECT json_group_array(json_object('id', s.id, 'excerpt', s.excerpt) ORDER BY s.id) FROM order_sought_requires r JOIN statements_of_law s ON s.id = r.excerpt_id WHERE r.order_sought_id = order_sought.id AND r.basis_state = 'filled'))` |
| a Writing's own wording of an order sought | `filing_orders` | `wording_override` | `json_object('wording_override', wording_override)` |
| clause | `clauses` | `wording`, `basis`, `pinpoint`, `excerpt`, `excerpt_id`, `cited_overruled` | `json_object('wording', wording, 'basis', basis, 'pinpoint', pinpoint, 'excerpt', excerpt, 'excerpt_id', excerpt_id, 'cited_overruled', (SELECT 1 FROM statements_of_law s JOIN authorities a ON a.id = s.authority_id WHERE s.id = clauses.excerpt_id AND a.treatment = 'overruled'))` |
| prose slot | `filing_prose` | `text` | `json_object('text', text)` |
| rhetorical paragraph | `rhetorical_paragraphs` | `wording` | `json_object('wording', wording)` |

`entity` is the table name and `entity_id` the row id, the `ticket_scope` shape. The TypeScript mirror is `REVIEW_SNAPSHOT_FIELDS` in `source/lawyer/mcp/src/submission/forms/markers.ts`, pinned to this table by `source/lawyer/mcp/test/counsel-review-marker.unit.test.mjs`: change both or neither. Marker columns (`verification`, `source`, `doubt`) are left out because they hold work state, not content; `treatment` is left out as a column but read by four of the derived keys below, because it is the one marker column whose value counsel's review confirms. A Writing's own wording of an order sought (`filing_orders.wording_override`) is set per Writing, while the order's approval is per object and holds for every Writing that deploys it, so the override is an object of its own: the Writing's `filing_orders` row, `entity_id` that row's `id` (practitioner's decision, 2026-10-05). An order's line carries 🧐 when its `order_sought` object needs review, or when that Writing's `filing_orders` row holds a non-NULL `wording_override` whose current snapshot differs from its latest `filing_orders` approval or has none. A NULL override raises no 🧐 by itself. `filing_orders` has no `proceeding_id`, so a Writing's order row's proceeding is its Writing's (`filings.proceeding_id`) for the current-snapshot read. `filing_clauses.wording_override` is left out because it is set per Writing, while a clause's approval is per object. A clause keeps `excerpt_id`, a reference column, because an implied clause has no excerpt or pinpoint of its own; `document_id` is left out as every other reference column is. A prose slot snapshots its `text` alone: `filing_id` and `slot` identify the row and are left out, as every reference column is. `filing_prose` has no `proceeding_id`, so a prose slot's proceeding is its Writing's (`filings.proceeding_id`), for the current-snapshot read and for a discussion point's anchor join. A rhetorical paragraph (v71) snapshots its `wording` alone: `states_law` and `states_fact` are drafter-recorded classifications that drive advisory tags, not content counsel approves, and its links and placements are reference rows, left out as every reference column is. Six keys are no column of the row, each a correlated subquery that reads from the object's own row, so the writer's `INSERT … SELECT … FROM <table>` and the renderer compute the same bytes. A clause snapshots `cited_overruled`: 1 while its cited statement's authority has `treatment = 'overruled'`, else NULL, because the clause line shows ⛔ bare and counsel's 🧐 there confirms the overruling. A statement of law snapshots its authority's `treatment`, because ⚠️ ⊕ 🚨 render beside its 🧐 and counsel's review of the line is the routing decision they ask for. The `treatment` key is not the bare column: it is the derived expression above, the authority's treatment followed by ` — ` and its note-up note (`treatment_note`, v51) while it holds one, and `basis_statements` appends the same ` — <note>` to each edge's treatment, so a changed note re-raises 🧐 and a NULL note computes the bytes it computed before v51 (in the table, `\|` is a pipe escaped for the table: the expression carries no backslash). A proposition snapshots `overruled_statement_ids`, the ids of its statements whose authority is overruled, joined in id order (`group_concat … ORDER BY` needs SQLite 3.44 or later), else NULL, because its line shows ⛔ while any of them is and counsel's 🧐 there confirms the overruling. An order sought snapshots `basis_statements`: for each of its `filled` jurisdictional edges (`order_sought_requires`), the statement's id and its authority's treatment as `id:treatment`, an unnoted treatment as `id:` (`concat` reads NULL as empty, and needs SQLite 3.44 or later), joined in edge-id order, else NULL. The treatment is in because, wherever the order's line prints its jurisdictional ladder, it prints each such edge's ⚠️ ⊕ 🚨 beside its 🧐. A line that prints no ladder (the BCCA factum and response book, the requisition) still re-raises 🧐 on the same snapshot. The statement id is in because the basis is the order's own content, as `excerpt_id` is a clause's, so a replaced or added basis re-raises 🧐 once 🏛️ clears. A killed or overruled edge stays in unfiltered: the kill moves nothing, and the overruling holds 🧐 behind 🏛️ until the authority is replaced. A `needed` or `dead_end` edge is left out, because neither reads its treatment before returning its own marker. So a change of treatment after approval re-raises 🧐 on the statement and order lines, and an overruling after approval re-raises it on the clause and proposition lines (`work-markers.md` row 🧐). A proposition snapshots `supporting_statements`: for each statement of law linked to it (`statements_of_law.law_assertion_id`), the statement's id and its `excerpt`, as a JSON array of `{"id", "excerpt"}` objects in statement-id order, a NULL excerpt as `null`, and `[]` when it has none. An order sought snapshots `basis_excerpts` in the same shape, for the statements on the `filled` edges that `basis_statements` reads, in statement-id order, and `[]` when it has none. Counsel's approval of a proposition or an order attests fit, that these authorities support this wording, while a statement of law's approval attests only that its quote is accurate and its pinpoint finds it. So linking, unlinking or replacing a supporting statement, or a scrutiny settle write that replaces a statement's excerpt in place on the same row (`scrutiny.md`), re-raises 🧐 on the proposition or order line as well as on the statement's. The pinpoint and the authority are left out: a pinpoint-only correction does not change fit and the statement line catches it, and the same words re-attributed to another authority on the same row are left to the statement line (practitioner's decision, 2026-10-08). `json_group_array … ORDER BY` needs SQLite 3.44 or later, the same floor as `group_concat … ORDER BY`. The kill is left out of all six: it is counsel's own act, and a killed authority's statement stays in `overruled_statement_ids`. An approval written before its kind gained one of these keys matches no current snapshot, so each such object shows 🧐 once more until counsel approves it again. In the same way, no `filing_orders` row had an approval before 2026-10-05, so every order a Writing prints with a non-NULL `wording_override` shows 🧐, even where the order itself is approved, until counsel approves that Writing's row.

## Reads

The latest approval of each object:

```sql
SELECT entity, entity_id, snapshot FROM review_approvals ra
WHERE ra.id = (SELECT MAX(id) FROM review_approvals WHERE entity = ra.entity AND entity_id = ra.entity_id);
```

Latest means the greatest `id`. The table is append-only, so ids only grow, and `approved_at` is minute-grained, so it cannot break a tie.

The current snapshot of one kind's rows, for example:

```sql
SELECT id, json_object('excerpt', excerpt, 'pinpoint', pinpoint, 'treatment', (SELECT a.treatment || COALESCE(' — ' || a.treatment_note, '') FROM authorities a WHERE a.id = statements_of_law.authority_id)) AS snapshot FROM statements_of_law WHERE proceeding_id = 7;
```

🧐 fires when the two differ or when the object has no approval, on a `filing_orders` row only while its `wording_override` is set ("Snapshot fields"). Nothing is stored for "changed".

The open discussion points of one review job, oldest first:

```sql
SELECT id, entity, entity_id, created, comment FROM review_points WHERE ticket_id = 10 AND resolution IS NULL ORDER BY id;
```

**The resume position** (design §6) is derived, never stored. Document order is the renderer's, and no column holds it, so no query here returns the position. The review session takes the first 🧐 line on the Writing's mockup, in page order, whose unit has no open point by the read above. An approved unit whose content is unchanged carries no 🧐, so it is skipped by construction.

## Writes

Every write here is made by the session holding the review job (`references/jobs-stock.md` §3c), under that job's lock, and every statement carries `references/jobs-run.md` §5's guard: the job's `locked_by` is still this session's own `session_token`. Values are literals composed into the script, since `drafting_data__execute` takes no bind parameters. The examples use review job `10` and token `'sess-a1'`. One approval is written outside a review job: a letter's prose slots once `/draft`'s delivery check has set them to the letter as sent and the Sent write has recorded it, guarded on the Writing being sent instead of on a lock (`filing-checklists.md` §13, "Counsel's review carried forward").

**The approval.** One row per object whose 🧐 is on the line of a unit the practitioner approves, written by `INSERT … SELECT` from the object's own row, so the snapshot is the stored fields as they stand at the write:

```sql
INSERT INTO review_approvals (entity, entity_id, approved_at, session_token, practitioner, revision, snapshot)
  SELECT 'statements_of_fact', id, strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), 'sess-a1', 'Pat Example',
         (SELECT CAST(value AS INTEGER) FROM db_meta WHERE key = 'revision'),
         json_object('excerpt', excerpt, 'pinpoint', pinpoint, 'exhibit_excerpt', exhibit_excerpt, 'exhibit_pinpoint', exhibit_pinpoint)
    FROM statements_of_fact WHERE id = 12
      AND EXISTS (SELECT 1 FROM tickets WHERE id = 10 AND locked_by = 'sess-a1');
```

For another kind, `entity`, the `FROM` table and the snapshot expression are that kind's row of the table above, copied exactly. An order's line holds two objects: its `order_sought` row and, while the review job's Writing's `filing_orders` row for that order holds a `wording_override`, that `filing_orders` row. Each of the two whose current snapshot differs from its latest approval, or that has none (§Reads), gets its own approval row. The `filing_orders` approval takes that row's `id`, never the order's, and its `wording_override IS NOT NULL` predicate inserts nothing for a NULL override:

```sql
INSERT INTO review_approvals (entity, entity_id, approved_at, session_token, practitioner, revision, snapshot)
  SELECT 'filing_orders', id, strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), 'sess-a1', 'Pat Example',
         (SELECT CAST(value AS INTEGER) FROM db_meta WHERE key = 'revision'),
         json_object('wording_override', wording_override)
    FROM filing_orders WHERE id = 31 AND wording_override IS NOT NULL
      AND EXISTS (SELECT 1 FROM tickets WHERE id = 10 AND locked_by = 'sess-a1');
```

`approved_at` is `references/jobs-common.md` §0's timestamp. `session_token` is the session identity of `references/jobs-common.md` §1. `practitioner` is counsel of record of the review job's proceeding's client party (`is_client = 1`), which case data owns (party/counsel SSOT): read through `/matter-data` for that party, matched by its `case_party_id`, and copied into the statement verbatim, never typed from memory. Where more than one client party names counsel, the one with the lowest `ordinal` is taken. Where none does, the approval is not written: the session records counsel of record through `/matter-data` and runs the approval again. `revision` is read from `db_meta` in the same statement, never typed. `entity_id` comes from the row itself, so a wrong id inserts nothing rather than an approval of a row that does not exist. A bulk approval (`/draft`'s counsel review) is this statement once per object, many in one `execute` script, each with its own lock guard and its own confirm-read ("Confirm-read after each write").

**The grant of an implied clause.** Counsel's grant of a clause whose `basis` is `'implied'` is this approval, written against the `clauses` row by the session holding the review job, never mid-drafting (#1078). Nothing else records a grant. Until an approval matches its current snapshot, the clause carries 🧐 on the mockup unless another work marker holds the line (`work-markers.md` row 🧐). An express clause is approved the same way.

**A discussion point.** The practitioner's comment, verbatim, anchored on the unit it is about. `filing_id` is the review job's own. The insert selects from the anchor table's own row joined with the review job on their proceeding, so a wrong `entity_id` inserts nothing, as the approval does. For another kind, `entity` and the anchor table are that kind's; for a prose slot, join through `filings` on `filing_id` (see "Snapshot fields"):

```sql
INSERT INTO review_points (filing_id, ticket_id, entity, entity_id, created, comment)
  SELECT t.filing_id, t.id, 'submissions', a.id, strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), 'Is this the strongest way to put the delay point?'
    FROM submissions a JOIN tickets t ON t.proceeding_id = a.proceeding_id
    WHERE a.id = 4 AND t.id = 10 AND t.locked_by = 'sess-a1';
```

**Resolving a point.** `resolution` is NULL while the point is open. `answered` and `leave_it` close it and write nothing else. `AND resolution IS NULL` stops a closed point being resolved twice:

```sql
UPDATE review_points SET resolution = 'answered', resolved_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 5 AND resolution IS NULL
    AND EXISTS (SELECT 1 FROM tickets WHERE id = review_points.ticket_id AND locked_by = 'sess-a1');
```

`leave_it` is the same statement with `resolution = 'leave_it'`.

**Change wanted.** Two calls, since a loose thread lives in another file. First close the point, with the open-point and lock predicate, so a point that is no longer open captures nothing:

```sql
UPDATE review_points SET resolution = 'change_wanted', resolved_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 5 AND resolution IS NULL
    AND EXISTS (SELECT 1 FROM tickets WHERE id = review_points.ticket_id AND locked_by = 'sess-a1');
```

Then, when the confirm-read below shows it landed, capture the loose thread in the practitioner's words by `references/jobs-run.md` §8: `idea` verbatim, at most five sentences, `surfaced_by` naming the review job, `origin_job` the review job, `filing_id` the point's, and `ref` `review_points:5`, which is the link. `seed_id` holds only a link written before threads moved: the number of the same thread in the store, since ids are kept. It takes no new number, because the reference it carries has no row in `seeds` to find.

The loose thread shows on the Loose Threads page until an outlining session turns it into a job (`references/jobs-create.md` §3). None of these writes moves `db_meta.revision`.

**Confirm-read after each write.** As with every guarded write in `/drafting-data`, a review write that matches nothing returns `{"ok": true}` with zero rows, so a read after each write is the only proof it landed. After an approval, read the latest approval of that unit, `SELECT id, session_token, snapshot FROM review_approvals WHERE entity = 'statements_of_fact' AND entity_id = 12 ORDER BY id DESC LIMIT 1`: it landed when that row carries this session's token and its snapshot equals the unit's current snapshot (§Reads). After a point insert, read the job's newest point, `SELECT id, entity, entity_id, comment FROM review_points WHERE ticket_id = 10 ORDER BY id DESC LIMIT 1`, which must carry the anchor and comment just written. After a resolution, read the point's row, `SELECT resolution, resolved_at FROM review_points WHERE id = 5`, which must carry the resolution just written.

## Render freshness

An approval moves no revision, so the render stamp carries the greatest `review_approvals.id` (`RenderStamp.approvals` in `source/lawyer/mcp/src/submission/render-manifest.ts`). The next render after an approval therefore re-renders, and does not archive.
