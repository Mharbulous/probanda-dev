# Operation: ingest-submission-law

Lands the research of a **retired filing** into the law database, so the work
survives the filing that produced it and can reach the consolidation pipeline
like any other local legal knowledge.

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the
live `matter_root` per §2.2; halt on any tool error per §2.3.

**This operation consumes a payload; it never produces one.** The caller — the
drafting pipeline that retires a filing — assembles the payload from the
retired filing's own store through that store's own gatekeeper and hands it
over as a JSON file. Nothing here opens, names, or knows the shape of that
store. Everything below is matter-data's own law database.

**The script does the mapping; this operation does the perceiving and the
reporting.** [`../references/scripts/submission_law_bridge.py`](../references/scripts/submission_law_bridge.py)
is a pure JSON→SQL function: no database, no filesystem beyond its input JSON,
no clock (`--ingested-on` is a required argument). Identical input gives
byte-identical SQL, which is what makes a re-run after a recovery-and-re-retire
safe.

---

## 1. The payload contract

One JSON object. Keys the script does not know are ignored; keys it does know
are validated and a defect is **refused**, never worked around.

```json
{
  "source": {
    "kind": "submission_retire",
    "filing_id": 12,
    "filing_title": "Application response — production",
    "retired_on": "2026-09-08"
  },
  "jurisdiction": "British Columbia",
  "assertions": [
    {
      "key": "la#41",
      "name": "Relevance threshold for document production",
      "concept_type": "test",
      "description": "A document is producible if it could prove or disprove a material fact."
    }
  ],
  "authorities": [
    {
      "key": "auth#7",
      "kind": "case",
      "title": "Przybysz v. Crowe",
      "citation": "2011 BCSC 1774",
      "jurisdiction": "British Columbia",
      "disposition": "Application allowed in part",
      "verification": "verified",
      "treatment": "good_law"
    },
    {
      "key": "auth#9",
      "kind": "rule",
      "title": "Supreme Court Civil Rules, r. 7-1",
      "citation": "B.C. Reg. 168/2009, r. 7-1",
      "jurisdiction": "British Columbia"
    }
  ],
  "statements": [
    {
      "key": "sol#88",
      "assertion_key": "la#41",
      "authority_key": "auth#7",
      "relationship": "establishes",
      "proposition": "Relevance is measured against the pleadings, not against the applicant's theory.",
      "pinpoint": "para 31",
      "excerpt": "The test is whether the document may prove or disprove a material fact...",
      "verification": "verified",
      "treatment": "good_law",
      "doubt": null
    }
  ],
  "opposing_authorities": [
    {
      "key": "opp#3",
      "kind": "case",
      "title": "Biehl v. Strang",
      "citation": "2010 BCSC 1391",
      "jurisdiction": "British Columbia",
      "proposition": "Relied on for a broader production obligation.",
      "pinpoint": "para 17",
      "excerpt": null,
      "answers_assertion_keys": ["la#41"]
    }
  ],
  "oral_decision": {
    "court": "BCSC",
    "file_number": "S-231456",
    "judge": "Master Harper",
    "decided_on": "2026-08-14",
    "jurisdiction": "British Columbia",
    "disposition": "Application dismissed",
    "treatments": [
      { "authority_key": "auth#7", "treatment": "follows", "scope": null, "notes": null }
    ]
  }
}
```

### Field rules

