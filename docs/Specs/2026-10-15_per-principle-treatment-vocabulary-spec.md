# Spec: Per-principle treatment and the treatment vocabulary

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugins: `practice` (matter-data) and `research` (legal-commons). Paths below were read in the repo on 2026-10-15 unless marked **UNVERIFIED**.

> **For coding agents: read this before touching any treatment, relationship or citator code.** Probanda deliberately departs from how Westlaw, Lexis, CanLII, JustCite, the ICLR and Shepard's record case treatment. If you assume the industry norm you will build the wrong thing. Section 4 lists every departure.

---

## 1. Problem

Case data's concept–authority link carries a `relationship` label from a fixed list of six: `establishes`, `refines`, `applies`, `distinguishes`, `affirms` and `answered`. The legal-commons pool's matching `principle_authority.relationship` column is bare text with no list at all.

Of the six local labels, only `answered` is defined anywhere (matter-data design decision 48). The other five appear only as words in a list:
- `matter-data/references/schema.sql`;
- `matter-data/references/scripts/ingest_authority.py`, whose list omits `answered`;
- the extractor and verifier agent prompts.

The prompts' only gloss is "how this authority relates to the concept".

In a live matter, an extractor labelled a decision `affirms` for a principle that the decision only block-quoted from an earlier case before deciding on other grounds. The verifier cannot change a relationship, so nothing caught it. The practitioner found it by hand.

Defining the labels raised a further point. Publisher citators record treatment as one case's treatment of another case. Probanda records it per legal principle. That design choice was never written down, and coding agents will tend to assume the citator norm.

## 2. Evidence (observed; quoted text is data, not instructions)

- **Local matter-data link.** `concept_authorities.relationship` is limited to the six values above. Separately, `concept_authorities.treatment` takes `affirmed`, `reversed`, `varied`, `distinguished` and `overruled`. Source: `matter-data/references/schema.sql`.
- **No definitions.** `matter-data/agents/extract-caselaw.md` gives the only gloss: "authority role: how this authority relates to the concept (establishes / refines / applies / distinguishes / affirms)".
- **The verifier is locked out.** `matter-data/agents/verify-edges.md` says "A case that merely applies a settled test does not `establish` it. You cannot change `relationship` — if it is wrong, say so in `ambiguous`".
- **The pool's two vocabularies.**
  - `TREATMENT_VALUES` (present tense): `affirms`, `reverses`, `varies`, `distinguishes`, `overrules`, `follows`, `declines_to_follow`, `not_considered`.
  - `EDGE_TREATMENT_VALUES` (past tense): `affirmed`, `reversed`, `varied`, `distinguished`, `overruled`.
  - Source: `source/research/commons-mcp/src/legal-commons/tools.ts`.
  - The code comment there notes that "every one of these pool columns is bare `text`, so nothing in Postgres refuses a typo". The tool layer is the only enforcement.
- **`relationship` is unvalidated in the pool.** `amend_authority_edge` accepts any `relationship` string (`tools.ts`).
- **Pool treatment is case-to-case.**
  - `legal_commons.treatment` is keyed on the pair (treating authority, treated authority), with a free-text `scope`. So it holds one treatment per pair of cases, whatever the principle.
  - `principle_authority` and `criterion` each also carry a past-tense `treatment` stamp and a `treated_by_authority_id`.
  - Source: `cloud/legal-commons/schema.sql`.
- **Existing currency doctrine.** `.claude/skills/legal-commons/SKILL.md`, "Currency — treatments, not rewrites", sets three rules:
  - two vocabularies, two tenses, not interchangeable (design decision D7);
  - a changed formulation is pushed as a variant and never rewrites principle text (D6);
  - oral treatment notes pass no `edge_treatment` (D4/D7).
- **Comparative research, 2026-10-15.** Four research passes covered Canada, the UK, Australia and the USA. See section 8.
  - **Consistent with standard usage everywhere:** the practitioner's `applies`, `distinguishes` and "mentions".
  - **Collides with a standard term:** "considers", where the practitioner had meant fact comparison, and `affirms`, which is appellate history in every citator.
  - **Over-broad:** "overturns" merges overruled, reversed and superseded by statute.
  - **In no citator:** `establishes`, `extends` and the reformulating senses.

## 3. Goal and non-goals

**Goals:**
- One defined treatment vocabulary for principle–authority links, used identically by case data, the pool, the extractors, the verifiers and any citator import.
- Standard common-law terms wherever one exists, plus a small number of added terms only where no standard term exists.
- Treatment recorded per principle, with that design and every other departure from citator norms documented where coding agents will find it.

