<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Scoped legal audit — narrowing the dispatch

Loaded only when the spawn prompt names `mode:` or `report:`. It narrows *which
question is asked* and *how the answer is shaped*. It never narrows an audit
guarantee: every located proposition still carries a pinpoint, every tier is still
named in the coverage line, and nothing uncited is ever asserted.

Absent those fields the defaults are `mode: opinion`, `report: full` — the shared
legal audit protocol exactly as written. Silence is never scoping.

**A scoped dispatch fetches no other protocol file.** `mode: inventory` and
`mode: note-up` are self-contained here — follow this file alone; do not fetch
`shared/legal-audit-protocol.md` or `shared/research-priority.md`. An opinion
dispatch (`mode: opinion`, or `mode:` absent) ignores this shortcut entirely and
runs the full protocol chain — both of those files — as today.

## The dispatch fields

| Field | Values | Default |
|---|---|---|
| `mode` | `opinion` / `inventory` / `note-up` | `opinion` |
| `criteria` | the named points to audit, as a list | required for `inventory` |
| `citations` | the authorities to note up, each with a `since` date | required for `note-up` |
| `report` | `full` / `brief` | `full` |
| `freshness` | how old a recorded currency check may be, e.g. `30d` | `30d` |

A dispatch naming `mode: inventory` with no criteria list is malformed: audit
nothing, say so, and ask the caller for the list. Likewise `mode: note-up` with
no citations list, or with a citation carrying no `since` — the whole question is
"what is new *since* a date", so an absent date is not a wider sweep, it is a
malformed dispatch.

Step 6 of `shared/legal-audit-protocol.md` (the memo and its internal notes) and the
scratchpad write apply to opinion mode only. Inventory and note-up keep their own
return shapes and stay read-only.

## Hard boundaries (both scoped modes)

- Read-only: no Write, Edit, Bash, browser, ingestion, or database mutation.
- Case database only through the `case-data` skill: call `case_data__query` solely
  as that skill's query operation directs, never freelance SQL, never
  `case_data__execute`.
- Commons pool: if pool read tools are **not** in your grant, never call
  `legal_commons__*`. If they **are**, use only the read tools (`browse`,
  `find_candidates`, `lookup_by_citation`, `resolve_by_id`, `treatment_chain`);
  never a write tool (`push`, `merge_authority`, `amend_*`, `link_*`, `unlink_*`,
  `configure_*`), and never any pool tool that records a treatment or stamps an
  authority as verified — recording currency is the caller's act, under its own
  permission prompt, never this agent's.
- No pushes/amends to the commons pool — flag push-worthy findings for
  `/consolidation-push` instead.
- Never cite from training knowledge. Never state uncited law as fact.

## `mode: inventory` — what do we already hold?

An inventory dispatch asks a **holdings question**, not a legal one: *for each named
criterion, what authority is already on file, and what is missing?* It is cheap
because it answers a narrower question, never because it skips a check.

**It makes no statement of law.** Report what is recorded, with its pinpoint and its
source layer. Never state a recorded proposition as law, never resolve a conflict
between two recorded authorities, never opine on whether located material satisfies
the criterion in law. Close every inventory return with:

> Inventory only — no statement of law. Ask for an opinion-mode audit on any
> criterion before relying on it.

### Ladder — stop as soon as a criterion resolves

Tier order and escalation rule: run tiers 1 → 2 → 3 in order, per criterion,
escalating only the criteria still unresolved, and stop at the first tier that
yields an authority sufficient to answer **with a pinpoint citation**. A tier you
skipped is reported as skipped, never as silently absent.

1. **Index probes (tiers 1–2).** One `case-data` query across the named criteria,
   plus pool `find_candidates` / `lookup_by_citation` scoped to them. Issue these as
   one parallel batch, not a serial walk. **At most 2 `find_candidates` phrasings
   per criterion** — this overrides `research-priority.md`'s "several rephrasings"
   guidance, which continues to govern opinion mode. A criterion with a recorded
   authority **and** a pinpoint is resolved — stop there for that criterion.
2. **Matter folder (tier 3).** For unresolved criteria only: list *only* the
   `6. LAW\` subfolders whose names match an unresolved criterion; read only the
   files whose names match one. Everything else — folders not matched, files
   matched but not read — is reported as **not examined**, with one count line,
   never as absent. A `.docx`/`.doc` you cannot open stays **UNREAD** with its path.
3. **Stop.** Tier 4 is never run from an inventory dispatch. CanLII runs only as
   note-up reporting (below), never as a search for new authority. A criterion still
   unresolved is reported as a gap: that is a complete inventory answer, not a
   failure.

### Note-up in inventory mode

Inventory reports the note-up **state** it finds; it does not manufacture one. For
each authority reported: `noted up <date, source>` where a recorded treatment check
exists (a pool `treatment_chain` result, a verified memo, or a case-data record),
otherwise **NOT NOTED UP**. A statute, regulation or rule is noted up by its currency
check, and doctrine never (`statute-currency.md` → Noting up legislation). Do not
run a citator sweep across an inventory — nothing here is being relied on yet. Good-law verification is an opinion-mode dispatch.

## `mode: note-up` — what has cited this since a date?

A note-up dispatch asks a **currency question**, not a legal one: *for each named
authority, what does the pool already record about how it has been treated, and
has anything cited it since `since`?* It is the cheap half of a currency check —
the half a read-only agent can actually discharge.

**It makes no statement of law and it classifies nothing.** Report what the pool
records and what the citator lists. Never say an authority was overruled,
narrowed, distinguished, or remains good law on the strength of a citator entry:
**the CanLII citator returns citing cases with no treatment classification**, and
the CanLII API serves no full text, so nothing here can be read to find out. A
citing decision is a lead. Classifying it means reading the treating decision from
a saved copy of the authority's own text, which is the caller's job, not this agent's.

### Per citation, in order

1. **Pool identity.** `lookup_by_citation` (then `resolve_by_id` where an id is
   already known) to get the pool authority id and its recorded `last_verified_at`.
   Where the pool is not in your grant, or is unreachable, say so on the coverage
   line and carry on — an unaudited pool is reported, never guessed at.
2. **Recorded treatment.** `treatment_chain` on that id. Report the chain as the
   pool records it; do not re-adjudicate it.
3. **Citing cases since.** One CanLII citator call (`get_case_citator`) per
   citation. Keep only decisions dated **after** the citation's `since` value, and
   list them as citation + date + court. No sweep beyond the named citations, no
   second-hop note-up of the citing decisions themselves.

### Return shape, per citation

```
<citation> — <verdict>
  pool: <authority id> / not in pool / pool NOT AUDITED
  last_verified_at: <date> / never
  treatment chain: <n edges — each as treating citation + recorded treatment> / none recorded
  citing since <since>: <citation, date, court> ×n / none
  verdict: no_new_citing | new_citing_cases | unavailable
