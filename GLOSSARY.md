# CoClerk

BC-only legal practice assistant: skills that manage case data, practice data, and litigation workflows for a British Columbia litigation practice.

## Language

### Document shapes (ingest, 2026-09-03 design)

**Bundle**:
One file that holds more than one document. An affidavit with exhibits, a Book of Authorities, an Application Book, a cover letter with enclosures, a Land Title form with the certificate it registers: all bundles. Inside a bundle there are only three things, a **Leading document**, **Attachments**, and **Apparatus**; an attachment may itself be a bundle. Decided in [ADR-0010](docs/adr/0010-bundle-is-any-file-holding-more-than-one-document.md).
_Avoid_: compound document (retired 2026-09-03: it named an affidavit bundle only, and the "same kind" and "has its own body" tests it implied were the wrong axes); container (engineer-facing); book (the court's word for a filed PDF, not a shape).

**Leading document**:
The document a bundle exists to deliver: the affidavit body, the cover letter, the Land Title form. The first non-apparatus segment in the file. A bundle may have none (a Book of Authorities, a Record: nothing but apparatus in front of the attachments).
_Avoid_: body (the affidavit-only word; keep it for affidavit prose); parent (a storage word: the leading document's row is the attachments' parent, but the concept is the document, not the row); host (engineer-facing).

**Attachment**:
Any document in a bundle other than the leading document. Its relation is fixed by the leading document's kind, never chosen per attachment: an affidavit's attachments are **exhibits**, a letter's are **enclosures**, a Book of Authorities' are **authorities**, a Record's are **Parts**. Each relation has its own identity key (exhibit letter, enclosure ordinal, citation, Part title); the relation itself is derived from the parent and is not stored.
_Avoid_: annexure, appendix (fine in a specific document's own vocabulary, not as the general term); child (storage word).

**Apparatus**:
Pages in a bundle that are not documents: cover page, index or table of contents, exhibit stamp sheet, envelope, fax cover, a one-page table of authorities. Reported for the page map, never extracted, never given a row.
_Avoid_: ignore (the walker's verb, not the noun); boilerplate (that is text inside a document, not pages outside one).

**Record**:
The kind of bundle a court prescribes as numbered Parts with no leading document: a BC Court of Appeal Application Book or Response Book, a chambers record, a petition record, an appeal record. A kind, not a separate shape: a record is a bundle whose attachments are Parts. Classified by its prescribed Part structure, not by how many Parts hold content.
_Avoid_: book (an Application *Book* is a record; a Book of Authorities is a bundle of authorities); binder.

**Copy** (within a bundle):
A later segment of a bundle whose text matches an earlier segment: the scanned paper cover letter behind the digital one, the printed enclosures behind the originals. Noted on the original's row, never extracted twice, never given a row of its own.
_Avoid_: duplicate (reserved for the cross-file hash match at the ingest gate).

**Compound document** (retired 2026-09-03):
Was: an affidavit body plus its exhibits, sharing one file. Now simply a bundle whose leading document is an affidavit. The storage mechanism it named (`main.sources.parent_source_id`, `.claude/skills/case-data/references/design-decisions.md` decision #17) is unchanged; only the word is retired.
_Avoid_: compound document, compound book.

### Matter identity

**Matter reference**:
The token that names a matter's folder and identifies the matter wherever our own systems point at one: either `{client}.{matter}`, a client number and a matter number joined by a dot, or the matter number alone. It is read off the folder name, never assigned — whatever the folder says, that is the matter reference. It names the case-data folder, binds an application, and is what a practitioner is shown when a matter must be identified.
_Avoid_: matter ID (ambiguous three ways — see **Matter row key**); client ID (Westlaw's and UNITY's label for this same value, not ours); file number (that is the court's number for a proceeding).

**Matter number**:
The firm's number for the matter on its own, as the practice database records it. Where a matter reference carries a client number in front, the matter number is the part after the dot; the dot is a separator, never part of the value.
_Avoid_: matter ID; matter reference (a reference may carry a client number the number never does).

Note: the two **coincide on matter-only folders and are still not the same field**. Where a folder is named by the matter alone, its reference and its number are the same value. Where a folder carries a client number, the reference is the whole `{client}.{matter}` token and the number is only the part after the dot. The reference comes from the folder, the number from the practice database — never derive one from the other. Where they are equal, say so once; presenting them as two identical-looking fields reads as a duplicated field and invites a practitioner to "correct" one of them.

**Matter row key**:
Not a practitioner-facing identifier at all: the practice database's internal generated primary key on a matter row, carried as a `matter_id` foreign-key column on its dependent tables. It is never displayed. The storage name `matter_id` is also used, unrelatedly, as the key under which case data and application state store the *matter reference* — those names are load-bearing in schema, JSON, and Python and are deliberately not being changed. Read `matter_id` as the name of a column, never as "the ID we show".
_Avoid_: writing "matter ID" in any prose a practitioner reads, for any of the three senses.

### Case data (moved from the case-data skill's glossary, 2026-10-12)

The domain terms of `/case-data`: its operations, shared conventions and subagent templates. When wording in one of those files seems to conflict with a definition here, this glossary wins. The schema table, column or view behind each term is in `.claude/skills/case-data/references/terminology-crosswalk.md`; the entries below leave table and column names to it. **Matter reference** and **Matter number** are under Matter identity, above.

**Matter**:
The practitioner's engagement with a client. A matter may contain zero, one, or many proceedings (e.g. a matter that is pure advice work has no proceeding; a matter with a counterclaim or a related third-party action has more than one).

**Proceeding**:
One court-filed case within a matter: identified by court, registry, and file number, with a style of cause, parties, and a status (active, stayed, concluded). Facts, sources, causes of action, and issues are generally scoped to a proceeding, not the matter as a whole.

**Source**:
Case-specific recorded material belonging to a matter: a document, but also a recording, photograph, or transcript — anything that captures information in a fixed, referenceable form. Sources are the case-specific evidentiary record. A key boundary: **unrecorded anticipated testimony is NOT a source** until it is captured in some record (an affidavit, a transcript, a will-say statement). Until captured, it cannot be cited or linked as evidence — it is merely anticipated.

**Authority**:
Reusable legal material with zero client data: case law, legislation, regulations, treatises. Authorities live outside any matter and are shared across matters.

**Privileged Source**:
A source subject to privilege. A privileged source may explain *how* a fact was discovered (its provenance) but can never itself be treated as admissible evidence. Privileged sources and non-privileged sources are kept in physically separate storage so that no path can accidentally connect privileged material to the evidentiary record — see the design decision on the privilege firewall.

**Fact**:
A discrete factual assertion about the real world (not a legal conclusion, not a party's characterization of it).

**Provenance**:
Where a fact was learned; this may be privileged (e.g. a client interview) even when the fact itself is later provable through non-privileged means. A fact can have provenance without evidence — that is a trial-prep gap (a fact you know how you learned, but cannot yet prove admissibly).

**Evidence**:
Non-privileged material linked to a fact as support (or contradiction) for it.

**Proof**:
The litigation conclusion that a fact is established: through evidence, through an admission, through an agreed statement of facts, or otherwise. Proof is a legal/strategic judgment, not a database flag.

**Theorized Fact**:
A fact **theorized for the purpose of investigation** — a fact the case theory needs but that no source yet evidences. It cannot be derived from anything (theorizing is an act, not an inference), so it is recorded; but it is **not a party position** (no stance is on any record) and **not a posture** (nothing exists to derive one from). What it *is* is **provenance**: the fact's source is the case theory itself, modelled as a well-known placeholder source (one *Theory of the case* work-product source per application, created lazily). A theorized fact is precisely a fact whose only provenance is that theory placeholder and whose evidence is empty — the trial-prep gap above, at the earliest stage, where "not yet evidenced" is the expected pre-affidavit state, not a defect. It is privileged work product, so its `main.facts` row is a **Bare Row** (below): the wording lives on the privileged side only. It graduates when a non-privileged source states the same Fact, so the row takes that source's own Statement of Fact, and real evidence then lands: an ordinary evidence link makes it an ordinary evidenced fact, and it stops being theorized **by construction** — no "evidenced" marker exists or is needed. The theory provenance stays as the history of how the fact entered. The only other exit is **Dismissed** (below).

**Dismissed**:
The **terminal** disposition on a theorized fact's provenance: our own investigation concluded the fact is **likely untrue**. Recorded on the provenance row, never by deletion — the record of what was considered and rejected is the point. An argument may not rest on a dismissed fact. "Dismissed" is a fact-investigation disposition, **not** a party position and **not** a posture, and it is knowable only for **our own** side — there is no way to know what an opposing party has privately dismissed. (Distinct from a *proceeding* status or an *issue* status — see the status/posture caution below.)

**Bare Row**:
The `main.facts` row for a Fact known **only through privileged sources**: an ID and nothing else (`description = ''`, no category, date, source, notes, informant or basis). Privilege attaches to a Statement of Fact by its source and never to a Fact, and any summary, paraphrase or abridgement of a privileged statement is itself privileged, so the non-privileged store holds no wording for such a Fact. The Statement of Fact stays in `privileged.fact_provenance.source_note`, and only a privileged-side read (`@query_10`, `@query_22`) shows what the ID means. Nothing links to a bare row, and drafting, list and verification reads skip it. It becomes an ordinary fact only when a non-privileged source states the same Fact and the row takes that source's own Statement of Fact. See `.claude/skills/case-data/references/design-decisions.md` #67 and `.claude/skills/case-data/operations/bare-privileged-facts.md`.

**Position**:
A party's stance on a fact: **claim**, **admit**, **deny**, **not_admit**, or **no_position**. "No knowledge" pleading language maps to `not_admit` with `position_basis = outside_knowledge`. Express abstention maps to `no_position`; actual silence is represented by no row. Verbatim limiting wording is preserved in `qualification`.
_Avoid_: claim as shorthand for a cause of action. "Claim" is a position value (a party claims a fact) and is also used loosely in ordinary English for "cause of action" — in this domain's writing, always spell out "cause of action" (or "asserted cause of action") when that is what is meant.

**Qualified admission**:
A single **admit** position where the limiting language is recorded verbatim (never split into a separate admit row and a separate deny row, and never paraphrased).

**Fact Posture**:
The practical state of a fact given all current positions on it — **derived, never stored**. Values: **disputed**, **admitted**, **not_admitted**, **no_position**, **claimed**, and **unaddressed**. Posture is always computed from current positions at read time.
_Avoid_: status. **"Status" is a lifecycle word and must never be used for posture.** Status describes the state of a proceeding or a source's ingestion; posture describes where a fact currently stands between the parties. Do not conflate the two, and do not invent a "fact status" term.

**Issue** (case data):
A question in dispute, typed as **factual** (a question of fact), **legal** (a question of law), or **mixed** (a question of mixed fact and law). Issues connect facts and legal criteria to the practitioner's strategic view of what is contested. Not the application-response **Issue** below (the question a Basis answers).

**Legal Concept**:
A named body of law: a cause of action, doctrine, test, defence, or remedy. Legal concepts are reusable law, not tied to any matter.
_Avoid_: Legal Theory (avoid the term entirely; use "Legal Concept" for general law or "Asserted Cause of Action" for the case-specific instance — "Legal Theory" conflates the two and adds no precision).

**Legal Criteria**:
The requirements belonging to a legal concept, each typed as an **Element** or a **Factor**.

**Element**:
A mandatory legal criterion. Every element must be met; failing one element is fatal to the concept succeeding.

**Factor**:
A weighed legal criterion. Factors are balanced against each other; a gap in one factor weakens but does not necessarily defeat the concept.

**Cause of Action Concept**:
The general body of law describing a cause of action (a kind of Legal Concept), independent of any matter.

**Asserted Cause of Action**:
The case-specific instance: this cause of action, in this matter, asserted by a specific claiming party against a specific party. An asserted cause of action refers back to its concept and is assessed against that concept's criteria for this matter's facts.

**Verified**:
Describes whether the *extraction or classification* of a row has been quality-checked — nothing more. It does NOT mean the underlying fact is true, proven, admitted, or accepted by a court. A fact can be fully verified (the extraction accurately reflects what the source document says) while still being hotly disputed on the merits.
_Avoid_: verified as a synonym for "proven" or "true" anywhere in prose.

**Source Citation**:
A computed reference of the form `<file_path>#<locator>`, used to pinpoint where in a source a fact or position comes from (e.g. a paragraph, a page/line range in a transcript). A page-less source (a Word document, an email) is located by an ordinal body paragraph or its header block, so that an independent reader re-deriving the same text reaches the same place.

**Legal Citation**:
A reported case or statute citation (e.g. a neutral citation or statute chapter reference), used to identify an authority. Legal citations are not computed — they are recorded as reported.

**Participant**:
Anyone a matter's documents name in a role: a party, a party's counsel, a witness (an expert is a witness), or a tribunal member. Every party is a participant; not every participant is a party.

**Tribunal member**:
A decision-maker or registry officer the matter deals with: a judge, associate judge, arbitrator, tribunal member or registrar. A participant, never a party, with no role in a proceeding's style of cause.

**Alias**:
Another recorded spelling of a participant's name, or a **file code**: the author/recipient token the firm's file names use for that participant (`SmithJ`). An alias is recorded only with the practitioner's approval. A name that merely resembles a participant's is a **near match**: a lead to search, never presented as the participant until the practitioner confirms it.

Synonyms for the case-data terms:

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

### Shared legal knowledge (three-layer re-architecture)

**Principle**:
A generalized, matter-free statement of law — the atomic unit of the shared knowledge pool: the thing that is embedded, deduped, merged, variant-linked, and up-pointed. Authorities attach to it as supporting evidence.
_Avoid_: concept, doctrine (as the stored entity)

**Severance**:
The push-time act of stripping everything matter-identifying from a principle before it leaves the privileged working layer for the shared pool. Up goes the generalized text, public citation, and doctrinal metadata; no column, relation, or free-text in the pool may point back to a matter.

**Up-pointer**:
The one-way, local-only record "my local principle = cloud principle #N". The cloud holds no reciprocal pointer; a cloud ID, once minted, must resolve forever.

**Variant**:
A meaning-bearing near-duplicate principle (a judge's different spin on a doctrine) kept as its own full entry — own ID, own embedding — linked to its cluster representative rather than merged. Clusters are rooted stars, never chains.

**Representative**:
The principle anchoring a variant cluster, chosen by canonical-phrasing rule (shortest, alphabetical tiebreak). A query anchor, not a ranking — lookups return the whole cluster.

**Redirect**:
The permanent `old ID → canonical ID` record left when a merge repair deletes a duplicate principle row. Kept in a separate redirect table (main table holds only live rows), flattened to depth 1, resolved invisibly by the lookup tool.
_Avoid_: tombstone

### Application response (responding-to-applications design)

**Basis** (was: Ground):
A distinct legal footing for opposing an order sought in a notice of application — **jurisdictional** (the court has no authority to make this order on this application) or **doctrinal** (a doctrine, test, or line of principle that defeats it), in the same sense `prepare-application` uses the word. A basis may also be a bare failure of proof: that the applicant has not made out an element it must — a third kind that is **respondent-side only**, for the same reason **Issue** is: it is a defect in the other side's case, not a footing for your own. The applicant-side **Basis** therefore has two kinds, not three. Groups arguments; an order may be opposed on as many bases as the material supports.
_Avoid_: ground, grounds (retired — **Ground** is reserved for the applicant-side desk-order fact-proposition and is never used on the respondent side); issue (an issue is the question a basis answers); point; defence.

The on-disk names are permanently unchanged: `_ground.md`, the `<ground-slug>` registry directory, the `ground_hint` observation key, the `practitioner_suppressed` `_ground.md` field, and the verifier's `GROUND` input and `non_circular_ground_support` verdict key are legacy code keys, never words in practitioner output. They are frozen, not scheduled — stage-14's page-loop tie-break sorts on the literal ground slug, so changing slug text would silently change which arguments a completed application cut.

**Issue**:
The question a **Basis** answers, framed neutrally from the applicant's own Part 3 and confirmed by the practitioner at stage 6. One issue tree per opposed order, carrying the governing test and its elements. Lineage: `argument -> basis -> issue -> opposed order`. **Respondent-side only** — it has no `prepare-application` counterpart, because an applicant frames its own case rather than answering a question put to it; there, the governing test lives in a **Statement** *below* the Basis, not in an Issue above it.
_Avoid_: ground (retired); question presented; basis (a basis is the footing, an issue is the question).

**Argument**:
A developed reasoning chain supporting a basis, with its authorities and facts. The unit stored in Available Arguments. The definition was shared with `prepare-application` (retired 2026-08-27, #374); this entry is now the sole surviving definition.

**Proposition**:
The one succinct, semantically compressed sentence a statement of law stands for — in an Elaboration's `### Law` part, the citation-bearing sentence each verbatim `> ` excerpt hangs from. Was defined once for both pipelines in `.claude/skills/prepare-application/CONTEXT.md` (legal spine, retired 2026-08-27, #374); this entry is now the sole surviving definition, carried forward unchanged.
_Avoid_: statement of principle (retired — a **Statement** on the applicant side is a whole rule or test, not one sentence); holding; principle (as the stored sentence).

**Available Arguments** (was: Argument Registry):
The single durable, privileged store of every argument produced for an application response — the full candidate pool of everything the respondent *could* argue. Any one argument may or may not make it into the **Submissions** actually advanced at the hearing (in writing, orally, or held in reserve); a **Dropped** argument (see Inclusion) stays in the pool but is never advanced. Arguments are never deleted, only demoted through their **Inclusion** (Run → Hold in Reserve → Drop); all output documents are projections of it.
_Avoid_: argument registry, argument pool ("registry" collides with the BC court registry — the filing office where documents are filed and served; this store is the opposite: privileged and never filed).

**Observation** (was: Finding; absorbs: Research Lead):
An argument-worthy item spotted at any stage — an opponent defect (error, inconsistency, affidavit inadmissibility, non-existent/mischaracterized authority), a favourable authority, or a new fact — that is not yet an argument: it has no basis and no reasoning chain. Observations live in the List of Observations, separate from Available Arguments, and join Available Arguments only by being developed into arguments (brainstorm is the sole author). An observation found before the first brainstorm round comes from intake review; one found later comes from research, an authority's negative treatment, or a late client answer — the round/stage is provenance metadata, not a different concept. Each observation carries a **valence** — a *weakness in their case* or a *point in our favour* — but is one concept either way; the intake scan looks for **both** from the outset, because the applicant's own materials sometimes hand us ammunition. Why this is one valence-neutral concept and not split into "Vulnerability" / "Ammo": see [ADR-0001](docs/adr/0001-observation-single-valence-neutral-concept.md).
_Avoid_: finding (collides with a judge's *findings of fact* — these are pre-argument items we spotted, not concluded determinations); argument; objection (as a stored entity); research lead, lead (both retired into Observation; "lead" also collides with *leading evidence* / *lead counsel*); vulnerability, ammo (a valence is an attribute of an Observation, not a separate concept — ADR-0001).

**List of Observations** (was: Findings Store):
The privileged, strict-parsed store of intake observations (`privileged/findings/`), distinct from Available Arguments. Stage-scoped ids (`f2/f3/f4-###`); every observation ends up either developed into an argument or dismissed — enforced by the Observation Review Hold.
_Avoid_: findings store; observations store (both too engineer-facing — a lawyer says "the list of observations").

**Authority dead-end** (was: authority gap):
The stage-8 research outcome recorded when the search for authority supporting an issue framing **ran to completion and the space is empty** — no located authority supports the proposition on its dispositive element on analogous facts. It is minted as its own observation and fires the zoom-out ladder; it is never a failed fetch, a paywall, or an un-run tool, which are ordinary research gaps.
_Avoid_: authority gap, gap (retired for this sense — "gap" is reserved for the two applicant-side spine senses, **Gap** and **Proof gap**, formerly defined in `.claude/skills/prepare-application/CONTEXT.md` (retired 2026-08-27, #374; the reservation stands regardless). A dead-end is neither: research ran and found nothing at that framing). The `finding_type: authority-gap` enum value and every key scoped to it (`issue_ref`, `rung`, `broadened_from`, `broadened_to`, `stage: '8'`) are frozen legacy code names — `OBSERVATION_KEYS` is strict-parse-or-die — and never words in practitioner output.

**Develop** (was: Promotion):
The stage-7 (brainstorm) act of developing an observation into one or more arguments — one per affected opposed order — assigning a basis, `round`, `arg_status: brainstormed`, and Inclusion **Run** by default (Argument Selection reviews every argument later), and recording the observation id as the argument's `source_findings` provenance. A copy-with-provenance, not a re-derivation. The only path from an observation into Available Arguments.
_Avoid_: promotion (software "promote to prod" smell). Internal code keys (`finding_status: promoted`, `promoted_to`) stay unchanged — this renames the human-facing term only.

**Observation Review Hold** (was: Findings Floor):
The completion gate on developing observations: no brainstorm round may close — and convergence may not be declared — while any observation is still `open`; each must be reviewed and either developed into an argument or narrowly dismissed (mootness, or a practitioner call) with a reason. Generalized from round-1-only to every round so that late observations (from research, negative treatment, or a late client answer) cannot silently evaporate; the convergence-wiring that enforces this per-round is tracked in #137. The observations-side analog of Available Arguments' "every argument accounted for"; pairs with the Pending-Answers Hold.
_Avoid_: findings floor ("floor" is reserved for true disclosure minimums — basis floor / fact floor; this is a completion gate, not a minimum).

**Version** (was: Rendition):
One of the two texts an argument can carry: a **Summary** (rendered in the Form 33) and an **Elaboration** (rendered in the Written Argument). Every **Run** argument carries both, written once when the argument is validated; a **Hold-in-Reserve** argument carries only an Elaboration (it never enters the Form 33, so a Summary would never be projected). For Run arguments this makes the argument↔summary link one-to-one and enforces the principle that the Form 33 and the hearing argue the *same* arguments at two levels of detail; no new argument surfaces at the hearing.
_Avoid_: rendition ("version" is what a lawyer says; "rendition" reads oddly aloud); "form" as the umbrella (collides with court Forms — Form 32/33).

**Inclusion** (was: Disclosure Tier):
What we decide to do with an argument — its disposition, on one axis, orthogonal to its Version: **Run** (put it in the submissions — Summary → Form 33, Elaboration → Written Argument), **Hold in Reserve** (keep it in the Rebuttal Plan, deployed only if triggered), or **Drop** (cut). There is no "elaborate-but-don't-summarize" state: a Run argument appears in *both* documents, so the Form 33 discloses the full affirmative case. See [ADR-0002](docs/adr/0002-two-property-argument-model.md).
_Avoid_: disclosure tier ("disclosure" = document disclosure/discovery; "tier" is meaningless to a lawyer); disposition (overloaded with a case's disposition). The frontmatter code key may stay `tier` — this renames the human-facing concept only.

**Submissions**:
The umbrella for everything the respondent advances at the hearing — broader than "argument." It spans the primary **Argument** (the affirmative case — arguments whose Inclusion is **Run**, Summary in the Form 33 and Elaboration in the Written Argument) and the **Reply**/rebuttal (arguments **Held in Reserve** in the Rebuttal Plan, advanced if the applicant's argument fires their Rebuttal-Trigger). Delivered as **written submissions** (the Written Argument) and, at the hearing, as **oral submissions**. Only **Dropped** arguments are never submissions.
Note: the Hold-in-Reserve bucket carries three kinds of point, distinguished by a `reserve_reason` — genuine reply/rebuttal (`rebuttal`; anticipated surprise arguments, real Rebuttal-Trigger "if the applicant argues X"), page-pressure backups (`page-pressure-backup`; arguments cut from Run to keep the Form 33 under length, standing trigger), and our-own alternative-relief fallbacks (`alternative`; fired on a court-inclination trigger "if the court declines the primary relief"). Only the first is "reply" in the strict sense. A Hold-in-Reserve argument carries only an Elaboration (never a Summary — it never enters the Form 33).

**Basis Floor** (was: Grounds Floor):
The mandatory disclosure minimum — every basis with a live argument on an opposed order must have at least one argument **Run**. Suppressing an entire basis below the floor is practitioner-only.
_Avoid_: grounds floor (retired); minimum disclosure; sandbagging limit

**Projection**:
A generated document produced from Available Arguments by filtering on Inclusion and picking the right Version — never hand-maintained. The Form 33 (Summaries of Run arguments), Written Argument (Elaborations of Run arguments), and Rebuttal Plan (Held-in-Reserve arguments) are the three projections.

**Rebuttal-Trigger** (was: Deployment Trigger):
The condition on a **Held-in-Reserve** argument stating when to deploy it at the hearing. Every Rebuttal Plan entry has one, and its shape follows the `reserve_reason`: a genuine rebuttal names a real applicant-argument condition ("if the applicant argues X"); an alternative-relief fallback names a court-inclination condition ("if the court declines the primary relief"); a page-pressure backup carries a standing trigger ("advance if time permits and the hearing opens the door"). A Held-in-Reserve argument with no trigger at all is a validation error — a merely-weak argument with nothing to fire on is Dropped, not held.
_Avoid_: deployment trigger; counter argument; reply-trigger.

**Argument Selection** (was: Disclosure Staging):
The pipeline stage that sets each argument's Inclusion — Run / Hold in Reserve / Drop — new arguments defaulting to Run, held against the basis floor, practitioner spot-checked.
_Avoid_: disclosure staging ("disclosure" = document disclosure; "staging" is meaningless to a lawyer); strategic non-disclosure, concealment (the point is selecting arguments to run, not concealing them).

**Rebuttal Plan**:
The privileged projection of every **Held-in-Reserve** argument (rendering their Elaborations) — a trigger→response playbook for the hearing, holding anticipated surprise-argument rebuttals, alternative-relief fallbacks, and page-pressure backups (distinguished by `reserve_reason`). Never filed or served.

**Written Argument**:
The master argument document, distilled from Available Arguments and surfaced at the hearing. Not a prescribed court form.

**Argument Status**:
The processing state of an argument within the loop: `brainstormed` → `researched` → `validated`, or `failed`. Distinct from its Inclusion (which says whether we Run / Hold in Reserve / Drop it); status says *how far through validation* it is. Only `validated` arguments are eligible for distillation.

**Round Cap / Revise Cap**:
The two livelock guards on the brainstorm→research→validate→revise loop. Round cap (default 4) bounds whole loop rounds; revise cap (default 3) bounds re-validation attempts on a single argument. Hitting either pauses and asks the practitioner rather than spinning.

**Inclusion History** (was: Tier History):
The appended log on an argument recording each change to its Inclusion (Run → Hold in Reserve → Drop): date, from→to, reason. Demotions never overwrite silently — this is how "never deleted, only demoted" is auditable.

**Rev Guard**:
The concurrency check on the pipeline's `state.json`: a monotonic `rev` counter that every writer re-reads and compares before writing; a mismatch hard-fails loudly rather than last-writer-wins, because sessions run concurrently on a shared tree.

**Materiality Map**:
The stage-5 tagging of every opponent fact claim with the numbered order(s) it supports. Only claims material to some relief sought proceed to Ask Client; immaterial claims are parked, not deleted.

**Ask Client** (was: Client Canvass):
The stage-5 evidence-gathering cycle: material fact claims with no existing contradicting evidence in `/case-data` become plain-language questions the practitioner puts to the client; answers are classified (direct evidence / information and belief / mere belief) and recorded via `/case-data` with privileged provenance. The agent never contacts the client.
_Avoid_: admissions review (an application response requires no admissions); client canvass

**Pending-Answers Hold** (was: Canvass Floor):
The convergence guard for Ask Client: the loop cannot converge while any Ask Client question is still awaiting a client answer. The stage-5 analog of the Observation Review Hold.
_Avoid_: canvass floor (renamed — "floor" is reserved for true disclosure minimums, basis floor / fact floor; this is a completion gate, not a minimum).

**Responding-Affidavit Brief**:
The stage-5 artifact planning our responding affidavit(s): per material contradicted fact, the contradicting information, its evidence class, the proposed deponent, and the orders it bears on. Deponent strategy is gated by the interlocutory/final flag — interlocutory: one assistant affidavit on information and belief; final: personal-knowledge deponents only. Drafting and swearing happen outside the pipeline; render-time checks enforce the sworn affidavit is on file and listed in Part 6.
Compare `prepare-application`'s **Evidence Table**, which is a different artifact answering a different question: the Evidence Table proves *your own* elements against an established legal basis, while this brief contradicts *their* fact claims and carries deponent strategy the Evidence Table has no column for. They are deliberately not merged.

**Research Lead** → retired; merged into **Observation**.
A "research lead" was a discovery made after brainstorming had already run (from research, an authority's negative treatment, or a late client answer). Analysis (keystone #132) established it is the *same concept* as an Observation, found later — so it is now just an Observation with later round/stage provenance. See **Observation**. Entity-merge (actually storing late observations) is tracked in #137.

**Semantic Compression** → retired. Its plugin agent was removed once its only dispatcher, the responding-to-applications pipeline, retired (#374).

**Strength Rank**:
The ordinal rank (`1..N`, dense) stage 12 assigns each live argument **per basis × opposed order** — rank 1 is the basis's floor argument. The sole input to the deterministic stage-14 page loop, which compresses summaries weakest-first in this order and then, if still over length, cuts whole arguments weakest-first — each cut pausing for an explicit acknowledgment. Persisted so the loop is reproducible.

**Page-Pressure Cut** (was: Page-Pressure Demotion):
A stage-14 demotion of a whole argument from **Run** to **Hold in Reserve** (as a page-pressure backup) when summary compression alone can't bring Form 33 under 10 pages — the weakest non-floor Run argument first, by the deterministic cross-basis rule. Because a cut now removes the argument from the submissions entirely (not merely from the Form 33), it is **not** silent: summaries are compressed to their minimum first, and each whole-argument cut pauses for an explicit practitioner acknowledgment.
_Avoid_: page-pressure demotion ("demotion" understated the new stakes — the argument leaves the submissions, not just the form).

**Fact Floor**:
The demotion-immunity rule that the last fact-carrying **Run** argument on an opposed order with contested facts cannot be demoted below Run — sits beside the basis floor so a page-loop can never strip an order's factual basis.

**Floor-Conflict Pause**:
The terminal stage-14 hard pause (`pause_reason: floor-exceeds-page-cap`) when the demotion-immune floor arguments alone exceed 10 pages after aggressive floor compression — the 10-page rule and the floor genuinely conflict, and only the practitioner may resolve it.

**Polish Gate**:
The single post-page-loop run of stages 16a → 15 → 16b on the byte-final Form 33. Every verdict is bound to the projection's content hash; stage 17b refuses to finalize unless all three verdicts carry the exact hash being filed.

**Projection Manifest**:
The privileged sidecar (`privileged/projections/form-33.manifest.json`) mapping each rendered Form 33 paragraph to its source arg-id, Part, and `/case-data` fact ids, plus a content hash of `form-33.md`. Regenerated with every projection; the deterministic substrate of the stage-16a coverage and cross-reference checks.

**Verification Ledger**:
The content-hash-keyed cache of per-paragraph pinpoint-citation/excerpt verdicts (keyed on `(arg-id, Version text)`, so paragraph renumbering never invalidates a verdict). Lets Polish-Gate re-entries re-verify only changed paragraphs.

**Pure-Law Opposition**:
An opposed order the practitioner has confirmed (once, sticky — `pure_law_confirmed_orders`) will be resisted on legal basis alone (procedural bar, admitted facts, onus failure as a matter of law). Its Part 4 renders "Nil." and the coverage check does not hard-fail on the absent facts.

### Submission drafting (map issue #285)

**Writing** (submissions, #950):
Any legal writing `/draft` drafts in a proceeding: a Filing, a demand letter, a letter to opposing counsel, a memo to file. It carries its own metadata, its selection and order of the proceeding's shared substance, and its mockups. Every Writing belongs to exactly one proceeding, which may have no forum. Every Writing is either **Form-bound writing** or **Free-form writing**. On a separate axis, every Writing is either a **Structured Writing** or an **Unstructured Writing**. A client letter is not a Writing: it is solicitor-client material, drafted from guidance only, with no Job Board or Goal card (ADR 0004, #1047). Internal names are unchanged: a Writing is stored as a `filings` row, with its `kind` values. Lowercase "filing" in this glossary means only the act of delivering a Writing to a registry or forum, never the Writing itself.
_Avoid_: filing for a Writing (filing is the act of delivery to a registry or forum); document (reserved for the evidence-side object below); draft (a rendered-for-review file of a Writing).

**Structured Writing**:
A Writing whose type has a declared layout: which parts it has, in what order, and which of its wording is fixed. Letters, memos, the release and the BCSC forms with their own generators are Structured.
_Avoid_: bespoke (a rendering path: a Structured Writing may render through the shared general renderer); form-bound (a different axis: a demand letter is Structured and free-form).

**Unstructured Writing**:
A Writing whose type has no declared layout yet. Its printed wording is drafted freely, and the practitioner gets the same review, revisions, Job Board and Word handoff as for any Writing. Once it is sent, it can be converted into a type with a declared layout, so the next Writing of that type is Structured. A form-bound writing with no specialist skill is drafted this way, its fixed wording copied from a saved copy of the published form.
_Avoid_: free-form (a different axis: a court form with no generator is Unstructured and form-bound); hand-written mockup (its mockup is still generated).

**Filing**:
A Writing delivered to a forum in a proceeding — a VanIAC submissions package for one round, a BCSC requisition, a letter to the court or tribunal. A Writing the forum "receives" rather than "files" is still a Filing. A Writing delivered only to another party, or kept on the file (a memo to file), is not (ADR 0024 D1's widening to party-to-party deliveries is superseded, #1047).
_Avoid_: package (one kind of Filing); instrument; application (one kind of Writing); court document (wrong for arbitration); submission (one contention with its argument); filing for a letter to opposing counsel (a Writing, not a Filing).

**Letter** (submissions, ADR 0024):
A Writing that is a letter or email to the forum or to another party in a proceeding, when it takes a position, asks for something, consents or refuses, or offers. A Letter to the forum is also a Filing; a Letter only to another party is not. Its filed face is the version actually sent. An email to a tribunal is a Letter too. Never client correspondence, which is solicitor-client material.
_Avoid_: correspondence (broader: it includes client letters, which are never Letters); email as a separate kind (the delivery, not the thing); transmittal (a covering email is its Writing's delivery, not a Letter).

**Draft**:
A rendered-for-review file in any format — markdown, .doc, .docx or .pdf — that the practitioner reads; the review surface, never the filed face. A Writing is a folder of drafts.
_Avoid_: document (reserved for the evidence-side object below); report.

**Mockup**:
A Draft in markdown format — the word is reserved exclusively for markdown. A filtered, compressed markdown rendering of the submission database for one member of a Writing, read by the practitioner and by every agent session alike — the sole review surface and the session's starting picture. It shows everything the practitioner must decide about, reserved material included. Regenerated, never hand-edited; stamped with the database revision it was rendered from. Its format is strict: a YAML header, then only wording that will be printed, work markers and `<!-- comments -->`, then the symbol Legend, which is generated and never written. A gap prints as a marker and a blank underline, with its description in a comment (`🧩 ________ <!-- signer not chosen -->`), never as a description. No commentary, suggestions or loose ideas.
_Avoid_: report; readiness report; document.

**Projection**:
A Mockup generated by the deterministic engine (as opposed to one an agent wrote by hand). Every Mockup is a Projection, an Unstructured Writing's included: the model writes printed wording into the database and never writes a mockup. The word is used when the deterministic origin matters. Same idea as the application-response **Projection** above (generated, never hand-maintained), applied to this plugin's mockups.
_Avoid_: render, output (the act / the bytes, not the thing).

**Document** (submissions):
The evidence-side object a statement of fact or an admission points at — the **Instrument** (the witness's, carrying the words to the forum; or the admission instrument through which an admission is sought), the **Exhibit** a statement tenders, or an admission's response — with its identity (label · date · description), best-copy mark and service date. Not a member of a Writing: those are Drafts / Mockups (the written-argument mockup, the requisition draft). The renderer's `documentType` key for the Writing-member sense is a frozen legacy code name. Exception: the mockup header's "Document …" labels (`Document Type`, `Document Name`, `Document Date`) name the Writing being drafted, not this evidence-side object; `Document Type:` replaced `Draft:` on 2026-10-07, reversing #327's relabel.
_Avoid_: document as a Writing member (say mockup or draft); file (the disk artifact, not the thing); paper.

**Component** (submissions):
A part of a Mockup — caption (style of proceeding), orders, paragraphs, excerpts, signature block, address for service, frontmatter header. Shared Components render through one **component engine** each so every Mockup presents them identically.
_Avoid_: section (a schema term); part (Form 32's own word).

**Work marker**:
One emoji from a closed set, printed on a Mockup where a predicate over the database is true (an open jurisdictional-basis slot, an excerpt with no pinpoint, a fact with no witness…), each naming the work that finishes it. The compressed to-do list of a Writing. Deferred work counts (a reserved row awaits its deployment decision); only ⬜ means nothing started; an emoji that names no work is not a marker. Three types: **work** (we act), **event** (they or the world acted — reports that outcome and renders as prefix of the work it routed; several events may route the same work), **hold** (our posture — renders only in Held in reserve). Rules, tables and mis-readings: `.claude/skills/drafting-data/references/work-markers.md` (SSOT; `work-marker-emojis.md` is its deprecated narrative predecessor).
_Avoid_: badge (one marker); glyph (retired 2026-08-21, #327); readiness decoration; checklist; status label (of our work — an event marker reports their outcome, never our progress).

**Postulate**:
A fact-domain assertion in the lawyer's own words — what we say happened. Its twin in the law domain is a **Proposition** (same sense as the application-response entry above); the two combine in a **Contention**. Statements support a postulate in their own words and need not repeat it.
_Avoid_: claim (used loosely for either domain); contention (a submission's assertion — law applied to fact — never a bare postulate, #323); allegation (a postulate anchored in a pleading, advanced formally, proof not yet marshalled); fact (the stored row, not the wording).

**Contention** (submissions):
A submission's assertion: law applied to fact — the position one side argues for, in the lawyer's wording. Never a bare postulate or a bare proposition (a postulate stored as a contention is how law-side markers once landed on a fact, #323). Also called an **application paragraph**, the practitioner's name for a contention that does this job: it links at least one fact and one proposition and argues the connection between them (🧾 and 📚 flag a missing link).
_Avoid_: theory, thesis (rejected #323); proposition (law alone); point (an opposing point is theirs).

**Job** (submissions, was: Ticket; schema v15, ADR 0009):
One unit of session work for `/draft`, shown on the Job Board as a job card — either drafting/research work scoped to a Writing or proceeding (`kind = 'work'`), or the work of outlining further jobs (`kind = 'charting'`). Every card is a job: there is no job/to-do split. Stored, and always rendered on the Job Board — never on any advocacy document. Always belongs to a proceeding, never to the matter alone, including a pre-filing proceeding (ADR 0018). A session refers to one as "Job #6", never bare "#6". File names and prose say job (`drafting-data/references/jobs.md`, `draft/references/job-session.md`; #1050). Database and code identifiers are unchanged: the `tickets` table and every `ticket_*` table and `ticket_id` column, the `#ticket-N` anchors on the board, the `board_data` key `tickets` and the Goal card's `tickets` criterion id.
_Avoid_: ticket (reserved for development tasks such as GitHub issues and Wayfinder tickets, and for database identifiers); task (collides with software usage — the design's own deliberate choice); assignment (it implies a transfer of responsibility); to-do (a practice-registry row, see **To-do**).

**Step** (submissions, schema v15, ADR 0009):
One line item on a job card, in order, stamped done as its work completes. Human-only work (a deponent swearing, a witness signing) is a step listed for the practitioner and never dispatched. Internal names are unchanged: the `ticket_steps` table and its columns.
_Avoid_: line item; task; to-do.

**Assign** (submissions):
To give a job to one session, which then holds its lock: "Assign Job #6 to this session?". The recipient is always a session, and assigning transfers no responsibility. Internal names are unchanged: `locked_by`, `locked_at`, and the guarded write that sets them.
_Avoid_: claim (the word before 2026-09-22).

**Pre-filing proceeding** (submissions, ADR 0018):
A proceeding with no Writing yet. Its forum may not yet be chosen (`forum` NULL). A Writing that needs no forum parts, such as a demand letter, may be created before the forum is chosen, and one that needs forum parts only after. It holds jobs and loose threads, for example the work of choosing the forum, on a Job Board of its own. Its first Writing ends it, with or without a forum: see **Job Board**. Choosing the forum updates the same proceeding. A second forum is a new proceeding, and no job moves between them.
_Avoid_: pre-litigation matter (the matter exists either way); undecided forum as a stored value (it is NULL, not a sentinel); pre-filing for a proceeding whose only Writing is a demand letter (nothing has gone to a forum, but it has a Writing, so it is not one).

**Loose thread** (submissions, was: Seed; schema v15, ADR 0009):
Two senses, told apart by where each appears:
- on the Job Board, an item in the "Ideas for later" lane: an idea captured mid-job without deciding anything about it — verbatim, at most five sentences, no options or recommendations. Never ripe, never a blocker; consumed only when an outlining session turns it into a real job (`seeds.charted_into`). It never counts toward a completion criterion.
- on a mockup, the 🧵 work marker, defined in `.claude/skills/drafting-data/references/work-markers.md`, which counts toward the open-items criterion.
The Job Board's own "Ideas for later" section already renders the first sense in the lawyer-facing word — the deferred vocabulary pass (design doc §11) covers only widget labels and prompts elsewhere, not the board's own headings, which were lawyer-facing from the start (that is the point of a rendered surface). Internal names are unchanged: the `seeds` table, `review_points.seed_id`, `seeds.charted_into`, the `seed` CSS class, element ids and data key.
_Avoid_: note (a different, unstored concept this schema deliberately excludes); seed (the word before 2026-10-05).

**Ripe** (submissions):
A job that is `queued`, unlocked, every blocker completed, and (if it has one) no conflicting job currently `wip` — ready to assign, by the practitioner naming it or by an attended session's own choice (ADR 0022). The Job Board's own "## Ready" heading already uses the lawyer-facing word for this state; see **Loose thread**'s note on why the board's headings are exempt from the deferred pass.
_Avoid_: available (generic English — "ready" here means specifically classified so by the renderer, per the CHECK-and-conflict logic above).

**Outlining** (submissions):
A session (an outlining interview) whose deliverable is one or more `tickets` rows — new, outlined afresh, or outlined from Proposals — and their dependencies, blockers, conflicts, and priorities — never substance. The practitioner supplies the work, conflicts and priorities, recorded in their words; the session divides the work into jobs and records what waits on what. A session either outlines or executes one assigned job, never both.
Outlining writes jobs on the practitioner's word:
- jobs in their own words, through the interview.
- jobs from their pick: a Proposal picked unedited (`draft/references/job-session.md`, "Left unedited"), or a `/prepare` stock job picked at the read-back (`/drafting-data` §3b, `prepare/SKILL.md` §6).
- a queued job reworked in place, which is an outline afresh (`/drafting-data` §3a).
Jobs written by rule with no pick are not outlining:
- the stock jobs written at the letter and memo save (`/drafting-data` §3b, ADR 0024 D10).
- counsel's review pair (`/drafting-data` §3c).
- the scrutiny review job (`/drafting-data` §3d).
- the gate jobs (`/drafting-data` §14, §14a).
- intake (`/drafting-data` §3e), which writes never-held Proposals as jobs at each attended Opening.
_Avoid_: planning (a different, DB-agnostic Coclerk concept elsewhere); charting (retired 2026-09-13, software-tooling word; also wayfinder's verb).

**Scope** (submissions, job sense):
The set of database rows an assigned job's writes may touch (`ticket_scope`), checked before every `drafting_data__execute` call the job makes. Expandable by the practitioner at any time; the expansion is itself in scope.
_Avoid_: permission (this is a work boundary, not an access-control concept).

**Job Board** (submissions, was: Work Board):
The per-Writing page (`Job Board <id>.html` at the top of the draft folder) rendering this Writing's **Proposals**, its jobs — ready / in progress / waiting / needing a fresh outline / superseded / completed / shelved — and its proceeding's loose threads not yet outlined. Each lane is a **Job list**, the general word, and keeps its own name (Proposed, Ready, Shelved angles, …). A Mockup like any other (never delivered to the filed face), read-only: nothing is written back from it (ADR 0015). It prints marker glyphs only in its Proposed and Shelved angles lists, taken from the render's marker inventory, and holds no marker predicate of its own. A **pre-filing proceeding** has a Job Board of its own, with its jobs and loose threads and no Proposals, lifecycle or mockups (ADR 0018). When the proceeding gets its first Writing, with or without a forum, that board is no longer drawn: each live Writing's board in the proceeding shows the jobs that name no Writing and every loose thread not yet outlined. A folder holding the older `Work Board.html` has it retired at the next write of the Job Board pages, which sit at the top of the draft folder, so no folder holds both. Internal names are unchanged: `document_type` `Work_board`, `render-work-board.ts`, `workboard-*.ts`, and the board's CSS classes, element ids and data keys.
_Avoid_: Work Board (the name before 2026-09-22); document (a Mockup, not a Writing member).

**Litigation Strategy** (submissions, was: To Do List, Matter Board; ADR 0021):
One page for a matter, `Litigation Strategy.html` at the top of its `0. DRAFT` folder, and the first page `/draft` presents. The matter's open **To-dos** lead it, each with its BF date as a plain date and, when it points to a Writing, that Writing's line beneath it. Below them each Writing, and each **pre-filing proceeding** (ADR 0018), is one line: name, lifecycle state, mockup status and jobs in progress. Each Writing's own jobs, steps and Proposals stay on its Job Board. A folder holding the older `Matter Board.html` or `To Do List.html` has it retired once `Litigation Strategy.html` is written there. Internal names are unchanged: `matter_board_path`, `render-matter-board.ts`, `matter-board-shell.ts` and the page's data key.
_Avoid_: To Do List (the name before 2026-10-08; a to-do list is the **To-dos** themselves); Matter Board (the name before 2026-09-22); Job Board (one Writing's page); dashboard.

**To-do** (practice registry; ADR 0021, ADR 0023):
One row of the practitioner's task registry (`/task-prioritization`), client, admin or professional work, larger than a job. A to-do is one outcome the practitioner would cross off. The work toward it is jobs on its Writing's Job Board, never further to-dos. "To-do" is its visible name everywhere. It may carry a BF (bring-forward) date, the date its work should start and never time remaining, and a deadline, which drafting sessions never see. It may point to one Writing or pre-filing proceeding of its own matter, and it holds no jobs. A Writing has at most one open to-do within its matter. A to-do entered in error or merged into another is `withdrawn`: kept, never open and never completed. Internal names are unchanged: the `practice_tasks` table, the `/task-prioritization` skill and the task tools.
_Avoid_: task (internal names only); job (one unit of session work on a Job Board).

**Proposal** (submissions):
One work marker's remaining work, on the database row that work is done on, listed by the render engine in the Job Board's Proposed lane. At the next attended Opening a Proposal no job has ever held becomes a **fast-path job** by intake. The rest stay for the practitioner to pick. It carries no intent or steps of its own. Its label, the marker's work name and the row's item, is fixed text from the record, which the practitioner keeps or changes as the job's title in the outlining session that turns it into a job. A Proposal picked and left unedited becomes a **fast-path job**. It is rebuilt by every render and shown while its marker is the current rung of its ladder and its key is held by no queued or in-progress job and no shelving, and it is never stored. Unlike a **Loose thread** (a person's idea, stored verbatim until outlined), it needs no capture, because marker state regenerates it.
_Avoid_: seed; offer; suggestion; candidate; draft job.

**Shelve** (submissions, was: Reject):
The practitioner's instruction, given in a session, that moves a Proposal, or a queued or in-progress job, to the Job Board's Shelved angles list until the practitioner restores it ("shelved by you"). A shelved Proposal comes back to Proposed if its marker or its item changes from what it read when shelved. A shelved job keeps its place in the work history and is never assigned. Internal names are unchanged: `tickets.rejected_at`, the `proposal_rejections` table, the `rejected` category and lane values, and the `rejected-angles` section id.
_Avoid_: reject, rejection (the words before 2026-09-22); dismissal (the retired no-dismissal rule); drop (a loose thread's removal, or `dropped_on` on substance); supersession.

**Final review** (submissions; work marker 🧐):
The practitioner's own reading of the content in context, whoever wrote it, done holistically and last, one Writing at a time. Until it is done, every statement of law, statement of fact, proposition, postulate, submission, order sought, clause, prose slot and rhetorical paragraph on a Writing for delivery (a Filing, or a Writing that is sent) carries 🧐 on its line once no other work marker on that line does (on a merged Notice of Application fact line, every object's markers count), and the Goal card cannot read ready. An approval is a `review_approvals` row holding a snapshot of the object's stored fields (text, excerpt, pinpoint, never rendered wording); 🧐 fires again whenever the stored fields differ from the latest snapshot, computed at render, never stored. Rendered for the human on every mockup of a Writing for delivery, never on a filed or sent face, never on the Counsel Brief (which is never delivered). A client letter is not a Writing and carries no 🧐: it is kept out of this database as solicitor-client material (ADR 0004), not exempted from review (#1170). Rules: `.claude/skills/drafting-data/references/work-markers.md` row 🧐; storage: `references/review.md`. Internal names: `review_approvals`, `review_points`, criterion id `counsel-review`, `counselReviewMarker`.
_Avoid_: approval (the record, not the act); sign-off; verification (🔬, the research lawyer's act); review to-do (the void job/to-do split).

**Argument** (submissions):
A contention's support: the postulates it rests on and the propositions it requires, each supported in its own domain only — neither link required. Not the application-response **Argument** above (a developed reasoning chain with its authorities and facts), and not the **Written Argument** (the VanIAC Writing member that carries the submissions).
_Avoid_: reasoning chain; Written Argument (the draft, not the support); basis alone (say factual basis / legal basis for the two halves).

**Submission** (submissions):
One contention with its argument. A Written Argument's *Submissions*, or Form 32 Parts 2 and 3 together, is the Writing's selected submissions. A submission may rest on facts only or on law only (a jurisdiction submission).
_Avoid_: argument (the support, not the whole); submissions as the application-response umbrella above (everything advanced at a hearing).

**Rhetorical paragraph** (submissions):
A numbered paragraph of persuasion from the record that fits no other type, for example a characterisation of the other side's pleading. It is the deliberate outlet for what the design did not anticipate. It is never refused: every link is optional (a submission, an opposing point, the record by document, pinpoint and excerpt, facts, law, or none), and it can be placed in any part of any advocacy document. Counsel reviews it (🧐) and the overstatement review reads it. Its mockup line carries the plain-text tags `(rhetorical)`, `(states law, no authority linked)` and `(states fact beyond its record)`. The last two depend on the drafter's own record of whether the wording states law or fact. All three are advisory, never block anything and are stripped from the filed face. Its links are never coverage: it never answers an opposing point (↩️) and never supplies a submission's factual (🧾) or legal (📚) basis. Undeployed, it is held in reserve 🂡, as a submission is. Rules: `.claude/skills/drafting-data/references/terms-and-symbols.md` → Consumers. Internal names: `rhetorical_paragraphs`, `filing_rhetoric`.
_Avoid_: persuasive paragraph (*persuasive* is an authority's weight); submission (a contention with its argument); fact (a postulate the record must prove).

**Statement of fact**:
One witness's account supporting a postulate: the witness, the **Instrument** carrying the witness's words, an optional **Exhibit** it tenders, the verbatim excerpt (the witness's words, or the exhibit's passage where it tenders one), the pinpoint into the instrument, and the exhibit's own pinpoint. Its law-domain twin, **Statement of law**, is one authority's words supporting a proposition, at a pinpoint in the authority. ↩️ 👃 🏷️ attach identically to both; the excerpt and pinpoint markers split by basis: 📜 📍 authority · 📑 📌 exhibit · 💬 🧷 testimony.
_Avoid_: evidence use (schema legacy); excerpt (the words, not the link); testimony (a statement of fact with no exhibit — the witness's own words alone).

**Instrument**:
The executed or served document through which something reaches the forum — two vehicles, both fact-domain. The **witness's instrument** carries a witness's words: an affidavit or a witness statement (`statement.instrument`); execution is the signing or swearing (🖋️ sign it ⊕ ✒️ swear it), and an account with no instrument yet is ✍️ draft it. The **admission instrument** is the document through which an admission is sought from a party — notice to admit, pleading, interrogatories, or the examination transcript (`admissions.instrument`); its work is service (🎾). Kept as the two-word term because no single word covers the four methods (practitioner, 2026-08-23, #327). Fact domain only: published law arrives already executed.
_Avoid_: vehicle (generic, used only in design prose); document (too wide); affidavit, notice (one kind each); request, demand, ask (one-word substitutes considered and rejected 2026-08-23 — no single word covers the four methods).

**Exhibit**:
A document a statement of fact tenders through its instrument, or whose foundation fact an admission covers. **Sponsored** when some statement's or admission's exhibit pointer names it; **unsponsored** when none does — it renders 👤 on its own Evidence Index line (#330).
_Avoid_: attachment; document (too wide); evidence (the whole support side).

**Tender** (adduce):
To **adduce** is to put evidence into the trial record at trial. Two forms: **elicit** — adducing viva voce evidence from a witness; **tender** — entering affidavits or documents into evidence (not only affidavits: some tribunals do not require them). One act, two objects in this plugin: a statement of fact tenders its exhibit; 🕹️ tenders the admission instrument and its response as proof of the admission. Elicited (viva voce) evidence is unmodelled today.
_Avoid_: enter (say tender); file, serve (different acts); adduce for a document alone (the genus — say tender).

**Admission** (submissions):
A party's concession of a postulate, recorded per party and per route — notice to admit, pleading, interrogatory, oral examination — and derived from the notice, its response and the dates, never stored as a flag. **Deemed admission** is the consequence the ladder derives when a response period expires unanswered; which consequence depends on the route — notice to admit: admitted, and silence on one item counts as no response for that item; pleading: a filed Response silent on a postulate means no knowledge, no Response at all means admitted but withdrawable until default judgment is entered. A response dated after the period does not displace a notice-to-admit deemed admission.
_Avoid_: admitted fact (admission binds the admitting party only); source_kind (schema legacy).

**Unless-admitted guard**:
Two branches silence the evidence-side work for a postulate. An admission silences it only as against the admitting party; against every other party the postulate still needs proof. A court-record link (`facts.court_record`) silences it against all parties — the one silence that is not per party. Neither branch silences the capture and locate work on the admission instrument and its response (📑 📌 or 💬 🧷, the pair set by the route), their tender (🕹️), or the court-record link's own pinpoint (📌) — every proof path ends at a pinpoint.
_Avoid_: admitted = proven (true for one party, not the fact).

**Note up**:
Vet an authority's subsequent treatment before relying on it — routine, mandatory before filing, law side only. Marked 📇 until done; the outcome lands in the authority's `treatment` column (⚠️ distinguishable, 🚨 negative treatment, ⛔ not good law, or clean). The act is the *check*; the column keeps the name `treatment` because `check` is an SQLite reserved word (#327, 2026-08-23). Distinct from **Doubt**. All of that is for a case: a statute, regulation or rule is noted up by its currency check alone, its outcome its currency result, and doctrine is never noted up (`.claude/skills/shared/statute-currency.md` → Noting up legislation).
_Avoid_: suspicious, dubious (those are Doubt); treatment (the outcome, not the act); check (as a column name); verify (that is whether a lead has been confirmed in hand).

**Doubt**:
A reason to distrust one statement — seated on the statement, never the postulate or proposition. One marker 👃, named per domain: *suspicious* (doubtful facts) on a statement of fact, *dubious* (doubtful legal basis) on a statement of law. Modes: withdrawn, wrong at the source, outweighed, misread, misattributed, out of time.
_Avoid_: posture (the retired column name); not noted up (that is **Note up**, workflow not doubt).

**Slice** (retired, issue 300, 2026-08-19):
Was: the disjoint partition of a Writing's work that one worker agent owned and wrote under compare-and-swap. Struck with parallel worker agents for v1; one agent per Writing writes directly. The term is not used in current design.
_Avoid_: slice; lane; lease; envelope.

**Reserve** (submissions; was: Disposition, renamed 2026-08-22):
Whether a postulate, statement, authority, argument or order sought is held back — stored and drafted, rendered only in the Mockup's trailing "Held in reserve" section, marked 🂡, never in the filed face — or deployed into the body. How held-in-reserve material lives in the same database as delivered material. A reserved row is still work (deploy-or-abandon is deferred, not absent).
_Avoid_: disposition (has its own legal meaning — the disposal of a proceeding); inclusion (the responding-to-applications term, with a three-way value); privileged flag.

**Revision stamp**:
The global monotonic database revision plus a human-readable timestamp printed on every Mockup (the Job Board carries it in its data line and does not draw it); a Mockup is stale exactly when its stamp differs from the current revision. Never a file mtime.

<!-- Goal card, derived work, unattended run and /prepare (2026-09-21 design, designed and not yet built) -->

**Completion criteria** (submissions):
The one card at the top of a Writing's Job Board: headed `Completion Criteria`, with the Writing kind's criteria beneath it. It is complete only when every criterion reads met at once. Derived at every render, never stored, and it makes no readiness claim of its own.
_Avoid_: Goal; Goal card; objective; milestone; "ready to file" (the card never says it while a gate step is open).

**Criterion** (submissions):
One fixed condition on a Writing's completion-criteria card, read as met, unmet or pending at render time from the render's marker inventory or from job rows. Stock per Writing kind, never authored per Writing and never stored. A met criterion can flip back. Pending never counts as met.
_Avoid_: checkbox (nothing ticks it); requirement; the pre-filing checks (the gate's C1 to C6 read package files and are never subsumed).

**Drafting criteria** (submissions):
Every criterion of a Writing kind except the Gate criterion.
_Avoid_: all criteria.

**Filing-ready declaration** (submissions):
The state in which every drafting criterion reads met. It triggers the noting-up sweep, the evidence-concerns pass and court-ready assembly at the next session's Opening, announced in one line. It is withdrawn when any drafting criterion flips back, and it recurs. The approval to file remains the practitioner's act.
_Avoid_: approval to file; ready to file; sign-off.

**Current package** (submissions):
A package for which at least one gate step records a pre-filing check run at the database's current revision. The only sense in which the render knows a package exists.
_Avoid_: package built; assembled (no record of either exists).

**Fast-path job** (submissions, was: Fast-path ticket):
A one-step job written from a Proposal the Opening's intake took, or the practitioner picked and left unedited. Its title, intent and single step are the Proposal's own fixed text, `<work name>: <item>`. One fast-path job per picked Proposal; the fast path never merges. A Proposal whose label the practitioner changes, or several the practitioner names as one piece of work, are outlined through the ordinary interview in the practitioner's words, and that merged job holds every key. The intake, or the pick, is its approval.
_Avoid_: fast-path ticket (the name before 2026-09-22); derived job; auto-job; stored Proposal (nothing is written before the intake or the pick).

**Dead key** (submissions):
A `ticket_proposals` key whose Proposal no longer derives from the render's inventory, meaning the marker no longer fires on that row.
_Avoid_: stale job (the job may hold other live keys); moved item (a reworded item is reported separately).

**Close as superseded** (submissions):
The practitioner's bookkeeping instruction that supersedes a queued job all of whose keys are dead, or a fast-path job whose item changed. Never the session's initiative. No restore path: if the marker fires again, the Proposal returns.
_Avoid_: shelve (an angle not pursued); complete (no work was done); auto-close.

**Unattended run** (submissions):
A `/draft` session the practitioner launches on one named Writing with nobody present. It takes at most one job, chosen by the server's eligibility predicate in queue order. It stops and reports wherever a session would pause for a human. It never outlines, takes over or creates a job.
_Avoid_: scheduled run; background worker; AFK (wayfinder's word); `/prepare` (not the worker).

**Eligible** (submissions, unattended sense):
A Ready fast-path job, on a Writing not yet filed, whose every key still derives, whose marker instances are all on the design's named list, and which has no either/or partner. Derived per render and shown as the Ready card subtitle "can be picked up with nobody present".
_Avoid_: one-step (necessary, not sufficient); ripe (every Ready job is ripe).

**Bundle** (submissions, `/prepare` sense):
An application as a whole: the lead Writing, its supporting documents, and the surrounding work of the availability letter, filing and service, and the application book. No stored record. Every bundle-level job is scoped to the lead Writing, whose Job Board and completion-criteria card are the tracker. Not the ingest **Bundle**.
_Avoid_: package (the assembled files the gate reads); application book (one product within it).

**Stock bundle job** (submissions, was: Stock bundle ticket):
A fixed-text job `/prepare` offers for a Writing kind (availability letter, file and serve, application book), which the practitioner picks or declines at the closing read-back.
_Avoid_: stock bundle ticket (the name before 2026-09-22); template job; default job (nothing is written unpicked).

**Stage** (of `/prepare`):
One of the outlining sessions in which `/prepare` is re-run: opening the bundle, after the gate job completes, and after responses arrive.
_Avoid_: phase; step (a job's unit).

### Writing lifecycle and retirement (submission drafting, 2026-09-08 design)

How a Writing moves from drafting to done, and what happens to its research when it does. Decided in [ADR-0011](docs/adr/0011-retirement-is-the-one-designed-flow-back-to-case-data.md).

**Lifecycle state** (of a Writing):
Derived, never stored: drafting → filed → heard → decided → appeal expired → retired, read off `filed_on`, the hearing date, `decided_on`, the appeal deadline the `docket-clerk` agent reports, and `retired_on`. A reply is a sibling Writing, not a state of the Writing it answers. The Job Board prints the derived state as its `State` row.
_Avoid_: status (an enum stored beside the dates — the thing this design refuses); archived (the renderer's word for revision-archive copies of a mockup).

**Retire** (a Writing):
The practitioner's explicit act that ends a Writing: sets `retired_on` and a reason (appeal expired, appeal exhausted, settled, abandoned, adjourned generally, other), supersedes the Writing's open queued jobs, hands the Writing's research — law assertions, statements of law, authorities, the opposing authorities it answered, and any oral-decision treatment notes — to case-data through `ingest-submission-law`, and in the next turn initiates the consolidation push. Every retirement pushes; a court decision is never a precondition. A retired Writing is listed by bootstrap and never rendered again.
_Avoid_: archive (taken); close, finalize (both already name other steps); delete (nothing is removed).

**Recovery** (of a retired Writing):
Clearing `retired_on` and its reason so a retired Writing drafts again. Offered before an empty sibling Writing of the same proceeding, kind, round and subkind is created. Superseded jobs stay superseded; recovery never re-initiates a push; the practitioner may, and only the practitioner may, flip the retirement's non-billable time to billable.
_Avoid_: restore, reopen, un-retire.

**Oral reasons** (as an authority):
A decision pronounced orally with no transcript, recorded in case-data as an authority of type `oral_reasons` whose citation names court, file number, judge and date — never a style of cause — and pooled as treatment notes only: which cited authorities the court followed, distinguished, declined to follow, or did not consider, from the practitioner's own account. No text, excerpt, or note crosses. A later transcript upgrades the same authority.
_Avoid_: unreported decision (a reported-elsewhere question, not a transcript question); judgment (implies written reasons).

**Non-billable entry** (practice time):
A time entry recorded against a matter with `billable` false: kept on the file, excluded from WIP and accounts receivable, never billed. The consolidation push records one per retirement run, tagged `retire:<filing_id>:<retired_on>`. Matter-less administrative time is not the same thing and is still never committed.
_Avoid_: firm time, admin time (both mean no matter); write-off (a billed entry later forgiven, a different act).

### Answer grades (2026-09-02 design)

How a proposed answer is labelled by what it rests on. Full definitions, tests, and the reporting rule: the probanda repo's `.claude/skills/shared/answer-grades.md`. The grade describes evidence, never confidence, workflow status, or permission to act.

**Hunch**:
A first impression drawn only from what the model already knew before the session began — nothing in the session (no file, tool result, or line of conversation) was consulted.
_Avoid_: guess, gut feeling, "I think" with no label; hunch for an answer formed after reading the files (that is a **Recommendation**).

**Recommendation**:
An answer formed from information already within reach — the repository, the matter's files, tool results, the conversation — without sending a separate agent off to research the point.
_Avoid_: hunch (understates it); advice (overstates it — no independent research yet).

**Advice** (answer grade):
A recommendation that has been checked against everything within reach and is backed by targeted research from a separately-spawned agent working independently. Not the same word as legal advice to a client (apply-to-facts, case-data), which keeps its ordinary meaning.
_Avoid_: advice for an answer a second agent merely agreed with — agreement without new evidence leaves it a recommendation.

### Legal research and writing (/draft design, formerly `/lrw`, 2026-09-16)

**Legal research and writing**:
A lawyer's professional work that establishes what the law is or produces writing for the practice: research, verification and briefing of authorities, court and tribunal filings, affidavits, and correspondence. Time-entry narratives and billing preparation are practice administration, not legal research and writing.
_Avoid_: legal work (the live-issue test's narrower term, limited to judgment about the content of law); LRW as a standalone word in prose (it no longer names anything).

**Form-bound writing**:
Legal writing for which the venue publishes the form document itself, with fixed fields and wording: a BCSC Form 32, a Small Claims Form 2, the BCCA respondent's factum. A venue that prescribes only structure (parts, headings, numbering, caption, page limit, required statements) does not make a writing form-bound. Drafting it takes a specialist skill for that form; when none exists, the gap is reported, and the writing is drafted as an Unstructured Writing, its fixed wording copied from a saved copy of the published form.
_Avoid_: court form (names the filed artifact, not the kind of writing); template (also means a firm precedent); bespoke (the rendering path, not the kind of writing, #951 item 6).

**Free-form writing**:
Legal writing for which no venue publishes the form document, even where it prescribes the structure: demand letters, letters to opposing counsel, client reporting letters, memos to file, a VanIAC written argument laid out to VanIAC's rules.
_Avoid_: informal (the tone is often formal); correspondence (narrower; a memo to file is free-form but addressed to no one).
