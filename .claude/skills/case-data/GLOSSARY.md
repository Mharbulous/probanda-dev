# GLOSSARY — Domain Glossary

This is the source of truth for domain terminology used across the skill's operations, shared conventions, and subagent templates. When wording in an operation file or protocol seems to conflict with a definition here, this glossary wins. Read this file for terminology or ambiguity questions — routine operations do not need to load it.

For the schema table/column/view that backs each term below, see `references/terminology-crosswalk.md`. This glossary intentionally does not embed table or column names in its prose; the crosswalk is the single place that maps terms to schema anchors and the only place that needs updating when anchors change.

## Matter vs Proceeding

**Matter** — the practitioner's engagement with a client. A matter may contain zero, one, or many proceedings (e.g. a matter that is pure advice work has no proceeding; a matter with a counterclaim or a related third-party action has more than one).

**Proceeding** — one court-filed case within a matter: identified by court, registry, and file number, with a style of cause, parties, and a status (active, stayed, concluded). Facts, sources, causes of action, and issues are generally scoped to a proceeding, not the matter as a whole.

**Matter reference** — the token that names the matter's folder and identifies the matter wherever our own systems point at one: either a client number, a dot, and the matter (`8575.L8443`), or the matter alone (`L8470`). It is read off the folder name, not assigned here.

**Matter number** — the firm's number for the matter by itself (`L8443`), as the practice database records it. Where a matter reference carries a client number in front, the matter number is the part after the dot; the dot is a separator, never part of the value.

The two coincide whenever a folder is named by the matter alone, and are still different fields: `L8470 Abandonment of Premises` has both equal; `8575.L8443 Ashby v Waypoint Construction Ltd` does not. The reference comes from the folder and the number from the practice database — neither is ever derived from the other, and where they are equal a practitioner is told so once rather than shown two matching lines.

## Source vs Authority

**Source** — case-specific recorded material belonging to a matter: a document, but also a recording, photograph, or transcript — anything that captures information in a fixed, referenceable form. Sources are the case-specific evidentiary record.

**Authority** — reusable legal material with zero client data: case law, legislation, regulations, treatises. Authorities live outside any matter and are shared across matters.

A key boundary: **unrecorded anticipated testimony is NOT a source** until it is captured in some record (an affidavit, a transcript, a will-say statement). Until captured, it cannot be cited or linked as evidence — it is merely anticipated.

## Privileged Source

A source subject to privilege. A privileged source may explain *how* a fact was discovered (its provenance) but can never itself be treated as admissible evidence. Privileged sources and non-privileged sources are kept in physically separate storage so that no path can accidentally connect privileged material to the evidentiary record — see the design decision on the privilege firewall.

## Fact / Provenance / Evidence / Proof

