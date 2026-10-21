# Operation: push-state

Serves the **consolidation/push skill** (a client of `/matter-data` + `/legal-commons`,
never a gatekeeper — spec §6/§8). Two sub-operations:

- **push-queue** (read) — list a matter's push-candidates (unpushed + diverged
  `law.legal_concepts`) with the severance-allowlisted push-source content the
  push skill compresses and pushes, **less any concept held back by the
  edge-verification gate** (Sub-op A), which is returned separately with its
  reason.
- **record-push** (write-back) — after a principle is durably minted in layer 3,
  record its local up-pointer (`cloud_principle_id`, `pushed_at`,
  `pushed_source_hash`) and cache any deduped `authorities.cloud_authority_id`.

Read [`../shared/conventions.md`](../shared/conventions.md) first; read `probanda.json`
for `matter_root` per §2.2; halt on any tool error per §2.3.

**Reading the `con.execute(...)` pseudocode below.** Every code block in this file
predates the permission-fatigue conversion and is written against a live `con`
connection for readability — treat that as pseudocode for the tool contract (§2.3),
not literal executable Python. Concretely: each `con.execute(sql, params)` call is one
`matter_data__query` call (`{ matter_root, sql, params }`) for a `SELECT`, threading its
returned `rows` back into the surrounding Python — any runtime, sandbox Python fine
(no matter files touched), else halt — for the pure in-memory logic (hashing,
JSON shaping) the blocks actually exist to document. push-queue (Sub-op A) is read-only throughout — only `matter_data__query` calls. record-push
(Sub-op B) does its reads the same way, then applies all of its writes in **one**
`matter_data__execute` call — never a bare `UPDATE`
outside that call.