**Non-goals:**
- Choosing which matter rows get which label.
- A depth-of-discussion axis (KeyCite's examined, discussed, cited, mentioned).
- Recording treatment in a dissent separately.

These two axes are noted in section 7 and not adopted.

## 4. Departures from the citator norm (read this first)

1. **Treatment is per principle, not per case.**
   - Westlaw, Lexis, CanLII, JustCite, CaseBase and the ICLR label how one *case* treats another *case*. A KeyCite red flag means the case is bad "for at least one point of law", and the reader must work out which.
   - Shepard's goes partway by attaching signals to LexisNexis headnotes. But a headnote is the publisher's summary of one point in one case, not a principle shared across cases.
   - Probanda attaches treatment to the link between an authority and a principle (pool `principle_authority`; local `concept_authorities`). One principle is linked to every authority that states, follows, limits or questions it. So the system can answer "who established, extended, limited, or merely considered *this principle*". A citator can only answer "what has happened to *this case*".
   - One case can follow a principle from a precedent and distinguish another principle from the same precedent. Both are recorded, and neither overwrites the other.
2. **Some labels relate an authority to a principle, not to an earlier authority.**
   - `establishes`, `extends` and `reformulates` describe what an authority does to the law itself. No citator records this, because a citator has no principle node to attach it to.
   - These labels are valid only on a principle–authority link, never on an authority–authority treatment edge.
3. **`affirms` means appellate history only.**
   - It means a higher court upheld the decision in the same proceeding.
   - It never means "endorses a principle": use `approves` or `follows`.
   - Existing local rows labelled `affirms` were written before this definition and must be reviewed, not mapped (section 6).
4. **There is no "overturns".**
   - A later case in different proceedings holding the earlier ratio wrong is `overrules`.
   - The same case set aside on appeal is `reverses`.
   - Legislation displacing the rule is `superseded_by_statute`.
   - Never merge them.
5. **`considers` has an unresolved meaning.** See section 7, Q1. Until it is resolved, do not write `considers` from any automated path.
6. **Two tenses, two jobs (existing D7, unchanged).**
   - Present tense is what the treating decision *does*: the `relationship` and treatment-edge values.
   - Past tense is the status stamp on an edge whose authority has *been* treated (`edge_treatment`).
   - Never use one vocabulary in the other's column.
7. **Currency never rewrites principle text (existing D6, unchanged).** A narrowed or superseding statement of a principle is pushed as a variant, and the displaced authority gets a treatment edge.
8. **`answered` is not a treatment.**
   - It records that the other side cited this authority against this concept and our filing answered it.
   - It is written only on a practitioner tie, verified by that tie, and never pushed to the pool (matter-data design decision 48).
   - It stays outside the vocabulary below.
9. **`not_considered` is not the opposite of `considers`.**
   - It is the existing oral-reasons note: the court did not consider an authority it was referred to.
   - It is recorded from the practitioner's own account and carries no `edge_treatment`.
10. **The vocabulary is a rulebook.**
    - Under COMMANDMENTS.md 4 and 5, local storage does not encode the rulebook, and Exception 2 forbids any revision that deepens the legacy stores' reliance on that exception.
    - Widening the local `concept_authorities.relationship` CHECK and hard-coding definitions into shipped prompts would deepen it.
    - The implementer must confirm where the definitions live before writing code (section 7, Q4).

## 5. The vocabulary

> The source of these terms and definitions is now `.claude/skills/shared/treatment-vocabulary.md` (ADR 0006), as amended by the decisions in section 7. This section records the proposal.

Every term is written as what the citing authority does (present tense), matching the pool's existing `TREATMENT_VALUES` convention. The stored code value is in backticks. The jurisdictions using each standard term are in brackets: CA, UK, AU, US. Definitions give the common core where publishers differ.

### 5.1 Standard terms

**Favourable or neutral**

- **follows** (`follows`) [CA, UK, AU, US]: treats the cited authority's statement of the principle as binding, or adopts it as persuasive, and decides the same point the same way, usually on the same or substantially similar facts. In Canadian and US citators "followed" also covers "applied".
- **applies** (`applies`) [UK, AU]: applies the principle to a materially different set of facts.
- **approves** (`approves`) [UK, AU]: a higher court endorses a lower court's statement of the principle as correctly stating the law.
- **explains** (`explains`) [CA, UK, AU, US]: interprets the cited statement of the principle and states what it means or why it was decided as it was, without changing it.
- **harmonizes** (`harmonizes`) [US]: reconciles an apparent inconsistency between the cited statement and another authority.
- **considers** (`considers`) [CA, UK, AU]: *standard sense, pending Q1.* Discusses the principle without following, applying, distinguishing or criticizing it.
- **refers to** (`refers_to`) [CA, UK, AU, US]: names the authority with little or no discussion. Publishers also call this "cited" or "mentioned".

**Restrictive**

- **distinguishes** (`distinguishes`) [CA, UK, AU, US]: holds the principle inapplicable because of a material difference in fact or law. The cited authority remains good law.
- **limits** (`limits`) [US]: confines the principle to specific circumstances, restricting its reach without rejecting it.
- **declines to extend** (`declines_to_extend`) [US]: refuses to carry the principle beyond the situations it addressed.

**Adverse**

- **does not follow** (`declines_to_follow`, the existing pool code value, kept to avoid a migration) [CA, UK, AU]: a court not bound by the cited authority declines to follow it on the principle, for a reason other than distinguishing it.
- **does not apply** (`declines_to_apply`) [UK]: chooses not to apply a persuasive authority or dictum on the principle.
- **questions** (`questions`) [CA, UK, AU, US]: doubts the correctness of the cited statement of the principle without deciding that it is wrong. Publishers also call this "doubted" or "called into doubt".
- **disapproves** (`disapproves`) [UK, AU, US]: says the cited statement is wrong without overruling it. US publishers call this "criticized".
- **overrules** (`overrules`) [CA, UK, AU, US]: a court with power to do so holds, in different and later proceedings, that the cited authority's ratio on the principle is wrong.
- **departs from** (`departs_from`) [UK, CA]: a final court declines to follow its own earlier decision on the principle.
- **abrogates** (`abrogates`) [US]: makes the cited authority untenable on the principle without expressly overruling it. "Impliedly overruled" is the Commonwealth equivalent. US usage is not uniform, because some sources use "abrogated" for statutory displacement, so importers map by meaning, not by word.

**Appellate history of the same case** (authority–authority edges; principle-scoped where only part of a decision is affected)

- **affirms** (`affirms`) [all]: a higher court upholds the decision in the same proceeding.
- **varies** (`varies`) [CA, AU]: a higher court changes the decision in the same proceeding in part.
- **reverses** (`reverses`) [all]: a higher court sets aside the decision in the same proceeding.

**Statutory displacement**

- **superseded by statute** (`superseded_by_statute`) [UK, US]: later legislation, enacted or repealed, displaces the rule the authority stated. It is passive because a statute, not a case, does it, and it is recorded against the principle link and the authority.

### 5.2 Added terms, where no standard term exists

These relate an authority to the principle itself (section 4, item 2).

- **establishes** (`establishes`): creates or recognizes the principle. Citators call such a case the "primary" or "leading" case, which is a noun and not a treatment. The practitioner chose the verb.
- **extends** (`extends`): broadens an existing principle to new circumstances, for example carrying an old common-law rule into a modern context.
  - Courts say this in judgments, and "declined to extend" is a standard US term.
  - But no case-law citator labels the positive form; Shepard's "extended by" is for statutes only.
- **reformulates** (`reformulates`): restates an existing principle, or fuses several authorities on it, into a changed statement of the law. It covers both narrowing-and-broadening restatements and consolidations of several authorities.
  - Chosen over "restates", which is commonly used for a court merely repeating a test unchanged.
  - Distinct from **explains**, which interprets without changing.
  - Whether it absorbs consolidation is Q2.
- **fact-comparison term** (name pending Q1): the authority is cited for its facts or outcome as a comparator, not for its principle. Examples are a damages range in a quantum assessment, or a judge listing similar-fact cases without discussing them. No citator records the purpose of a citation. JustCite's "relied upon" was rejected because it implies support.

### 5.3 Importing from a citator

Map by meaning:

| Publisher term | Probanda value |
|---|---|
| Followed / Followed by (all) | `follows`; Canadian and US "followed" may mean `applies`, so check the use |
| Applied (UK, AU) | `applies` |
| Approved | `approves` |
| Explained / Explained by | `explains` |
| Harmonized by (Shepard's) | `harmonizes` |
| Considered (CA, UK, AU) | `considers` in the standard sense, subject to Q1 |
| Referred to / Cited / Mentioned | `refers_to` |
| Distinguished | `distinguishes` |
| Limited by (Shepard's); Limitation of Holding Recognized (KeyCite) | `limits` |
| Declined to Extend (KeyCite) | `declines_to_extend` |
| Not followed | `declines_to_follow` |
| Not applied (UK) | `declines_to_apply` |
| Questioned; Doubted; Called into Doubt | `questions` |
| Disapproved; Criticized | `disapproves` |
| Overruled | `overrules` |
| Departed from | `departs_from` |
| Abrogated (judicial) | `abrogates` |
| Superseded (by statute) | `superseded_by_statute` |
| Affirmed / Varied / Reversed | `affirms` / `varies` / `reverses` (history) |

A publisher's case-level treatment says nothing about *which* principle it concerns. An import must attach it to the specific principle link, using the headnote where the publisher gives one. Where the principle cannot be identified, the import records an authority–authority edge with no principle scope and flags it for review. It never copies the label onto every principle link of the cited case.

## 6. Design

1. **One vocabulary, one source of definitions.**
   - Section 5's terms and definitions are held in one place, which every writer and reader cites.
   - The writers and readers are: matter-data's extractors and verifiers, the pool's push and amend tools, the `record_treatment` tool, and any citator import.
   - The verifier prompt gains the definitions and may *flag* a mismatch. Whether it may also *correct* a relationship is out of scope here.
2. **Principle–authority links** (`concept_authorities.relationship` locally; `principle_authority.relationship` in the pool) take any section 5 value except `affirms`, `varies` and `reverses`, which are history of a whole decision.
3. **Authority–authority treatment edges** (`legal_commons.treatment`) take the section 5.1 values. They gain a principle scope so that one pair of cases can carry different treatments on different principles (Q3). An edge with no principle scope means the whole decision.
4. **Past-tense status stamps** (`edge_treatment`) are extended only for treatments that change what the linked principles now stand on: `overruled`, `reversed`, `varied`, `affirmed`, `distinguished`, plus `superseded_by_statute`, `abrogated`, `questioned` and `disapproved`. Which of these stamps an edge is Q5.
5. **Existing rows are not auto-mapped.**
   - Every local `relationship` written before this spec was written against undefined labels, so each is flagged for practitioner review.
   - Each keeps its `verified` value or lowers it, never raises it.
   - Old `affirms` rows have no valid principle-link meaning (section 4, item 3), and old `refines` rows have no direct successor.
   - `answered` rows are untouched.
6. **Discoverability for future agents.** The implementation adds:
   - (a) a GLOSSARY.md entry **Treatment** that states the per-principle rule and lists, under *Avoid*, "overturns", `affirms` for endorsement, and treating `considers` and `not_considered` as opposites;
   - (b) a pointer to this spec in `.claude/skills/legal-commons/SKILL.md` § Currency and in matter-data's legal-knowledge reference;
   - (c) a comment at `TREATMENT_VALUES` in `tools.ts` and at the matter-data relationship list naming this spec.

## 7. Open questions

- **Q1. What does `considers` mean?**
  - The practitioner first agreed to the standard sense (discussed without following, applying, distinguishing or criticizing).
  - The practitioner later preferred `considers` for fact comparison: it is neutral, and judges often list similar-fact authorities without discussing them.
  - One word cannot carry both senses without breaking the match with citators.
  - The options are: (a) the standard sense, plus a new word for fact comparison; or (b) fact comparison, with standard "considered" cases recorded as `refers_to` or `explains`.
  - **The practitioner decides.**
  - **Decided 2026-10-15: (b), fact comparison. See `docs/ADRs/0004-considers-means-fact-comparison.md`.**
- **Q2. Does `reformulates` absorb consolidation of several authorities** (the practitioner's earlier "restates")? This was recommended, not yet confirmed.
  - **Decided 2026-10-15: yes. See `docs/ADRs/0005-reformulates-absorbs-consolidation.md`.**
- **Q3. How is principle scope added to the authority–authority treatment edge?** The two candidates are: widen its key to include the principle, with no principle meaning the whole decision; or derive case-to-case treatment from the principle links. This needs a decision record before any migration.
  - **Decided 2026-10-15: per-principle treatment lives on the principle link. See `docs/ADRs/0007-per-principle-treatment-on-the-principle-link.md`.**
- **Q4. Where do the vocabulary and its definitions live?**
  - Commandments 4 and 5 and Exception 2 bear on this. The candidates are: in Probanda's Cloud, with local stores holding the value as Cross Data; or in shipped prompts and a local CHECK, which deepens the legacy exception.
  - Resolve this before code.
  - **Decided 2026-10-15: one shipped file as Cross Data under Exception 1. The local store keeps a subset until matter-data is converted. See `docs/ADRs/0006-treatment-vocabulary-in-one-shipped-file.md`.**
- **Q5. Which treatments stamp `edge_treatment`?** That is, which ones change what a principle link now stands on (section 6, item 4).
  - **Decided 2026-10-15: the five existing stamps plus `superseded_by_statute` and `abrogated`. See `docs/ADRs/0008-edge-treatment-stamps.md`.**
- **Q6. Not adopted, noted for completeness:**
  - a depth axis (KeyCite's examined, discussed, cited, mentioned);
  - treatment in a dissent or minority opinion, which Canadian and US citators track;
  - Bluebook-style procedural history beyond affirms, varies and reverses (vacated, remanded, leave granted or refused).

## 8. Research basis (2026-10-15)

Publisher definitions were read from:
- [ICLR – Judicial consideration: a reporter's guide](https://iclr.co.uk/knowledge/guides/judicial-consideration-a-reporters-guide-to-good-law)
- [JustCite terminology](https://new.justcite.com/kb/editorial-policies/justcite-terminology)
- [vLex treatment types](https://support.vlex.com/document-types/case-law/treatment-types)
- [Strathclyde – checking case status](https://guides.lib.strath.ac.uk/case-law/checking-status)
- [KeyCite Canada treatment definitions](https://www.thomsonreuters.com/en-ca/help/westlaw-edge/tools/keycite/keycite-treatment-definitions-for-cases)
- [KeyCite Canada flags](https://www.westlawcanada.com/dynamicdata/attacheddocs/lawsource/hidden/keycitecanadaflags.pdf)
- [Lexis+ Canada QuickCITE treatments](https://help.lexisnexis.com/Flare/lexispluscanada/CA/en_CA/Content/reference/quickcitetreatments_ref.htm)
- [CaseBase signals (Lexis+ AU)](https://help.lexisnexis.com/Flare/lexisplus/AU/en_AU/Content/reference/casebasesignal_ref.htm)
- [Westlaw AU case status symbols](https://support.thomsonreuters.com.au/sites/default/files/2017-09/AU-WLAU-Guide-Case-Status-Symbols.pdf)
- [Shepard's signals and analysis phrases](https://www.lexisnexis.com/pdf/lexis-advance/Shepards-Signal-Indicators-and-analysis-phrases-Final.pdf)
- [Shepard's signals on headnotes](https://www.lexisnexis.com/community/infopro/b/lnpu/posts/validate-points-of-law-faster-with-shepard-s-signal-indicators-on-lexisnexis-174-headnotes)
- [KeyCite depth of treatment](https://support.thomsonreuters.co.nz/node/23376)
- [UF Law – KeyCite guide](https://guides.law.ufl.edu/legalresearch/westlawcitator)

The nearest prior work on tying citations to principles rather than cases is Shulayeva, Siddharthan and Wyner, ["Recognizing cited facts and principles in legal judgements"](https://link.springer.com/article/10.1007/s10506-017-9197-6) (2017) 25 AI & Law 107. It classifies sentences near citations as cited facts or cited principles and expressly does not classify treatment.

Not retrieved:
- the Westlaw UK and Lexis+ UK own glossaries;
- the Canadian Abridgment scope notes;
- Bluebook T8;
- AGLC4;
- newer AI research products.

## 9. Implementation criteria

- [ ] Every value any treatment or relationship column accepts has exactly one definition, from section 5, and every writer and reader points to it.
  - Met for every writer and reader, and for the pool. Open for the local store: its CHECK still accepts the undefined `refines` and `affirms`, which no path now writes, until matter-data is converted (ADR 0006).
- [x] No code path accepts "overturns", or writes `affirms`, `varies` or `reverses` on a principle–authority link.
- [x] No automated path writes `considers` until Q1 is recorded as decided. (Q1 decided: ADR 0004.)
- [ ] matter-data's relationship list, `ingest_authority.py`, the agent prompts and the pool tool layer list the same values.
  - Open: the local store holds only `establishes`, `applies` and `distinguishes` until matter-data is converted. Other values are held back and reported (ADR 0006).
- [ ] Existing relationship rows are flagged for review, none is remapped, and no `verified` value rises.
  - None is remapped and no `verified` value rises. Bulk flagging waits for matter-data's conversion, because it needs a data hop in `migrations.sql` (ADR 0006). Until then, verify-edges flags `refines` and `affirms` edges as `wrong_relationship` when it verifies them.
- [x] `answered` behaves exactly as matter-data design decision 48 says.
- [x] Q3, Q4 and Q5 each have a recorded decision before any schema change.
- [x] GLOSSARY.md, the legal-commons skill and both code sites point to this spec (section 6, item 6).
