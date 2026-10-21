# Operation: order-effects

Read `../shared/conventions.md` first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

A filed court order is not just another source. Its operative paragraphs can **change the truth of rows already stored** — the style of cause, the trial date, the party roster, counsel of record, the proceeding's status. The normal extraction path records what the order *says* (a source, facts, evidence links, source references) and never reconciles the proceeding-level rows against what the order *did*. This operation is that reconciliation: a **diff-and-propose** pass over a closed writable surface, with a **mandatory human-in-the-loop approval gate**. The same reconciliation is owed by a small class of non-order instruments — the Rule 22-6 counsel-of-record notices — which change identical proceeding-level truth without any judicial act.

The space of possible orders is open-ended, so this is deliberately not an enumerated rule table. The agent reads the operative terms, compares them to stored values, and proposes; the practitioner decides.

**Reached from** `ingest-extract.md` (after the document transaction commits) and `ingest-verify.md` (after Step 4), whenever Step 1 fires. Also reachable directly from `../SKILL.md` for an already-ingested order, and from `/drafting-data`'s counsel offer-back when the practitioner chooses to apply a counsel or address-for-service value that the submission database holds and case data does not. That **offer-back entry** runs on the ingested instrument the practitioner names for each value, whatever its type, and Step 4 proposes the value like any other. Step 1 detection does not gate it.

The backend-free semantics live in `../shared/extraction-protocol.md` ("Order effects"). This file supplies the executable logic.

Every read below runs through `matter_data__query`, every write through `matter_data__execute`, per `../shared/conventions.md` §2.3 — pass `matter_root` on every call.

---

## Step 1 — Order detection

Run this pass when **any** of the following holds:

1. **Filename code fast-path** — the leading CODE token (per `../../file-naming/references/code-registry.md`) is `ORDR`, `CO`, `CDO`, `DJ`, `COJ`, legacy `OMAA`, or a counsel-change notice: `NACL`, `NOWOL`, `NOAIP`. (`NOITW` is excluded — an *intention* to withdraw changes nothing until the withdrawal is filed or ordered.)
2. **Extractor signal** — the extracted `title`/`description` contains "ORDER", "CONSENT ORDER", "JUDGMENT", or "LAWYER"/"IN PERSON" (a Rule 22-6 counsel change), or the document text carries the operative formula "THIS COURT ORDERS".
3. **Category + judgment** — the source is `category = 'court'` and your own read of the document shows operative ordering language.

`RFJ` (reasons for judgment) is **excluded** by default: reasons explain, the entered order changes state. If reasons arrive with no entered order and plainly pronounce operative terms, the pass may still run — say in the report that it is reasons-derived.

Detection is deliberately over-inclusive. A false positive costs one empty diff and no interruption (Step 4); a false negative silently leaves case data stale, which is the failure this operation exists to close.

The offer-back entry skips this detection step. The practitioner has already named the instrument, which is usually an originating or responding filing (a Notice of Civil Claim, a BCCA Notice of Appeal, a Notice of Appearance) rather than an order or notice, and it needs no code from the list above.

For a counsel-change notice, and for the offer-back entry, the writable surface at Step 3 is the party's counsel and address fields only: its `main.parties` row, or its per-proceeding override fields on `main.proceeding_parties` where Step 3's override rule sends the change there — never `proceedings`, and never a `proceeding_parties` INSERT or DELETE. A unilateral filing cannot add or remove a party of record or alter the proceeding.

---

## Step 2 — Read the operative terms

