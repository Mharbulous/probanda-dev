# Operation: bare-privileged-facts (the bare row: its record, emptying old rows, filling one)

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3. Every read runs through `matter_data__query` and every write through `matter_data__execute`, with `matter_root` on every call. `matter_data__execute` takes no per-statement `params` channel: inline every value as a SQL literal, single quotes doubled.

A Fact known only through privileged sources is a **bare row** in `main.facts`: an ID and nothing else. The rule is `../references/design-decisions.md` #67, and the requirement behind it is REQ-0002 (privilege attaches to Statements of Fact, never to Facts). Any summary, paraphrase or abridgement of a privileged statement is itself privileged, so the non-privileged store never holds one. Only the privileged store knows what the ID means.

This file owns three things: the bare row's exact state (§1), the privileged record that carries its meaning (§2), and the two moves that change a row: **Empty** (§4, for rows written before #67) and **Fill** (§5, when a non-privileged source later states the same Fact). New bare rows are written by [`theorize-fact.md`](theorize-fact.md) (Mint), [`ingest-extract.md`](ingest-extract.md) Path B "Yes" and [`resolve-privilege.md`](resolve-privilege.md) Step 4b, each to the state and the record defined here.

**The practitioner makes every privilege call** (decision #2). Emptying applies the consequence of a call already made. It never decides whether anything is privileged.

---

## 1. The bare row

`main.facts` holds exactly this and nothing more:

| Column | Value |
|---|---|
| `fact_id` | the ID, sequential as always (#67: the order and the count reveal nothing about content) |
| `description` | `''` (the column is `NOT NULL`, so empty text, never NULL) |
| `created_date` | `NULL`, set explicitly: its default is today's date, and a date is more than an order |
| `category`, `date_of_fact`, `source_id`, `source_locator`, `notes`, `basis_of_knowledge`, `informant` | `NULL` |
| `verified`, `human_reviewed`, `pending_reverification` | `0` |

**Nothing in the non-privileged store links to a bare row.** A position, evidence link, admission, criterion link or issue link would say what kind of Fact it is, and that is information about its nature. A writer whose target `fact_id` is a bare row stops and reports. Only [Fill](#5-fill-a-non-privileged-source-states-the-same-fact) turns a bare row into an ordinary one.

**Every read that builds a draft, list, book or page skips bare rows** (`description <> ''`): `v_fact_status` (and so `get_facts_for_drafting.py`), `@query_05a` and `@query_05b` do, and an ad-hoc read must (`query.md` §2). A bare row never renders as a blank line or a placeholder. Only `@query_10` and `@query_22` show what a bare row means, by reading the privileged record. Their output is the practitioner's.

## 2. The privileged record

The Statement of Fact, and every other column the main row held, go on `privileged.fact_provenance.source_note` as labelled lines. The format is the only definition of it: other files point here.

```
STATEMENT: <the wording, on one line>
CATEGORY: <category>                 (only when the row had one)
DATE OF FACT: <date_of_fact>         (only when set)
BASIS OF KNOWLEDGE: <value>          (only when set)
INFORMANT: <informant>               (only when set)
NOTES: <notes, on one line>          (only when set)
LOCATOR: <source_locator>            (only when set)
CREATED: <created_date>              (only when set)
HUMAN REVIEWED: 1                    (only when it was 1)
<any earlier note text, unchanged>
```

- `STATEMENT: ` is first. Readers find a label by its first occurrence in the note, not by its position: a dismissal prepends `DISMISSED (...) | prior:` to the note (`theorize-fact.md`), and the label still sits after it.
- A line break inside any value is written as a single space. A Statement of Fact is one line here.
- The record goes on **one** provenance row of the fact, the lowest `source_id`. A fact that several privileged sources explain does not have its wording attributed to each of them, and `@query_10` and `@query_22` read the lowest `source_id` that carries one.
- The wording is the privileged source's own, copied. **It is never drafted, rephrased or summarised**: that would be a new privileged statement.
- No index, full-text table or embedding is ever built over these lines for use on the non-privileged side. An embedding is derived from the content, and comparing it with a non-privileged statement's embedding reveals how close the two are.

The `verified` value the main row held is copied to the provenance row's own `verified` column when that column is `0`. A rejected fact (`-1`) and a flagged one (`2`) keep that value there, on the privileged side.

## 3. Dry run (read-only, counts and IDs only)

Run first, per matter. It reads no text. One row per fact that has no main source and a non-empty description:

```sql
SELECT f.fact_id,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM privileged.fact_provenance fp
                          WHERE fp.fact_id = f.fact_id) THEN 'unexplained'
         WHEN EXISTS (SELECT 1 FROM main.positions x WHERE x.fact_id = f.fact_id)
           OR EXISTS (SELECT 1 FROM main.evidence_links x WHERE x.fact_id = f.fact_id)
           OR EXISTS (SELECT 1 FROM main.admissions x WHERE x.fact_id = f.fact_id)
           OR EXISTS (SELECT 1 FROM main.criteria_facts x WHERE x.fact_id = f.fact_id)
           OR EXISTS (SELECT 1 FROM main.issue_facts x WHERE x.fact_id = f.fact_id)
         THEN 'blocked'
         ELSE 'empty'
       END AS action,
       CASE
         WHEN EXISTS (SELECT 1 FROM privileged.fact_provenance fp
                      JOIN privileged.privileged_sources ps ON ps.source_id = fp.source_id
                      WHERE fp.fact_id = f.fact_id
                        AND NOT (ps.category = 'privileged_work_product'
                                 AND ps.title LIKE 'Theory of the case%'))
         THEN 'privileged_source'
         WHEN EXISTS (SELECT 1 FROM privileged.fact_provenance fp
                      WHERE fp.fact_id = f.fact_id) THEN 'theorized'
       END AS shape,
       f.verified,
       (instr(COALESCE(f.description, '') || COALESCE(f.notes, '')
              || COALESCE(f.informant, '') || COALESCE(f.source_locator, ''), char(10)) > 0
        OR instr(COALESCE(f.description, '') || COALESCE(f.notes, '')
                 || COALESCE(f.informant, '') || COALESCE(f.source_locator, ''), char(13)) > 0
       ) AS line_break
FROM main.facts f
WHERE f.source_id IS NULL AND f.description <> ''
ORDER BY action, f.fact_id;
```

Count the rows by `action` and `shape`, and show the practitioner the counts **and the `fact_id`s of every `empty` row** before asking for approval.

- `empty` rows are what §4 will empty. `shape` splits them into `privileged_source` and `theorized`.
- Of the `empty` rows, count those with `verified = -1` (a rejected fact: it is emptied too, because its wording is just as privileged, and it reads as unverified once bare) and those with `verified = 2` (a flagged fact: it leaves the lawyer's review queue, and nothing on the privileged side queues it, so tell the practitioner and let them decide whether to review it first). Count those with `line_break = 1`: their line breaks are folded to single spaces.
- `blocked` rows are **not emptied**. A link to the row is information about its nature, and each is a stance, a proof link or a record someone relied on. Report their IDs and the tables that link to them. Deciding what becomes of the links is a separate instruction from the practitioner.
- `unexplained` rows have no provenance. Nothing says where the wording came from. They are not emptied and not touched. Report the count and the IDs.
- The `empty` test is a heuristic for "known only from a privileged source". The practitioner approving the IDs is the check on it.

## 4. Empty (rows written before #67)

**Ask first.** Show the practitioner the §3 counts and IDs for the matter and wait for approval, per `/show-me`. Then run **one** `matter_data__execute` script. The two statements run in this order inside one transaction, and the second empties a row only when its **own** wording is already on the privileged side:

```sql
-- 1. The privileged side first: the record goes onto the lowest-source_id
--    provenance row of each candidate. A row that already holds this fact's own
--    wording as a STATEMENT: line is left alone, so a re-run changes nothing.
UPDATE privileged.fact_provenance
SET source_note =
      (SELECT 'STATEMENT: ' || replace(replace(f.description, char(13), ' '), char(10), ' ')
           || CASE WHEN f.category IS NOT NULL
                   THEN char(10) || 'CATEGORY: ' || f.category ELSE '' END
           || CASE WHEN f.date_of_fact IS NOT NULL
                   THEN char(10) || 'DATE OF FACT: ' || f.date_of_fact ELSE '' END
           || CASE WHEN f.basis_of_knowledge IS NOT NULL
                   THEN char(10) || 'BASIS OF KNOWLEDGE: ' || f.basis_of_knowledge ELSE '' END
           || CASE WHEN f.informant IS NOT NULL
                   THEN char(10) || 'INFORMANT: '
                        || replace(replace(f.informant, char(13), ' '), char(10), ' ') ELSE '' END
           || CASE WHEN f.notes IS NOT NULL
                   THEN char(10) || 'NOTES: '
                        || replace(replace(f.notes, char(13), ' '), char(10), ' ') ELSE '' END
           || CASE WHEN f.source_locator IS NOT NULL
                   THEN char(10) || 'LOCATOR: '
                        || replace(replace(f.source_locator, char(13), ' '), char(10), ' ') ELSE '' END
           || CASE WHEN f.created_date IS NOT NULL
                   THEN char(10) || 'CREATED: ' || f.created_date ELSE '' END
           || CASE WHEN f.human_reviewed = 1
                   THEN char(10) || 'HUMAN REVIEWED: 1' ELSE '' END
       FROM main.facts f WHERE f.fact_id = fact_provenance.fact_id)
      || CASE WHEN source_note IS NOT NULL AND TRIM(source_note) != ''
              THEN char(10) || source_note ELSE '' END,
    verified = CASE WHEN verified = 0
                    THEN (SELECT f.verified FROM main.facts f
                          WHERE f.fact_id = fact_provenance.fact_id)
                    ELSE verified END
WHERE source_id = (SELECT MIN(p.source_id) FROM privileged.fact_provenance p
                   WHERE p.fact_id = fact_provenance.fact_id)
  AND NOT EXISTS (
    SELECT 1 FROM main.facts f
    WHERE f.fact_id = fact_provenance.fact_id
      AND instr(COALESCE(fact_provenance.source_note, '') || char(10),
                'STATEMENT: ' || replace(replace(f.description, char(13), ' '), char(10), ' ')
                || char(10)) > 0)
  AND fact_id IN (
    SELECT f.fact_id FROM main.facts f
    WHERE f.source_id IS NULL AND f.description <> ''
      AND NOT EXISTS (SELECT 1 FROM main.positions x WHERE x.fact_id = f.fact_id)
      AND NOT EXISTS (SELECT 1 FROM main.evidence_links x WHERE x.fact_id = f.fact_id)
      AND NOT EXISTS (SELECT 1 FROM main.admissions x WHERE x.fact_id = f.fact_id)
      AND NOT EXISTS (SELECT 1 FROM main.criteria_facts x WHERE x.fact_id = f.fact_id)
      AND NOT EXISTS (SELECT 1 FROM main.issue_facts x WHERE x.fact_id = f.fact_id));

-- 2. Then the main row becomes a bare row (§1). Only a row whose own wording is a
--    STATEMENT: line of one of its provenance rows is emptied. Nothing is deleted.
UPDATE main.facts
SET description = '', category = NULL, date_of_fact = NULL, source_id = NULL,
    source_locator = NULL, created_date = NULL, notes = NULL,
    basis_of_knowledge = NULL, informant = NULL,
    verified = 0, human_reviewed = 0, pending_reverification = 0
WHERE source_id IS NULL AND description <> ''
  AND EXISTS (SELECT 1 FROM privileged.fact_provenance fp
              WHERE fp.fact_id = main.facts.fact_id
                AND instr(COALESCE(fp.source_note, '') || char(10),
                          'STATEMENT: '
                          || replace(replace(main.facts.description, char(13), ' '), char(10), ' ')
                          || char(10)) > 0)
  AND NOT EXISTS (SELECT 1 FROM main.positions x WHERE x.fact_id = main.facts.fact_id)
  AND NOT EXISTS (SELECT 1 FROM main.evidence_links x WHERE x.fact_id = main.facts.fact_id)
  AND NOT EXISTS (SELECT 1 FROM main.admissions x WHERE x.fact_id = main.facts.fact_id)
  AND NOT EXISTS (SELECT 1 FROM main.criteria_facts x WHERE x.fact_id = main.facts.fact_id)
  AND NOT EXISTS (SELECT 1 FROM main.issue_facts x WHERE x.fact_id = main.facts.fact_id);
```

Re-running it changes nothing: an emptied row no longer has a description, and a provenance row that already holds the wording is skipped. If a provenance row already carried a different `STATEMENT:` line, the new record is placed above it and readers show the first.

Confirm with `matter_data__query` before any retry (conventions §2.3): re-run the §3 query and expect no `empty` rows. Then confirm each emptied fact has a provenance row whose note holds a `STATEMENT:` line. Compare counts only.

A matter on an older schema is refused by the tool. Migrate it first, through the `migration-runner` agent only (`migrate.md`).

## 5. Fill (a non-privileged source states the same Fact)

When a non-privileged source later states a bare row's Fact, the row takes **that source's own Statement of Fact**, never the privileged wording and never a blend. From then on it is an ordinary fact row and may be linked.

1. The **practitioner names** the bare `fact_id` and the non-privileged source. They find the bare ID by reading `@query_10` or `@query_22`. Never decide a match by comparing text, similarity or an embedding with the privileged record.
2. Stop and report both IDs when that source's statement already has its own fact row. Merging two fact rows is not an operation in this skill.
3. Otherwise write one statement:

```sql
UPDATE main.facts
SET description    = '<that source''s own Statement of Fact>',
    source_id      = <the non-privileged main source_id>,
    source_locator = <its locator, or NULL>,
    created_date   = date('now','localtime')
WHERE fact_id = <bare fact_id> AND description = '' AND source_id IS NULL;
```

Set `category`, `date_of_fact`, `basis_of_knowledge` and `informant` only from what that source itself states. Leave `verified` at 0. The provenance row and its `STATEMENT:` lines stay: they are the privileged record of where the Fact was first learned (#4).

## 6. Report

Report identifiers and counts only: the matter, the §3 counts by `action` and `shape`, the IDs of every row emptied, the IDs and linking tables of every blocked row, the unexplained IDs, and the count of rows emptied. Never copy a wording, a category or any fact text into the report. `matter_data__execute` regenerates `evidence.sql` on success, so there is no separate dump step.