```

The three verdicts, and nothing else:

- **`no_new_citing`** — the citator answered and lists nothing after `since`.
- **`new_citing_cases`** — the citator answered and lists at least one. The
  listed decisions are the whole finding. **Attach no treatment word to them.**
- **`unavailable`** — the citator could not be reached (no `CANLII_API_KEY`, tool
  absent from the grant, runtime error). Report the cause per *Unavailable ≠
  broken* below. `unavailable` is never merged into `no_new_citing`: "we asked and
  found nothing" and "we could not ask" are opposite facts.

Close every note-up return with:

> Note-up only — no statement of law and no treatment classification. A citing
> decision here is a lead; classifying it requires reading that decision.

## Coverage line (mandatory, every scoped return — inventory and note-up alike)

One line, every tier named, none omitted:

```
case data: audited | commons: audited / unavailable / not installed / NOT AUDITED |
6. LAW: audited / n memos UNREAD | Westlaw: run (n decisions, memo Y/N) / not run: <reason> |
CanLII: noted up / no key | Legislation: retrieved n, on disk n / not run: <reason>
```

The line ends with the Legislation segment, exactly `Legislation: retrieved n, on disk n` or `Legislation: not run: <reason>`, with nothing after it. Anything more about the instruments, such as their currency, goes in the notes below the line. Any tier you could not examine, the Legislation tier included, reads `NOT AUDITED` or `NOT AUDITED: <reason>` in place of its listed forms. No segment carries a parenthetical: counts and other detail go in the notes below the line. Silence about a tier reads as coverage that did not happen. Westlaw and legislation
retrieval are never run from a scoped dispatch, so both always read
`not run: scoped dispatch` here. A note-up dispatch
visits no `6. LAW` folder and asks no holdings question, so it reports
`case data: not examined | 6. LAW: not examined` — never `audited`, and never
omitted. The case database ships in the `litigator` plugin: when the `case-data`
skill is not available in this session, skip the tier-1 query and report
`case data: NOT AUDITED: litigator plugin not installed`.

## `report: brief` — a hard output budget

The report is **exactly**:

- One template block per criterion (inventory) or per citation (note-up), below;
- the coverage line (above);
- one count line per UNREAD/unexamined class — never itemized, never enumerated;
- the offers list (below).

**Any sentence outside these elements is a defect, not thoroughness.**
Enumerations are replaced by counts ("10 decisions not examined — ask to
enumerate"), never itemized line by line. State the lesson as a rule: *a shape
constraint with no length constraint does not constrain — this budget is the
constraint.*

```
<criterion> — FOUND / GAP
  authority: <full citation>, <pinpoint>     (omit if GAP)
  source: case data / commons / 6. LAW <path>
  good law: noted up <date, source> / NOT NOTED UP
  confidence: <one line — what would change this>
```

`report: brief` is a shape, not a licence. A pinpoint dropped for brevity is a
defect. `report: full` additionally carries the per-issue table and tier-by-tier
narrative that `report: brief` omits — out of scope for an inventory dispatch,
which always uses `report: brief`.

## Freshness — cite a recorded check rather than re-running it

A **legislation currency** check (a statute, regulation, or rule of court in force)
already recorded in case data or the pool, dated inside the freshness window, is
cited rather than re-run: "relying on currency check dated `<date>` (`<source>`)".
Outside the window, or undated, re-run it.

This never applies to case-law note-up, and never happens silently: the date and the
source appear in the answer, so the practitioner can demand a fresh check.

## Unavailable ≠ broken — diagnose before you advise

Name the actual cause; never guess at one. A tool absent from your grant is a grant
problem — say so, never advise reinstalling or restarting. A granted tool that
errors at runtime is a server/configuration problem — report its error message
verbatim (a missing `CANLII_API_KEY` names itself). Never present one condition as
the other.

## Escalating out of scope

If an inventory dispatch turns up a live conflict, negative treatment, or anything
that would mislead the caller if reported as a bare holding, say so in one line and
offer the opinion-mode dispatch. Never resolve it inside the inventory.

A note-up dispatch escalates nothing on its own. `new_citing_cases` is the answer,
not a flag: do not offer an opinion-mode dispatch, do not characterise the citing
decisions, and do not soften the verdict because the list looks harmless.

## Offers list (Step 5, condensed)

Close every return with a short offers list: what further research would close each
remaining gap, and whether it needs CanLII (key), the commons pool, or a Westlaw
Deep Research hand-off. Nothing else follows it.
