# Operation: theorize-fact (mint / dismiss a theorized fact)

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `coclerk.json` only to confirm initialization; halt on any tool error per §2.3. Every write here goes through one `case_data__execute` call (§2.3), which loads the cross-database FK layer itself. It must load, because `fact_provenance.fact_id` and `privileged_sources.proceeding_id` are trigger-enforced.

A **theorized fact** is a fact theorized for investigation — it cannot be derived from anything, so it is recorded, but it is not a party position and not a posture. Its provenance is the **case theory itself**, modelled as a well-known placeholder source. It is privileged work product, so its row in `main.facts` is a **bare row**: an ID and nothing else (design-decisions.md #67, [`bare-privileged-facts.md`](bare-privileged-facts.md) §1). Its wording, category and the caller's note live on the privileged side, and no drafting step reads it from `main`. See design-decisions.md #23. Two write paths live here: **mint** and **dismiss** (terminal). Minting is never called "postulating" — see design-decisions.md #23 on that word. Reading which facts are still theorized is [`query.md`](query.md)'s `@query_22_theorized_facts`, not this operation.

The placeholder-source convention (one per application, created lazily):

- database: `privileged.sqlite`, table `privileged_sources`
- `category = 'privileged_work_product'`
- `title = 'Theory of the case — <app-id>'` (em dash `—`, exactly — `@query_22` and the dismiss target both match on this title)

---

## Mint — theorize a fact the case theory needs

**Caller supplies:** `description` (the theorized fact), `category` (facts soft vocabulary — `background|contract|payment|breach|employment|damages|procedure|liability|credibility`), `proceeding_id` (the application's proceeding), `app_id` (the application identifier, e.g. `2026-07-19-smoke-injunction`), and optionally `source_note` (how/why the theory posits it).

The mint path now typically records a fact the practitioner has stated rather than one the caller inferred, so `source_note` should carry the caller's classification of the answer and the named source it came from — e.g. `Elicited (believed, source: J. Chen) to fill E2; sitting 2026-08-06`.

Build one `sql_script` of three ordered statements. Inline every text value as a SQL string literal with single quotes **doubled** (`O'Brien` → `'O''Brien'`); `case_data__execute` takes no per-statement `params` channel.

```sql
-- 1. Ensure the application's theory placeholder source exists (idempotent).
INSERT INTO privileged.privileged_sources (proceeding_id, category, title)
SELECT <proceeding_id>, 'privileged_work_product', 'Theory of the case — <app_id>'
WHERE NOT EXISTS (
  SELECT 1 FROM privileged.privileged_sources
  WHERE category = 'privileged_work_product'
    AND title = 'Theory of the case — <app_id>'
);

-- 2. Insert the theorized fact as a bare row: an ID and nothing else. The
--    description is empty text, not the wording. created_date is NULL on purpose
--    (its default is today's date). Every other column takes its NULL or 0
--    default (bare-privileged-facts.md §1).
INSERT INTO main.facts (description, created_date)
VALUES ('', NULL);

-- 3. Link its provenance to the theory source, and put the wording there.
--    last_insert_rowid() is the fact just inserted in statement 2 (the most
--    recent INSERT on the connection; statement 1's conditional insert, if it
--    fired, ran earlier). The record format is bare-privileged-facts.md §2:
--    STATEMENT: first, then CATEGORY:, then the caller's note unchanged when
--    there is one (append `|| char(10) || '<source_note>'`; with no note, stop
--    after the CATEGORY line). Line breaks in any value are written as a
--    single space.
INSERT INTO privileged.fact_provenance
  (fact_id, source_id, source_note, disposition, verified)
VALUES (
  last_insert_rowid(),
  (SELECT source_id FROM privileged.privileged_sources
   WHERE category = 'privileged_work_product'
     AND title = 'Theory of the case — <app_id>'),
  'STATEMENT: <description>' || char(10) || 'CATEGORY: <category>',
  'active', 0
);
```

Why these values:

- **A bare row** — a theorized fact is the case theory's own statement, so it is privileged work product by the same reasoning as the Theory of the Case, and a rewording would be another privileged statement. The non-privileged store therefore holds only the ID, which is all an argument's `facts` frontmatter needs to cite. Its row gains wording only when a non-privileged source states the same Fact ([`bare-privileged-facts.md`](bare-privileged-facts.md) §5). Never draft a non-privileged sentence from the wording.
- **`source_id NULL`** on the fact — a theorized fact has no evidentiary source. The theory is *provenance*, not evidence; it lives only on the `fact_provenance` link (decision #4: provenance ≠ evidence).
- **`verified 0`** — a theorized fact is not a source extraction, so it is never extraction-verified; `0` (unverified) is the honest state. Do not set `1` — nothing verified it. The row does not appear in `v_fact_status` or the verification backlogs either way, because it is bare. `notes` stays NULL.
- **`disposition 'active'`** — the open investigative state. The stage-9 verifier tolerates such a fact as `theorized_only`.

Return the new `fact_id` (query it back if the harness does not surface `last_insert_rowid()`), so the caller can cite it in an argument's `facts` frontmatter — fact ids stay opaque integers, no grammar change.

---

## Dismiss — terminal disposition

Set `disposition = 'dismissed'` on the theory-provenance row when our own investigation concludes the fact is likely untrue. **Terminal — never delete** (decision #3: promotion/lifecycle never deletes; the audit trail is the point). Dismissal is a **practitioner-authorized** act — the calling application pipeline never dismisses a theorized fact autonomously, wherever in its argument loop the conclusion is reached; it mirrors the authority-gap rule that AI dismisses only for mootness. This operation only executes the write it is asked to make.

`dismissed` applies only to **our own** side's investigation — there is no way to know what the other side has privately dismissed.

**Caller supplies:** `fact_id`, `reason` (the disposition, verbatim).

```sql
UPDATE privileged.fact_provenance
SET disposition = 'dismissed',
    source_note = 'DISMISSED (' || date('now','localtime') || '): <reason>'
                  || CASE WHEN source_note IS NOT NULL AND TRIM(source_note) != ''
                          THEN ' | prior: ' || source_note ELSE '' END
WHERE fact_id = <fact_id>
  AND source_id IN (
    SELECT source_id FROM privileged.privileged_sources
    WHERE category = 'privileged_work_product'
      AND title LIKE 'Theory of the case —%'
  );
```

`DISMISSED (...)` is plain human-readable context, deliberately **not** one of the machine-detected `notes` prefixes (§5) — `fact_provenance.source_note` is not a `review_queue` surface, and the load-bearing marker is the `disposition` column, not the note. It is prepended ahead of the `STATEMENT:` line, which readers find by its label ([`bare-privileged-facts.md`](bare-privileged-facts.md) §2).

A theorized fact graduates in two steps. First a non-privileged source states the same Fact and the practitioner names the bare ID, so the row takes that source's own Statement of Fact ([`bare-privileged-facts.md`](bare-privileged-facts.md) §5). Only then may a real `evidence_link` land, because nothing links to a bare row (#67). Once it lands, the fact ceases to be theorized **by construction** (`@query_22` excludes it) — no "evidenced" marker exists or is needed. The theory provenance stays as the history of how the fact entered. Do not dismiss such a fact; it graduated, it was not disproven.

---

`case_data__execute` regenerates `evidence.sql` automatically on success. Report the `fact_id` minted (or dismissed) and stop.