| Field | Rule |
|---|---|
| `source.kind` | Must be `"submission_retire"`. Anything else is refused. |
| `source.filing_id` | Positive integer. It is the bridge's filing-level identity. |
| `source.filing_title`, `source.retired_on` | Required, non-empty. Reported, never written into `law.*` text. |
| `jurisdiction` | Required. It is the default for every authority and is half of `legal_concepts`' natural key, so a NULL would make the upsert unsound. |
| `assertions[].key` | `la#<id>`. |
| `assertions[].concept_type` | One of the five `law.legal_concepts` types; defaults to `doctrine`. |
| `authorities[].key` / `opposing_authorities[].key` | `auth#<id>` / `opp#<id>`. |
| `authorities[].kind` | `case` → `case_law`, `rule` → `regulation`, `doctrine` → `other`. Any other value is refused. |
| `authorities[].citation` | Required. It is the natural key for the upsert. |
| `statements[].key` | `sol#<id>`; `assertion_key` and `authority_key` must resolve within the payload. |
| `statements[].relationship` | Defaults to `applies`; must be a `concept_authorities.relationship` value. |
| `statements[].pinpoint` / `.excerpt` | Local-only capture. Never cross to the pool, excluded from `pushed_source_hash`. |
| `opposing_authorities[].answers_assertion_keys` | The **practitioner's tie**. An `answered` edge is written only where one is present; an untied opposing authority lands as an authority row with **no edge**. The edge lands at `verified = 1` and never crosses to the pool (design-decisions.md #48). |
| `oral_decision` | `null`, or all four of `court`, `file_number`, `judge`, `decided_on` (ISO). |
| `oral_decision.treatments[].treatment` | `follows`, `distinguishes`, `declines_to_follow`, `not_considered`. |

### Never in the payload