Push-state itself is **derived, never stored** (design-decisions.md decision #19): there is
no status column. States are computed here in Python because SQLite has no
SHA-256. `unpushed` = `cloud_principle_id IS NULL`; `pushed` = pointer set and the
recomputed source hash equals the stored `pushed_source_hash`; `diverged` =
pointer set and the hash differs.

## The canonical push-source hash — single source of truth

`pushed_source_hash` is the SHA-256 of the **raw local push-source fields**
(decision #19: `name`, `description`, ordered `legal_criteria`) as they stand
now. This serializer is defined **once, here**, and used by *both* sub-ops — the
divergence check in push-queue and the write in record-push. They MUST hash
byte-identically, or every freshly pushed concept would immediately read
`diverged`. No other skill computes this hash; the push skill treats the store as
opaque and never serializes push-source content itself. Executable: `push_source_hash.py` (scripts/) — run, don't re-transcribe;
keep both in lockstep.

```python
import hashlib, json, unicodedata

def push_source_hash(con, concept_id):
    # name + description from the concept; ordered criteria push-source fields.
    row = con.execute(
        "SELECT name, description FROM law.legal_concepts WHERE concept_id = ?",
        (concept_id,)).fetchone()
    name, description = row[0], row[1]
    crits = con.execute(
        "SELECT criterion_order, requirement_type, criterion_description, "
        "       burden_of_proof, in_force_date, repeal_date "
        "FROM law.legal_criteria WHERE concept_id = ? ORDER BY criterion_order",
        (concept_id,)).fetchall()
    # v7.1: ordered edge push-source fields. Excludes rejected edges -- a rejection
    # drops the edge from the push payload, which IS a content change the pool must
    # learn about. Flipping verified 0 -> 1 does not change the hash: verification is
    # not a content change. Excludes `answered` edges too -- they never cross (#48).
    edges = con.execute(
        "SELECT authority_id, relationship, proposition, finding, obiter, treatment "
        "FROM law.concept_authorities WHERE concept_id = ? AND verified >= 0 "
        "AND relationship != 'answered' "
        "ORDER BY authority_id",
        (concept_id,)).fetchall()
    payload = {
        "name": name or "",
        "description": description or "",
        "criteria": [
            {"order": c[0], "requirement_type": c[1], "description": c[2] or "",
             "burden_of_proof": c[3], "in_force_date": c[4], "repeal_date": c[5]}
            for c in crits
        ],
        "edges": [
            {"authority_id": e[0], "relationship": e[1], "proposition": e[2] or "",
             "finding": e[3] or "", "obiter": e[4] or "", "treatment": e[5]}
            for e in edges
        ],
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"))
    return hashlib.sha256(
        unicodedata.normalize("NFC", canonical).encode("utf-8")).hexdigest()
```

**What the hash is, exactly** (the point that gets misread): `pushed_source_hash` is a
SHA-256 of the **local** push-source fields as they stood at push time. It is **not** a
claim of textual equality with the pool. `pushed` means *the pool has seen local content
in this exact state*; `diverged` means *local changed since the pool last saw it*. The
pool's severance-rewrite of the text is irrelevant to both — pool text never enters the
computation. So widening the hash to cover edge fields does **not** make every concept
read `diverged` forever.

**v7.1 widening (123A).** `relationship`, `proposition`, `finding`, `obiter` and
`treatment` are in the hash because they **cross in the push payload** (see the
`authorities[]` mapping above). Before v7.1 the hash covered only name/description/
criteria, so a local edit to an edge proposition was **unrepresentable as divergence** —
the pool kept text the local record no longer said, and nothing surfaced it.
`authority_id` is included as the edge identity and sort key (local-only is fine: the
hash is a local snapshot and needs no cross-matter stability). `factual_context`,
`notes`, and the `verified` value are **out** — they never cross.

**v7.3/v8.5 non-crossing capture fields.** `authorities.fact_pattern`,
`authorities.loss_description`, `concept_authorities.order_terms`, and — from
v8.5 — `concept_authorities.pinpoint` and `concept_authorities.excerpt` never
enter `pushed_source_hash` or the push payload. `pinpoint` and `excerpt` are the
verbatim pinpoint and quoted passage the retired-filing bridge
(`ingest-submission-law.md`) captured from a statement of law; they are local
review material in exactly the same class as `order_terms`, and hashing a field
the pool never receives would fabricate divergence. They are local search/capture material,
like `factual_context` and `notes`; hashing a field the pool never receives would
fabricate divergence. Editing only one of these excluded fields therefore leaves the
recomputed hash unchanged. Editing a crossing field such as remedy `finding`, or
adding/rejecting an edge that otherwise enters the `verified >= 0` payload, changes
the hash and may derive `diverged`.

**`answered` edges never cross (design-decisions.md #48).** An `answered` edge records that
a retired filing answered an opposing authority on this concept. That is matter
history, not support for the principle, and the pool has no place for it. So the
serializer and the push-queue join both carry `relationship != 'answered'` beside
`verified >= 0`, and must keep carrying the identical pair. This does not repeal
"held back whole, never edge-filtered" below. That rule rejects filtering by
`verified`, which changes over an edge's life, so verifying an edge would move the
hash. `relationship` is fixed when the edge is written, so this filter never turns
a verification into a content change. The bridge writes these edges at
`verified = 1`, so they never gate.

`jurisdiction` is deliberately **out** of the hash — decision #19 fixes the
push-source as name/description/ordered-criteria/ordered-edges. The `authorities`
**table**'s own fields are out too: they dedup independently by citation (the
`cloud_authority_id` cache), so an authority edit is not concept divergence. If a
jurisdiction-only edit ever needs to force a re-push, that is a schema-contract change
to decision #19, not a local tweak here.

## Sub-op A: push-queue (read-only)

**Read-only** — never mutates, never dumps, never reads `evidence.sql`.

### The edge-verification gate (handover 124)

**A concept with any edge at `verified = 0` (unverified) or `verified = 2` (needs
human judgment) is held back whole.** It is not a candidate: no push-source content
is returned for it, so the push skill *cannot* push it — the gate is mechanical at
the read boundary, the same doctrine as the never-cross column filter below, not a
downstream promise.

**Held back whole, never edge-filtered.** The rejected alternative — push the
concept with its edges filtered to `verified = 1` — fails on two counts:

1. **It would break the hash contract.** The payload filter and the serializer must
   carry the identical filter (below), so filtering the payload to `= 1` forces the
   serializer to `= 1` too. Then flipping an edge `0 → 1` *would* change the hash,
   repealing "verification is not a content change" and making every verification
   wave read `diverged` on concepts whose content never moved. Divergence would stop
   meaning *local changed since the pool last saw it* (decision #19).
2. **It would mint dishonest pool rows.** The principle would land with its
   authority support silently truncated to whatever happened to be verified that
   day, and the pool has no way to say "more support pending".

Holding back whole costs nothing at the seam: a gated concept has **no** edge at `0`
or `2`, so every surviving `verified >= 0` edge is `= 1` and the existing filter and
serializer need **no change at all**. The concept simply reads `unpushed` until its
edges are verified, which is honest, and the next run picks it up — the existing
self-heal predicate is the whole recovery mechanism.

**Gate on `verified IN (0, 2)`, not on `0` alone.** A `2` edge is content the system
itself flagged for a lawyer; letting it cross while gating only `0` would leave the
needs-human leak open. A `-1` edge is already excluded from the payload and does not
gate.

**The gate is a hard skip, never an override.** There is no "push anyway": pushing
at `0` ships content the local record marks unchecked, and bulk-flipping to `1` to
clear the gate is exactly the unread confirmation the verification architecture
exists to prevent. The sanctioned escapes are the real ones — run
[`verify-law.md`](verify-law.md) for `0` edges, or the lawyer clears `2` edges
through [`review.md`](review.md). A concept with **zero** edges passes the gate
vacuously — including one that reaches zero edges mid-run via rejection; that is
existing behavior and is preserved.

### Candidates

For every `law.legal_concepts` row, compute its state with the serializer above.
Return only **unpushed** and **diverged** rows (the candidates); skip `pushed`.
Then apply the gate: a candidate with any edge at `0` or `2` moves to `held_back`.
For each candidate return exactly the severance-allowlisted push-source content —
the columns [#48](https://github.com/Mharbulous/CoClerk/issues/48) has somewhere
to receive (spec §8 D1) — plus the local bookkeeping the push skill needs:

- `concept_id` — local key; needed for write-back. **Local-only, never crosses.**
- `state` — `"unpushed"` or `"diverged"`.
- `cloud_principle_id` — `null` when unpushed; the current pointer when diverged
  (so a diverged re-push can resolve the then-canonical id at push time).
- `name`, `description`, `jurisdiction` — → `principle.text` / `principle.jurisdiction`.
- `concept_type` — context for the skill's doctrine-tag choice; does not cross.
- `criteria[]` — ordered by `criterion_order`: `requirement_type`,
  `criterion_order`, `criterion_description`, `burden_of_proof`, `in_force_date`,
  `repeal_date` → `criterion.*`.
- `authorities[]` — join `concept_authorities` → `authorities`, **`verified >= 0` only, never `answered`**
  (a rejected edge is excluded from the payload, matching the hash serializer below —
  the two MUST carry the identical filter or the hash lies about what was pushed):
  `title`, `citation`, `authority_type`, `jurisdiction`, `disposition`,
  `last_verified_at` → `authority.*`; `relationship`, `proposition`, `finding`,
  `obiter`, `treatment` → `principle_authority.*`.

  **`last_verified_at` attests to the source DOCUMENT, not to this edge.** It is stamped
  on `authorities` only after a verifier re-read that document (see
  `../shared/verification-protocol.md`); it says nothing about whether this edge's
  `proposition` or `finding` is right. Edge-level verification is `concept_authorities.verified`
  (v7.1). Do not let a consumer read the former as the latter.

**Never return** `notes` (any table), `file_path`/`file_hash`, `factual_context`,
`fact_pattern`, `loss_description`, `order_terms`, `pinpoint`, `excerpt`, or
`authority_proposition`. These have no receiving column in #48 and are exactly
where matter context leaks; excluding them at the read boundary makes "never
cross" mechanical rather than a downstream promise. The push skill still runs its
own severance and indirect-identifier screens on what *is* returned — this read
filter is defence-in-depth, not a substitute.

```python
def push_queue(con):
    candidates, held_back = [], []
    for cid, name, desc, juris, ctype, cpid in con.execute(
        "SELECT concept_id, name, description, jurisdiction, concept_type, "
        "       cloud_principle_id FROM law.legal_concepts").fetchall():
        if cpid is None:
            state = "unpushed"
        else:
            stored = con.execute(
                "SELECT pushed_source_hash FROM law.legal_concepts "
                "WHERE concept_id = ?", (cid,)).fetchone()[0]
            state = "pushed" if push_source_hash(con, cid) == stored else "diverged"
        if state == "pushed":
            continue
        # Edge-verification gate: hold back the WHOLE concept, and return no
        # push-source content for it -- the skill must not be able to push it.
        blocking = dict(con.execute(
            "SELECT verified, COUNT(*) FROM law.concept_authorities "
            "WHERE concept_id = ? AND verified IN (0, 2) GROUP BY verified",
            (cid,)).fetchall())
        if blocking:
            held_back.append({
                "concept_id": cid, "name": name, "state": state,
                "unverified_edges": blocking.get(0, 0),
                "needs_human_edges": blocking.get(2, 0)})
            continue
        criteria = [
            {"requirement_type": c[0], "criterion_order": c[1],
             "criterion_description": c[2], "burden_of_proof": c[3],
             "in_force_date": c[4], "repeal_date": c[5]}
            for c in con.execute(
                "SELECT requirement_type, criterion_order, criterion_description, "
                "       burden_of_proof, in_force_date, repeal_date "
                "FROM law.legal_criteria WHERE concept_id = ? "
                "ORDER BY criterion_order", (cid,)).fetchall()]
        authorities = [
            {"title": a[0], "citation": a[1], "authority_type": a[2],
             "jurisdiction": a[3], "disposition": a[4], "last_verified_at": a[5],
             "relationship": a[6], "proposition": a[7], "finding": a[8],
             "obiter": a[9], "treatment": a[10]}
            for a in con.execute(
                "SELECT au.title, au.citation, au.authority_type, au.jurisdiction, "
                "       au.disposition, au.last_verified_at, ca.relationship, "
                "       ca.proposition, ca.finding, ca.obiter, ca.treatment "
                "FROM law.concept_authorities ca "
                "JOIN law.authorities au ON au.authority_id = ca.authority_id "
                "WHERE ca.concept_id = ? AND ca.verified >= 0 "
                "  AND ca.relationship != 'answered'", (cid,)).fetchall()]
        candidates.append({
            "concept_id": cid, "state": state, "cloud_principle_id": cpid,
            "name": name, "description": desc, "jurisdiction": juris,
            "concept_type": ctype, "criteria": criteria, "authorities": authorities})
    return {"candidates": candidates, "held_back": held_back}
```

Return **both lists** to the caller (each unpushed first, then diverged, by
`concept_id`): the pushable `candidates` with their push-source content, and the
gated `held_back` with identity and reason counts only. Report the counts of each.
Stop — no dump (nothing was written).

**Never return `held_back` silently as "nothing to push."** A held-back concept is
work the practitioner can clear; an invisible hold-back looks identical to an empty
queue and is exactly the silent failure this project forbids. `held_back` carries no
push-source content, so it leaks nothing by being surfaced.

A **diverged and held-back** concept is a legal state (a pushed concept whose local
text was edited and whose edges are not verified). It stays held back and the pool
keeps the older text until its edges verify. That is honest — but report it as
held-back-diverged so it does not look like a stuck queue.

## Sub-op B: record-push (write-back)

Called by the push skill **only after** `legal_commons__push` has durably returned
a cloud principle id (D5 ordering: cloud id before local write-back, so the only
failure window is "cloud ok, write-back didn't" — the row still reads unpushed and
the next run retries it). Input is a list of records:

```json
[{"concept_id": 12,
  "cloud_principle_id": "4471...-uuid",
  "authority_cloud_ids": {"2012 SCC 45": "a1b2...-uuid"}}]
```

`authority_cloud_ids` maps public **citation** → cloud authority UUID for the
authorities the push deduped (the `cloud_authority_id` cache; citation stays the
natural key). It may be empty.

All writes for one call run in a single `matter_data__execute` call (one `sql_script`,
§2.3). Per record:

```python
def record_push(con, records):
    now = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    con.execute("BEGIN")
    for rec in records:
        cid = rec["concept_id"]
        h = push_source_hash(con, cid)                 # same serializer as the queue
        con.execute(
            "UPDATE law.legal_concepts "
            "SET cloud_principle_id = ?, pushed_at = ?, pushed_source_hash = ? "
            "WHERE concept_id = ?",
            (rec["cloud_principle_id"], now, h, cid))
        for citation, cloud_aid in (rec.get("authority_cloud_ids") or {}).items():
            con.execute(
                "UPDATE law.authorities SET cloud_authority_id = ? "
                "WHERE citation = ?", (cloud_aid, citation))
    con.commit()
```

The three up-pointer columns are always written together, satisfying the two
cross-column CHECKs (`(cloud_principle_id IS NULL) = (pushed_at IS NULL)` and the
same for `pushed_source_hash`). Writing the freshly recomputed hash means the row
reads `pushed` immediately after (recompute == stored). A **diverged re-push**
runs the identical code path: it overwrites the pointer/timestamp/hash with the
new values, abandoning the old cloud principle untouched (other matters may still
point at it — the cloud lookup tool resolves any redirect).

## Sub-op C: re-stamp (recipe migration ONLY)

Exists for **one** purpose: when the `push_source_hash` recipe itself changes, every
stored `pushed_source_hash` was computed under the old recipe and would read `diverged`
even though local content has not moved. Re-stamp recomputes them under the new recipe.

**It must never be used to paper over a genuine local edit.** That is not a recipe
migration — that is divergence doing its job.

Requires an explicit practitioner authorization reference, recorded in the report.

```python
# For every pushed concept, recompute under the CURRENT recipe and store it.
for (cid,) in con.execute(
        "SELECT concept_id FROM law.legal_concepts "
        "WHERE cloud_principle_id IS NOT NULL ORDER BY concept_id").fetchall():
    con.execute("UPDATE law.legal_concepts SET pushed_source_hash = ? WHERE concept_id = ?",
                (push_source_hash(con, cid), cid))
con.commit()
```

`cloud_principle_id` and `pushed_at` are **not** touched — they still truthfully record
the last actual push event, and the two cross-column CHECKs stay satisfied.

**Honesty gate.** Re-stamping asserts *the pool has seen this local content*. That is
tautologically true for a concept whose local content has not changed since its push —
the payload has always carried the edge fields (see Sub-op A's `authorities[]`). It is
**false** for any concept whose local text was corrected after its push. Those must be
**excluded** and left reading `diverged`, which is the honest signal, or confirmed
against the pool by a read (`legal_commons__resolve_by_id`) before being included.

Ordering when a recipe change and a defect fix land together: fix local first
(`amend-law.md`) → confirm the pool already carries the correction for the fixed
concepts → edit the serializer → re-stamp → verify `diverged = 0`. Between the
serializer edit and the re-stamp every pushed concept transiently reads `diverged`, so
no push-queue consumer may run in that window.

Sub-op C mutates via `matter_data__execute`, same as Sub-op B — the dump is automatic on success (§2.3).

## Dump and report

record-push mutates via `matter_data__execute`, which regenerates `evidence.sql` and
copies the binaries back automatically on success (§2.3) — no separate dump call.
Report, per record: `concept_id`, the recorded `cloud_principle_id`, and how many
`authorities.cloud_authority_id` caches were filled. push-queue is read-only
(`matter_data__query` only) and triggers no dump.
