# Note-up returns (schema v51)

Read when: the research lawyer returns on a 📇 note-up job for an authority of kind `case`, singly or in the noting-up sweep's batch. A statute, regulation or rule records the statute-currency result instead (`filing-checklists.md`, "Recording a statute-currency result").

Only a research-agent return that names exactly one of the four words "good law", "distinguishable", "negative" or "overruled" as its finding writes. An `INCOMPLETE` memo, a refusal, or a return naming none of the four or more than one records nothing: the note-up job stays open, and the session says so once in chat. The word is never inferred from other wording. No practitioner confirmation comes before the write: counsel reviews the result afterwards through 🧐 (`references/review.md`).

| The return's word | `treatment` |
|---|---|
| good law | `'good_law'` |
| distinguishable | `'distinguishable'` |
| negative | `'negative'` |
| overruled | `'overruled'` |

## Record a return

One `UPDATE` writes `treatment` and `treatment_note` together. `treatment_note` is the return's coverage line and each qualification, verbatim, joined by `"; "`, and NULL when the return gives neither. The write is a substance write made while holding the note-up job, so run `references/jobs-common.md` §2's scope read first, and guard the statement on the proceeding and on the job's lock. Values are literals (no bind parameters), a quote inside the note doubled. The examples use authority `3`, proceeding `1`, note-up job `30` and token `'sess-a1'`.

Good law:

```sql
UPDATE authorities SET treatment = 'good_law', treatment_note = 'CanLII: noted up (2 citing decisions; 2 read)'
  WHERE id = 3 AND proceeding_id = 1 AND EXISTS (SELECT 1 FROM tickets WHERE id = 30 AND locked_by = 'sess-a1');
```

Distinguishable, a return that gave no coverage line and no qualification:

```sql
UPDATE authorities SET treatment = 'distinguishable', treatment_note = NULL
  WHERE id = 3 AND proceeding_id = 1 AND EXISTS (SELECT 1 FROM tickets WHERE id = 30 AND locked_by = 'sess-a1');
```

Negative:

```sql
UPDATE authorities SET treatment = 'negative', treatment_note = 'CanLII: noted up (12 citing decisions; 5 read)'
  WHERE id = 3 AND proceeding_id = 1 AND EXISTS (SELECT 1 FROM tickets WHERE id = 30 AND locked_by = 'sess-a1');
```

Overruled:

```sql
UPDATE authorities SET treatment = 'overruled', treatment_note = 'CanLII: noted up (30 citing decisions; 6 read)'
  WHERE id = 3 AND proceeding_id = 1 AND EXISTS (SELECT 1 FROM tickets WHERE id = 30 AND locked_by = 'sess-a1');
```

A mixed or qualified return, any of the four words with its coverage line and qualification:

```sql
UPDATE authorities SET treatment = 'good_law', treatment_note = 'CanLII: noted up (1992 CanLII 613: 43 citing decisions; 4 read, plus 1 seen through a later decision quoting it); If the record classifies each proposition separately, step 3 alone would rate ''negative (partial)''.'
  WHERE id = 3 AND proceeding_id = 1 AND EXISTS (SELECT 1 FROM tickets WHERE id = 30 AND locked_by = 'sess-a1');
```

`changes` 0 means a guard matched nothing: read the cause off §2's scope read, and never re-run against a guess. The note-up job then completes by `references/jobs-run.md` §9 (`drafting_data__complete_job`). ⛔ overruled reopens the basis slot, and `/draft` sends the replacement research question.

## Re-noting

A later return on the same authority replaces both columns by the same `UPDATE`, its note NULL when the later return gives neither. A note is never appended to.

## Invariants and how it prints

The treatment enum is unchanged, and the note raises no marker of its own: 📇 clears once `treatment` is set, whatever the note holds. The note prints as a plain-text `(note-up: <note>)` tag, whitespace runs collapsed, last on each statement-of-law citation line of the authority on the mockup, never on a proposition or order line. It is rendered for the human and withheld from the forum: the filed-face strip removes it. The note folds into the review snapshot's `treatment` key, and into `basis_statements` on an order whose filled basis cites the authority (`references/review.md`), so a changed note re-raises 🧐.