**No party names, no style of cause, no matter identifiers.** `law.sqlite` holds
zero client data (design-decisions.md #10), and the oral-reasons row is the one place a
live proceeding could leak in. The script screens every component of the oral
citation, and the assembled citation, for the neutral-citation particle and
refuses on a hit.

Dead-end and dropped rows are the caller's to exclude. If one arrives anyway
the script **skips it and reports it** under `skipped_dropped` — never writes
it, never discards it silently.

---

## 2. The five mappings

| From | To | Rule |
|---|---|---|
| authority `kind` | `authorities.authority_type` | `case`→`case_law`, `rule`→`regulation`, `doctrine`→`other` |
| submission `treatment` | edge `treatment` | `overruled`→`overruled`. Everything else (`negative`, `distinguishable`, `good_law`, absent) → edge `treatment` **NULL** plus the idempotent note `NOTED-UP <date> (submission): <value>`. Only `overruled` is a treatment *event*; `distinguishable` is a prospective risk the drafter flagged, not something a court did (design-decisions.md #16's tense rule). |
| `verification` | edge `verified` | `verified`→`1`; anything else→`0` |
| a recorded `doubt` | edge `verified` | `2`, with a `NEEDS HUMAN` note, regardless of `verification` |
| an opposing authority's tie | `answered` edge `verified` | always `1`; local-only, never pushed (design-decisions.md #48) |

`verified = 1` here means the equivalences recorded in
[`../shared/verification-protocol.md`](../shared/verification-protocol.md) —
read it before relying on a bridged `1`.

### Bridge identity

Every row this bridge writes carries a marker in `notes`:

- `[FROM-SUBMISSION:la#<id>]` on the concept,
- `[FROM-SUBMISSION:sol#<id>]` / `[FROM-SUBMISSION:opp#<id>]` on the edge,
- `[FROM-SUBMISSION:filing#<id>]` on every row of the run, including authorities,
  the oral-reasons row, and its treatments.

**The bridge rewrites only rows bearing its own marker.** A concept or authority
that already existed keeps its own text; only a row this bridge minted is
re-synced on a re-run. This marker family sits on `law.*` notes on the same
footing as `[MERGED-INTO:]` (design-decisions.md #22): `shared/conventions.md` §5's
forcing rule does not apply to it, and the `verified = 2` escalation above is
set explicitly, not inferred from a prefix.

---

## 3. Gather — at most four `matter_data__query` calls

Read-only collision detection before anything is written. These are matter-data
reads; nothing here touches the payload's origin.

1. **Existing authorities by citation** — for every citation in the payload:
   ```sql
   SELECT authority_id, title, citation, authority_type, jurisdiction, notes
   FROM law.authorities
   WHERE citation IN (...);
   ```
2. **Existing concepts by name** — for every assertion name:
   ```sql
   SELECT concept_id, name, jurisdiction, concept_type, description,
          cloud_principle_id, notes
   FROM law.legal_concepts
   WHERE name IN (...) AND jurisdiction = ?;
   ```
3. **Existing edges on those concepts** — `@query_14_concept_authorities` per
   colliding concept, or one `SELECT concept_id, authority_id, relationship,
   verified, notes FROM law.concept_authorities WHERE concept_id IN (...)`.
4. **Oral-reasons collision** — `SELECT authority_id, citation FROM
   law.authorities WHERE citation = ?` for the synthetic citation (run
   `--summary` first to get it).

Read the ingest date, never type it: run `SELECT date('now','localtime') AS today`
through `matter_data__query` and pass the value unchanged as `--ingested-on`
(`../shared/conventions.md` §10). Use the same value for `--summary` and
`--emit-sql`.

Run `--summary` to see what the SQL would do:

```
python3 references/scripts/submission_law_bridge.py --summary \
    --input payload.json --ingested-on <YYYY-MM-DD>
```

---

## 4. Write — one `matter_data__execute`

```
python3 references/scripts/submission_law_bridge.py --emit-sql \
    --input payload.json --ingested-on <YYYY-MM-DD>
```

A refusal prints `REFUSED: <reason>` and exits 2 — **surface it verbatim and go
back to the caller; never hand-edit the payload or the SQL to force emission.**

Submit the emitted script through **one** `matter_data__execute` with
`matter_root` (conventions §2.3). `matter_data__execute` regenerates `evidence.sql` on success.

---

## 5. Report

State, in this order:

1. **Counts** — concepts, authorities, edges, oral treatments written.
2. **Held back** — every edge that landed at `verified = 0`, named by its concept.
   The remedy is **[`verify-law.md`](verify-law.md)**; the concept stays out of
   the push queue until its edges are verified, and that is correct, not a
   defect. Never offer to flip them.
3. **Doubt escalations** — every edge at `verified = 2`, with the recorded doubt.
   Only a human clears these (`review.md`).
4. **Collisions** — every payload citation or concept name that already existed.
   Say what was kept (the existing row's own text) and what was added (the new
   edge).
5. **Per-concept push consequence** — for each concept touched, whether it is now
   **unpushed**, **diverged**, or **held back**. A new edge other than `answered`
   changes the concept's push-source hash, so an already-pushed concept becomes `diverged`
   ([`push-state.md`](push-state.md)); `pinpoint` and `excerpt` do **not** enter
   the hash and do not on their own cause divergence.
6. **Skipped rows** — anything reported under `skipped_dropped`.

---

## 6. Re-running (recovery, then re-retirement)

A recovered filing that is retired again re-runs this operation. That is the
designed path, and it is safe because:

- **Only own-marker rows are re-synced.** A concept or authority the bridge did
  not mint is never rewritten.
- **An edge at `verified = 2` or `-1` is never touched** — the human queue and
  the rejection audit trail both survive a re-run untouched, per design-decisions.md #20's
  blanket no-overwrite rule.
- **Notes are idempotent.** The `NOTED-UP <date> (submission): <value>` note is
  rebuilt from the same inputs, not appended to. A re-run passes that day's
  host date, so a later re-run updates the note's date. `notes` are outside
  `pushed_source_hash`, so this alone never makes a concept `diverged`.
- **Push-state does the rest.** An unchanged re-run leaves the hash unchanged, so
  the concept reads `pushed` and nothing re-pushes; a changed one reads
  `diverged` and re-pushes through the pool's own dedup. Never a duplicate.

---

## 7. What this operation will not do

- **Never** writes a `concept_authorities` edge for the oral-reasons row. An oral
  decision can be cited for nothing until a transcript exists; it earns
  `authority_treatments` rows only.
- **Never** merges an oral-reasons row with anything —
  [`merge-authorities.md`](merge-authorities.md) hard-stops it (B9).
- **Never** writes `legal_criteria`. A retired filing carries assertions and
  statements of law, not criteria; fabricating one to force a link would be a
  data lie (design-decisions.md #19's reasoning for `issue_concepts`).
- **Never** writes `cloud_principle_id` / `pushed_at` / `pushed_source_hash`
  ([`push-state.md`](push-state.md) owns those), and never calls a pool tool.
- **Never** sets `human_reviewed` — that column is facts/positions only
  (design-decisions.md #18) and does not exist law-side.
- **Never** writes anything into `main.sqlite` or `privileged.sqlite`.