Orders are short and their operative part is on pages 1–2. Read the operative paragraphs yourself, from the document — do **not** dispatch a subagent, and do not re-use the extractor's fact descriptions as a substitute for the terms. For a PDF, call `pdf_pages__images` for those pages first, by [`ingest-extract.md`](ingest-extract.md)'s Universal rules (`../references/design-decisions.md` #71): read a scanned page only from its PNGs and a born-digital page natively. A refusal is reported with its reason, and the order is not read another way.

`../agents/extract-facts.md` stays read-only and unchanged: the diff needs live database values, which an extraction subagent must never hold. No new subagent, no new output field.

Record, for each operative term, its locator in `../shared/conventions.md` §6 form (`p. 1, para. 1`) — every proposal must name the term it rests on.

---

## Step 3 — Diff against the writable surface

The pass may propose changes to **these entities and fields only**:

| Entity | Fields | Example order |
|---|---|---|
| `main.proceedings` | `style_of_cause`, `registry`, `trial_date`, `status`, `courthouse_address` | style-of-cause amendment; adjournment; stay; discontinuance; transfer of registry |
| `main.parties` | `name`, `lawyer_name`, `lawyer_firm`, `lawyer_email`, `lawyer_phone`, `address`, `service_address_filed_date`, `replaced_representative` | name correction; order granting withdrawal of a lawyer; a filed `NACL`/`NOWOL`/`NOAIP` |
| `main.proceeding_parties` | INSERT (add a party in a role) / DELETE (remove a party of record); the per-proceeding overrides `lawyer_name`, `lawyer_firm`, `lawyer_email`, `lawyer_phone`, `address`, `service_address_filed_date`, under the override rule below | order adding a third party; order removing a party; a notice in a proceeding where the party's counsel differs |

Everything else is **report-only**. An order that varies a prior order's payment terms, decides an application, or awards costs is already captured as facts and evidence by the normal extraction path; here it produces "no matter-data fields affected", or a short list of the out-of-surface effects for the practitioner's information. The pass never invents a table, never writes law-side rows, and never touches facts, positions, evidence links, or relief.

Read the current values:

```sql
SELECT proceeding_id, court, registry, file_number, style_of_cause,
       courthouse_address, trial_date, status
FROM main.proceedings;

SELECT p.party_id, p.name, p.party_type, p.lawyer_name, p.lawyer_firm,
       p.lawyer_email, p.lawyer_phone, p.address, p.contact_info,
       p.service_address_filed_date, p.replaced_representative
FROM main.parties p;

SELECT proceeding_id, party_id, role, lawyer_name, lawyer_firm, lawyer_email,
       lawyer_phone, address, service_address_filed_date
FROM main.proceeding_parties;
```

Scope the diff to the proceeding the order was made in — match the order's file number against `proceedings.file_number`. If the order's file number matches no stored proceeding, or matches more than one, **stop and ask**; do not guess which proceeding an order governs.

Constraints that bound what may be proposed:

- `proceedings.status` takes only `active | stayed | concluded`. A discontinuance or dismissal maps to `concluded`; nothing else may be proposed for that field.
- `proceeding_parties.role` takes only the fixed role enum, and `plaintiff_by_counterclaim` is prohibited — see `../references/design-decisions.md` #24 for the role-integrity contract. A counterclaim defendant is a standalone counterclaim-only party, never a second role stacked onto a main-action party.
- A new party needs a `main.parties` INSERT (with `party_type`) **and** a `main.proceeding_parties` INSERT; propose them as one paired row in the table.
- **A new party, and the counsel a representation change names, also get a contact** (`../references/design-decisions.md` #69). Beside each such row, propose the practice-data contact and its matter role, through ``practice-data``: a contact `contact-lookup` finds (exact, or one from its `near` list the practitioner confirms), or a new contact pre-filled from `contacts__search`. The party's role is `client` for the party the firm acts for, otherwise as its side suggests, for the practitioner to correct; counsel gets `opposing_counsel` or `co_counsel` and an affiliation to its firm. When a matched contact's details differ from the counsel the instrument names, ask whether a notice of change was filed, and overwrite neither record (#55).
- Removing a party of record **deletes the `proceeding_parties` row only**. The `main.parties` row stays forever — the entity record remains available to other matter data, mirroring the never-delete posture of `../references/design-decisions.md` #3.
- **Counsel of record is per party by default; an override wins in its own proceeding** (`../references/design-decisions.md` #55). A representation change or a fill-in (below) updates the party's own fields on `main.parties`, unless the party's `main.proceeding_parties` row for the instrument's proceeding already carries an override (any of its six override fields set): then the change goes to those override fields, on every role row the party holds in that proceeding, and the party's own fields stay as they are. Never create an override from an instrument: one is written only when the practitioner expressly says counsel differs for that proceeding. A reader resolves each value to the override when set, else the party's own value, so propose the value the instrument states for whichever of the two the rule names. `replaced_representative` has no override field and is always proposed on `main.parties`.
- **Counsel's email and telephone have fields of their own** (v8.9): `lawyer_email` and `lawyer_phone`, or their override twins. Propose them there, never into `contact_info`. A withdrawn lawyer's fields are proposed as NULL, never as an empty string.
- **Provenance travels with every representation change.** When a proposal changes `lawyer_name` / `lawyer_firm` / `lawyer_email` / `lawyer_phone` / `address` because representation changed — order-driven, notice-driven, or an offer-back apply that changes the representative's identity, no exception (a fill-in, below, is not a representation change) — the pass **must** propose `service_address_filed_date` and `replaced_representative` in the same table. The date is the instrument's registry filing stamp (or the order date, if changed by order). The replaced representative is the party's currently stored `lawyer_name` (with `lawyer_firm`, if known) — the value about to be overwritten; propose `"self-represented"` when the stored fields were already NULL.
- **A fill-in records the date and no replaced representative** (`../references/design-decisions.md` #58). A fill-in is an offer-back apply that leaves the representative's identity unchanged: `lawyer_name` and `lawyer_firm` stay as stored, except that a value may be supplied where case data holds NULL. A NULL that records a party self-represented of record is not missing data: supplying a lawyer there is a representation change. It stays a fill-in when it replaces a stored non-counsel value, such as the party's own business address; the prior value goes to the party's practice-data contact, where the practitioner directs, never to `contact_info`, which is no longer written (#69). For a fill-in, propose `service_address_filed_date` = the filing date of the instrument the value comes from, and propose no `replaced_representative`, because nobody was replaced. When the applied values come from more than one instrument, the date is that of the instrument supplying the `address`. When no `address` is applied, propose no date.
- **A Notice of Withdrawal is symmetric with an appointment.** `NOWOL` also changes the address for service: the party becomes self-represented at its Rule 4-2(7) last-known address. `service_address_filed_date` = the NOWOL filing date; `replaced_representative` = the withdrawing lawyer. Do not treat withdrawal as "no change" because no new lawyer appears.
- **These two fields are structured; do not restate them as prose.** Provenance like "supersedes X's contact" belongs in these columns, never in `contact_info` or `address`.

**Deadline-bearing effects delegate; they are not computed here.** An order changing a trial date or its length is proposed only as the `proceedings.trial_date` field update. The pass then **recommends spawning `lawyer:docket-clerk`**, which owns anchor extraction and cascade recalculation, and performs no deadline arithmetic itself. The same holds for any order that reads like a deadline anchor (a TMC order, an order extending time): propose the surface field if one applies, then hand off.

**Drop already-satisfied proposals before presenting.** A change whose current value already equals the proposed value never reaches the table. This is what makes the pass idempotent by diff, and what makes the verify-path re-run silent.

---

## Step 4 — The HITL approval gate (load-bearing)

If the diff is empty, **skip this step entirely** — clear a pending marker (Step 5, last paragraph), report "order effects: none" and stop. Nothing to approve is not a question worth asking.

Otherwise present the proposed-changes table and **stop**:

| # | Entity | Identifier | Field | Current value | Proposed value | Order term relied on |
|---|---|---|---|---|---|---|
| 1 | party | party_id 1 | name | Dr. L. Abernethy and Dr. S. Lindqvist Inc. | Dr. S. Lindqvist and Dr. L. Abernethy Inc. | p. 1, para. 1 |
| 2 | proceeding | proceeding_id 1 | style_of_cause | Larchmont (B.C.) Inc. v. Dr. L. Abernethy and Dr. S. Lindqvist Inc. et al. | Larchmont (B.C.) Inc. v. Dr. S. Lindqvist and Dr. L. Abernethy Inc. et al. | p. 1, para. 1 |

Then collect approval one row at a time, per `/show-me`: the row's current and proposed values in full, the instrument presented with its operative term highlighted, and one plain-text question ending the turn. Present the next row only after the practitioner has answered.

**No write without approval — ever.** Auto mode, "bias toward not stopping" instructions, batch ingests, and a caller in a hurry do **not** waive this gate. It is the design, not a safety margin to optimize away. This is the same non-overridable register as the human-approval rule on `merge-authorities.md` (`../references/design-decisions.md` #22: *script computes, agent perceives, human decides*).

**Ambiguity is presented, never resolved.** If an operative term could bear more than one reading, put both readings in the table's "Order term relied on" column and let the practitioner choose. Do not guess what an order means.

**On the `human_reviewed` flag.** `../references/design-decisions.md` #18's lawyer-confirmed-row protection does **not** reach this surface: `parties`, `proceedings`, and `proceeding_parties` carry no `human_reviewed` column, and no `verified` column either. There is therefore no flag to raise and no verification state to preserve. Do not write a rule here that could never fire, and do not add those columns to carry one — the approval collected at this gate *is* the human judgment for every row this pass touches.

---

## Step 5 — Apply approved changes

Approved changes run in **one `matter_data__execute` call**, always separate from the document transaction. Running after the document commits is what makes this pass crash-safe: the source and its facts are durably stored whether or not the effects pass completes.

Each applied change (one Step 4 proposal row, so one row per field) gets an audit row in `main.source_references`, in the **same** transaction:

```sql
INSERT INTO main.source_references
  (source_id, reference_type, source_locator, description, verified)
VALUES (?, 'procedural', ?,
        'ORDER-EFFECT: <table>.<pk>=<id>.<field> — per source_id <N> (<instrument title>), <locator>, approved ' || date('now','localtime'),
        1);
```

- `source_id` is the order's source; `source_locator` is the operative term's locator.
- `verified = 1` is honest here and is not a §5 machine prefix: the practitioner personally approved this row's content at Step 4, which is exactly what `../shared/conventions.md` §4 value `1` means. `ORDER-EFFECT:` joins the `[MERGED-INTO:]` marker family as a machine-readable marker outside the §5 prefix set (`../references/design-decisions.md` #22) — it must **not** route anything to a review queue.
- The marker reads `ORDER-EFFECT:` whether the instrument is an order or a counsel-change notice. One marker family, not two: the `description` already names the actual instrument by `source_id` and title, so a second marker would add a parsing surface and no information.
- The audit row exists because none of the three writable-surface tables has a `notes` column. This is the uniform trail for the whole surface, not a fallback for some of it: a later reader traces every applied change back to the order, the term, and the approval from one place.

`matter_data__execute` regenerates `evidence.sql` on success; there is no separate dump step.

Then write the approved contacts, affiliations and matter roles through ``practice-data`` (`upsert-contact`, `upsert-affiliation`, `upsert-matter-role`), each role with the party's `party_id` as `case_party_id` and the instrument's `proceeding_id` as `case_proceeding_id`. Case data is written first because a new party's role needs its `party_id`. If a practice write is refused, the matter-data rows stand: relay the question to the practitioner, and `contact-checks` reports the party until its role is recorded.

Once the changes are applied, add one entry to the matter's `ProceduralHistory.md` under today's date with `matter_data__procedural_history_append` (`../../shared/procedural-history.md`): that case data was updated from the instrument, named by its title and its path relative to the matter folder. The entry names no trial date and no other date the instrument sets.

**Declined proposals are recorded in the run report only** — no database write, and no nagging marker. A later re-ingest re-diffs from live values and will re-propose a declined change only if the values still differ, which is correct: a practitioner may decline for timing and want it later.

**A deferred pass clears its marker.** When the order's source carries `ORDER-EFFECTS-PENDING: order-effects pass not yet run` (`../shared/conventions.md` §11), an ingest deferred this pass. Once the pass has run to its end, clear the marker with §11's clear statement: in this step's transaction when changes were approved, or in its own `matter_data__execute` call when the diff was empty or every proposal was declined. A pass that stopped to ask which proceeding the order governs (Step 3) has not run to its end, and leaves the marker.

---

## Step 6 — Report

Report, in this order:

- whether the pass fired and on what detection signal (and whether it was reasons-derived);
- proposals: proposed / approved / applied counts, plus how many were dropped as already satisfied;
- out-of-surface effects noted for information;
- any handoff recommended (`lawyer:docket-clerk`) and why;
- declined proposals, verbatim, so they are visible in the transcript.

Example: `Order effects: 2 proposed, 2 approved, 2 applied; 1 already satisfied.`