**Fact** — a discrete factual assertion about the real world (not a legal conclusion, not a party's characterization of it).

**Provenance** — where a fact was learned; this may be privileged (e.g. a client interview) even when the fact itself is later provable through non-privileged means.

**Evidence** — non-privileged material linked to a fact as support (or contradiction) for it.

**Proof** — the litigation conclusion that a fact is established: through evidence, through an admission, through an agreed statement of facts, or otherwise. Proof is a legal/strategic judgment, not a database flag.

A fact can have provenance without evidence — that is a trial-prep gap (a fact you know how you learned, but cannot yet prove admissibly).

## Theorized Fact

A fact **theorized for the purpose of investigation** — a fact the case theory needs but that no source yet evidences. It cannot be derived from anything (theorizing is an act, not an inference), so it is recorded; but it is **not a party position** (no stance is on any record) and **not a posture** (nothing exists to derive one from). What it *is* is **provenance**: the fact's source is the case theory itself, modelled as a well-known placeholder source (one *Theory of the case* work-product source per application, created lazily). A theorized fact is precisely a fact whose only provenance is that theory placeholder and whose evidence is empty — the trial-prep gap above, at the earliest stage, where "not yet evidenced" is the expected pre-affidavit state, not a defect. It is privileged work product, so its `main.facts` row is a **Bare Row** (below): the wording lives on the privileged side only.

It graduates when a non-privileged source states the same Fact, so the row takes that source's own Statement of Fact, and real evidence then lands: an ordinary evidence link makes it an ordinary evidenced fact, and it stops being theorized **by construction** — no "evidenced" marker exists or is needed. The theory provenance stays as the history of how the fact entered. The only other exit is **Dismissed** (below).

## Dismissed

The **terminal** disposition on a theorized fact's provenance: our own investigation concluded the fact is **likely untrue**. Recorded on the provenance row, never by deletion — the record of what was considered and rejected is the point. An argument may not rest on a dismissed fact. "Dismissed" is a fact-investigation disposition, **not** a party position and **not** a posture, and it is knowable only for **our own** side — there is no way to know what an opposing party has privately dismissed. (Distinct from a *proceeding* status or an *issue* status — see the status/posture caution below.)

## Bare Row

The `main.facts` row for a Fact known **only through privileged sources**: an ID and nothing else (`description = ''`, no category, date, source, notes, informant or basis). Privilege attaches to a Statement of Fact by its source and never to a Fact, and any summary, paraphrase or abridgement of a privileged statement is itself privileged, so the non-privileged store holds no wording for such a Fact. The Statement of Fact stays in `privileged.fact_provenance.source_note`, and only a privileged-side read (`@query_10`, `@query_22`) shows what the ID means. Nothing links to a bare row, and drafting, list and verification reads skip it. It becomes an ordinary fact only when a non-privileged source states the same Fact and the row takes that source's own Statement of Fact. See design-decisions.md #67 and `operations/bare-privileged-facts.md`.

## Position

A party's stance on a fact: **claim**, **admit**, **deny**, **not_admit**, or **no_position**. "No knowledge" pleading language maps to `not_admit` with `position_basis = outside_knowledge`. Express abstention maps to `no_position`; actual silence is represented by no row. Verbatim limiting wording is preserved in `qualification`.

**Qualified admission** — a single **admit** position where the limiting language is recorded verbatim (never split into a separate admit row and a separate deny row, and never paraphrased).

## Fact Posture

The practical state of a fact given all current positions on it — **derived, never stored**. Values: **disputed**, **admitted**, **not_admitted**, **no_position**, **claimed**, and **unaddressed**. Posture is always computed from current positions at read time.

**"Status" is a lifecycle word and must never be used for posture.** Status describes the state of a proceeding or a source's ingestion; posture describes where a fact currently stands between the parties. Do not conflate the two, and do not invent a "fact status" term.

## Issue

A question in dispute, typed as **factual** (a question of fact), **legal** (a question of law), or **mixed** (a question of mixed fact and law). Issues connect facts and legal criteria to the practitioner's strategic view of what is contested.

## Legal Concept and Legal Criteria

**Legal Concept** — a named body of law: a cause of action, doctrine, test, defence, or remedy. Legal concepts are reusable law, not tied to any matter.

**Legal Criteria** — the requirements belonging to a legal concept, each typed as:
- **Element** — mandatory. Every element must be met; failing one element is fatal to the concept succeeding.
- **Factor** — weighed. Factors are balanced against each other; a gap in one factor weakens but does not necessarily defeat the concept.

## Cause of Action Concept vs Asserted Cause of Action

**Cause of Action Concept** — the general body of law describing a cause of action (a kind of Legal Concept), independent of any matter.

**Asserted Cause of Action** — the case-specific instance: this cause of action, in this matter, asserted by a specific claiming party against a specific party. An asserted cause of action refers back to its concept and is assessed against that concept's criteria for this matter's facts.

## Verified

**Verified** describes whether the *extraction or classification* of a row has been quality-checked — nothing more. It does NOT mean the underlying fact is true, proven, admitted, or accepted by a court. A fact can be fully verified (the extraction accurately reflects what the source document says) while still being hotly disputed on the merits. Do not use "verified" as a synonym for "proven" or "true" anywhere in prose.

## Source Citation vs Legal Citation

**Source Citation** — a computed reference of the form `<file_path>#<locator>`, used to pinpoint where in a source a fact or position comes from (e.g. a paragraph, a page/line range in a transcript). A page-less source (a Word document, an email) is located by an ordinal body paragraph or its header block, so that an independent reader re-deriving the same text reaches the same place.

**Legal Citation** — a reported case or statute citation (e.g. a neutral citation or statute chapter reference), used to identify an authority. Legal citations are not computed — they are recorded as reported.

## Participant, Tribunal Member, Alias

**Participant** — anyone a matter's documents name in a role: a party, a party's counsel, a witness (an expert is a witness), or a tribunal member. Every party is a participant; not every participant is a party.

**Tribunal member** — a decision-maker or registry officer the matter deals with: a judge, associate judge, arbitrator, tribunal member or registrar. A participant, never a party, with no role in a proceeding's style of cause.

**Alias** — another recorded spelling of a participant's name, or a **file code**: the author/recipient token the firm's file names use for that participant (`SmithJ`). An alias is recorded only with the practitioner's approval. A name that merely resembles a participant's is a **near match**: a lead to search, never presented as the participant until the practitioner confirms it.

## Usage Rules

- Never use **"Claim"** as shorthand for a cause of action. "Claim" is a position value (a party claims a fact) and is also used loosely in ordinary English for "cause of action" — in this domain's writing, always spell out "cause of action" (or "asserted cause of action") instead of saying "claim" when that is what is meant.
- Avoid the term **"Legal Theory"** entirely. Use "Legal Concept" (general law) or "Asserted Cause of Action" (case-specific) as appropriate — "Legal Theory" conflates the two and adds no precision.
- Never collapse a qualified admission into separate admit/deny rows — see Position above.
- Never use "status" for fact posture — see Fact Posture above.
- Never write **"matter ID"** in prose, in a report, or on any surface a practitioner reads. It is ambiguous three ways — the matter reference, the matter number, and an internal row key that is never displayed. Say "matter reference" or "matter number" and mean the one you said; where the internal key is genuinely what is meant, name it as a storage key rather than as an identifier the practitioner holds.

## Synonyms Table

| Term used in this glossary | Synonym / equivalent phrasing |
|---|---|
| Matter reference | Client-and-matter token; the matter folder's leading token |
| Matter number | The matter token on its own, without a client number |
| Legal Issue | Question of Law |
| Factual Issue | Question of Fact |
| Mixed Issue | Question of Mixed Fact and Law |
| Element | Mandatory Legal Criterion |
| Factor | Weighed Legal Criterion |
| Asserted Cause of Action | Case-Specific Cause of Action |
| Cause of Action Concept | General Cause of Action (in the abstract, not tied to a matter) |
| Source Citation | Computed Citation |
| Legal Citation | Reported Citation |
| Fact Posture | Derived Position Outcome |
