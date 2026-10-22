---
terms:
  - Admission
  - Advice (answer grade)
  - Affiliation
  - Alias
  - Apparatus
  - Argument
  - Asserted Cause of Action
  - Assign
  - Attachment
  - Authority
  - Bare Row
  - Basis
  - Bundle (application)
  - Bundle (ingest)
  - Cause of Action Concept
  - Clause
  - Client account
  - Close as superseded
  - Completion criteria
  - Component
  - Consequence
  - Consolidation part
  - Contact
  - Contention
  - Copy (within a bundle)
  - Counsel of record
  - Court Rule
  - Criterion
  - Current package
  - Dead key
  - Defence
  - Dismissed
  - Doctrine
  - Document
  - Done-test
  - Doubt
  - Draft
  - Drafting criteria
  - Element
  - Eligible
  - Evidence
  - Exception
  - Exhibit
  - Fact
  - Fact Posture
  - Factor
  - Fast-path job
  - Filing
  - Filing-ready declaration
  - Final review
  - Form-bound writing
  - Free-form writing
  - General Job
  - Hunch
  - Instrument
  - Issue
  - Job
  - Job Board
  - Lawyer account
  - Leading document
  - Legal Citation
  - Legal Concept
  - Legal research and writing
  - Letter
  - Lifecycle state
  - Limit
  - Litigation Strategy
  - Loose thread
  - Matter
  - Matter number
  - Matter reference
  - Matter role
  - Matter row key
  - Merge (Job Boards)
  - Merge (jobs)
  - Mockup
  - Non-billable entry
  - Note up
  - Obiter dictum
  - Oral reasons
  - Outlining
  - Pain point
  - Participant
  - Position
  - Postulate
  - Pre-filing proceeding
  - Preference
  - Preview
  - Principle
  - Privileged Source
  - Proceeding
  - Projection
  - Proof
  - Proposal
  - Proposition
  - Provenance
  - Publisher map
  - Qualified admission
  - Ratio decidendi
  - Rationale
  - Recommendation
  - Record
  - Recovery
  - Redirect
  - Reliance on a rule
  - Representative
  - Reserve
  - Retire
  - Revision stamp
  - Rhetorical paragraph
  - Ripe
  - Rule
  - Rule Library
  - Rule Set
  - Scope
  - Severance
  - Shelve
  - Source
  - Source Citation
  - Split (Job Boards)
  - Stage
  - Standalone Job Board
  - Statement of fact
  - Step
  - Stock bundle job
  - Structured Writing
  - Submission
  - Suggestion
  - Tender (adduce)
  - Test
  - Theorized Fact
  - To-do
  - Treatment
  - Tribunal member
  - Unattended run
  - Unless-admitted guard
  - Unstructured Writing
  - Up-pointer
  - Variant
  - Venue
  - Venue source record
  - Verified
  - Work marker
  - Writing
  - Writing Job
  - Written Argument
---

# Probanda glossary

Schema anchors for the matter-data terms: `.claude/skills/matter-data/references/terminology-crosswalk.md`.

**Admission**:
A party's concession of a postulate, recorded per party and per route — notice to admit, pleading, interrogatory, oral examination — and derived from the notice, its response and the dates, never stored as a flag. **Deemed admission** is the consequence the ladder derives when a response period expires unanswered; which consequence depends on the route — notice to admit: admitted, and silence on one item counts as no response for that item; pleading: a filed Response silent on a postulate means no knowledge, no Response at all means admitted but withdrawable until default judgment is entered. A response dated after the period does not displace a notice-to-admit deemed admission.
_Avoid_: admitted fact (admission binds the admitting party only); source_kind (schema legacy).

**Advice (answer grade)**:
A recommendation that has been checked against everything within reach and is backed by targeted research from a separately-spawned agent working independently. Not the same word as legal advice to a client (apply-to-facts, matter-data), which keeps its ordinary meaning.
_Avoid_: advice for an answer a second agent merely agreed with — agreement without new evidence leaves it a recommendation.

**Affiliation**:
A dated tie between a person **Contact** and an organization contact, such as employment or a directorship. A lawyer who changes firms stays one contact with two affiliations. Stored as a practice-data `affiliation` item (`docs/ADRs/0009-firm-wide-contacts-in-practice-data.md`).
_Avoid_: firm or employer as a field on the person (it goes stale when the person moves).

**Alias**:
Another recorded spelling of a participant's name, or a **file code**: the author/recipient token the firm's file names use for that participant (`SmithJ`). An alias is recorded only with the practitioner's approval. A name that merely resembles a participant's is a **near match**: a lead to search, never presented as the participant until the practitioner confirms it.

**Apparatus**:
Pages in a bundle that are not documents: cover page, index or table of contents, exhibit stamp sheet, envelope, fax cover, a one-page table of authorities. Reported for the page map, never extracted, never given a row.
_Avoid_: ignore (the walker's verb, not the noun); boilerplate (that is text inside a document, not pages outside one).

**Argument**:
A contention's support: the postulates it rests on and the propositions it requires, each supported in its own domain only — neither link required. Not the **Written Argument**.
_Avoid_: reasoning chain; Written Argument (the draft, not the support); basis alone (say factual basis / legal basis for the two halves).

**Asserted Cause of Action**:
The case-specific instance: this cause of action, in this matter, asserted by a specific claiming party against a specific party. An asserted cause of action refers back to its concept and is assessed against that concept's criteria for this matter's facts.

**Assign**:
To give a job to one session, which then holds its lock: "Assign Job #6 to this session?". The recipient is always a session, and assigning transfers no responsibility. Internal names are unchanged: `locked_by`, `locked_at`, and the guarded write that sets them.
_Avoid_: claim.

**Attachment**:
Any document in a bundle other than the leading document. Its relation is fixed by the leading document's kind, never chosen per attachment: an affidavit's attachments are **exhibits**, a letter's are **enclosures**, a Book of Authorities' are **authorities**, a Record's are **Parts**. Each relation has its own identity key (exhibit letter, enclosure ordinal, citation, Part title); the relation itself is derived from the parent and is not stored.
_Avoid_: annexure, appendix (fine in a specific document's own vocabulary, not as the general term); child (storage word).

**Authority**:
Reusable legal material with zero client data: case law, legislation, regulations, treatises. Authorities live outside any matter and are shared across matters.

**Bare Row**:
The `main.facts` row for a Fact known **only through privileged sources**: an ID and nothing else (`description = ''`, no category, date, source, notes, informant or basis). Privilege attaches to a Statement of Fact by its source and never to a Fact, and any summary, paraphrase or abridgement of a privileged statement is itself privileged, so the non-privileged store holds no wording for such a Fact. The Statement of Fact stays in `privileged.fact_provenance.source_note`, and only a privileged-side read (`@query_10`, `@query_22`) shows what the ID means. Nothing links to a bare row, and drafting, list and verification reads skip it. It becomes an ordinary fact only when a non-privileged source states the same Fact and the row takes that source's own Statement of Fact. See `.claude/skills/matter-data/references/design-decisions.md` #67 and `.claude/skills/matter-data/operations/bare-privileged-facts.md`.

**Basis**:
A distinct legal footing for an order sought, or for opposing one: **jurisdictional** (the court's authority to make the order on this application) or **doctrinal** (the doctrine or rule that supports or defeats it). An order may rest, or be opposed, on as many bases as the material supports.
_Avoid_: ground, grounds; issue (the question a basis answers); point; defence.

**Bundle (application)**:
An application as a whole: the lead Writing, its supporting documents, and the surrounding work of the availability letter, filing and service, and the application book. No stored record. Every bundle-level job is scoped to the lead Writing, whose Job Board and completion-criteria card are the tracker. Not **Bundle (ingest)**.
_Avoid_: package (the assembled files the gate reads); application book (one product within it).

**Bundle (ingest)**:
One file that holds more than one document. An affidavit with exhibits, a Book of Authorities, an Application Book, a cover letter with enclosures, a Land Title form with the certificate it registers: all bundles. Inside a bundle there are only three things, a **Leading document**, **Attachments**, and **Apparatus**; an attachment may itself be a bundle.
_Avoid_: compound document; container (engineer-facing); book (the court's word for a filed PDF, not a shape).

**Cause of Action Concept**:
The general body of law describing a cause of action (a kind of Legal Concept), independent of any matter.

**Clause**:
One self-contained statement of law. It can be read alone, with no pronoun or reference pointing outside it. The unit that is embedded and compared. There are four clause types. **Element**, **Exception** and **Factor** are a proposition's conditions, and a **Rationale** explains a proposition. A clause takes its type from the proposition that uses it. The clause a proposition entails is that proposition's **Consequence**. One clause may be an element of one proposition and the consequence of another.
_Avoid_: clause for a numbered provision of a contract or statute (say provision, or contract clause); statement (taken by **Statement of fact** and **Statement of law**). The drafting database's `clauses` table is a frozen code name for a clause of a Writing, not this sense.

**Client account**:
The billing record for a client: the practice-data `client` item, with its client number, lawyers and account label. Not who the client is: that is each **Contact** holding a **Matter role** tagged `client` on the matter, so joint clients are one account with two client roles.
_Avoid_: client for the account where the person or company is meant, or the reverse.

**Close as superseded**:
The practitioner's bookkeeping instruction that supersedes a queued job all of whose keys are dead, or a fast-path job whose item changed. Never the session's initiative. No restore path: if the marker fires again, the Proposal returns.
_Avoid_: shelve (an angle not pursued); complete (no work was done); auto-close.

**Completion criteria**:
The one card at the top of a Writing's Job Board: headed `Completion Criteria`, with the Writing kind's criteria beneath it. It is complete only when every criterion reads met at once. Derived at every render, never stored, and it makes no readiness claim of its own.
_Avoid_: Goal; Goal card; objective; milestone; "ready to file" or "ready to serve" (the card never says either while a gate step is open).

**Component**:
A part of a Mockup — caption (style of proceeding), orders, paragraphs, excerpts, signature block, address for service, frontmatter header. Shared Components render through one **component engine** each so every Mockup presents them identically.
_Avoid_: section (a schema term); part (Form 32's own word).

**Consequence**:
The legal outcome a proposition produces: what may, must or does follow. In the pool it is the clause a proposition points at as its outcome. A clause is a consequence only because some proposition points at it that way, and one clause may be the consequence of several propositions. It may be compound: where the prose makes a second outcome depend on the first, both stay in one consequence. A new part begins only where the prose gives a new actor with its own main verb, so two linked outcomes of one actor are one part. Each part records three reading aids: its actor, whether it is discretionary (true where a person or a court is given a choice, as with "the court may order", and false otherwise, including a "may" that states only what is possible, as with "service may be proven") and its polarity (negative when the part says something does not happen or may not be done, otherwise affirmative). A consequence that is not compound has one part. The aids are shown beside a search result because similarity search blurs them. A consequence is the hub of a **Rule** and the entry a search looks for. Two consequences judged to mean the same are both kept and linked, never merged.

**Consolidation part**:
One of the separate pages on which an official publisher issues a single instrument, such as a **Rule Set** whose parts and appendices each have their own page. An instrument is held whole only when every part is held.
_Avoid_: section, chapter (both name divisions within the text).

**Contact**:
One person or organization the firm deals with, or acts for or against, held once, firm-wide, in practice data as a `contact` item tagged `person` or `organization`. It is the source of truth for email, phone and address. The practitioner's address book only pre-fills it. Tied to organizations by **Affiliation** and to matters by **Matter role** (`docs/ADRs/0009-firm-wide-contacts-in-practice-data.md`).
_Avoid_: party (a role in a proceeding, recorded in matter-data); participant (a role in a matter's documents); contact details copied onto a matter's records.

**Contention**:
A submission's assertion: law applied to fact — the position one side argues for, in the lawyer's wording. Never a bare postulate or a bare proposition. Also called an **application paragraph**, the practitioner's name for a contention that does this job: it links at least one fact and one proposition and argues the connection between them (🧾 and 📚 flag a missing link).
_Avoid_: theory, thesis; proposition (law alone); point (an opposing point is theirs).

**Copy (within a bundle)**:
A later segment of a bundle whose text matches an earlier segment: the scanned paper cover letter behind the digital one, the printed enclosures behind the originals. Noted on the original's row, never extracted twice, never given a row of its own.
_Avoid_: duplicate (reserved for the cross-file hash match at the ingest gate).

**Counsel of record**:
A party's lawyer and address for service as the court record shows them, changed only by a filed notice or an order. Held in matter-data as filed (`.claude/skills/matter-data/references/design-decisions.md` #55). It can differ from the lawyer **Contact**'s working details. When it does, the practitioner is asked whether a notice of change was filed, and neither record is overwritten.
_Avoid_: the lawyer's contact details (those are the contact's).

**Court Rule**:
A provision of the procedural rules of a court or tribunal. Rules of court are delegated legislation; an arbitral institution's rules bind by the parties' agreement. The term marks source, not content: one Court Rule may state one rule, several rules, or a test made only of factors. The enacted or adopted text governs.

**Criterion**:
One fixed condition on a Writing's completion-criteria card, read as met, unmet or pending at render time from the render's marker inventory or from job rows. Stock per Writing kind, never authored per Writing and never stored. A met criterion can flip back. Pending never counts as met.
_Avoid_: checkbox (nothing ticks it); requirement; the pre-filing checks (the gate's C1 to C6 read package files and are never subsumed).

**Current package**:
A package for which at least one gate step records a pre-filing check run at the database's current revision. The only sense in which the render knows a package exists.
_Avoid_: package built; assembled (no record of either exists).

**Dead key**:
A `ticket_proposals` key whose Proposal no longer derives from the render's inventory, meaning the marker no longer fires on that row.
_Avoid_: stale job (the job may hold other live keys); moved item (a reworded item is reported separately).

**Defence**:
A matter the responding party raises that defeats liability or relief, often with the burden on that party. The pool has no type for it, and how a defence is stored follows the prose. Stated as a carve-out from a proposition ("unless", "except"), it is an **Exception** to that proposition, which may point at another proposition that sets out the defence's own conditions. Stated as a rule of its own ("relief does not follow where"), it is a **Proposition** whose consequence has negative polarity.

**Dismissed**:
The **terminal** disposition on a theorized fact's provenance: our own investigation concluded the fact is **likely untrue**. Recorded on the provenance row, never by deletion — the record of what was considered and rejected is the point. An argument may not rest on a dismissed fact. "Dismissed" is a fact-investigation disposition, **not** a party position and **not** a posture, and it is knowable only for **our own** side — there is no way to know what an opposing party has privately dismissed. (Distinct from a *proceeding* status or an *issue* status — see **Fact Posture**.)

**Doctrine**:
A named body of law that groups related rules (e.g. promissory estoppel). Used without an article ("legal doctrine"), it means the body of law generally.
_Avoid_: doctrine for scholarly writing about the law (the civilian sense) — write "secondary authority". The drafting database's authority kind `doctrine` and the pool's `doctrine_tag` are frozen code names, not this sense.

**Document**:
The evidence-side object a statement of fact or an admission points at — the **Instrument** (the witness's, carrying the words to the forum; or the admission instrument through which an admission is sought), the **Exhibit** a statement tenders, or an admission's response — with its identity (label · date · description), best-copy mark and service date. Not a member of a Writing: those are Drafts / Mockups (the written-argument mockup, the requisition draft). The renderer's `documentType` key for the Writing-member sense is a frozen legacy code name. Exception: the mockup header's "Document …" labels (`Document Type`, `Document Name`, `Document Date`) name the Writing being drafted, not this evidence-side object.
_Avoid_: document as a Writing member (say mockup or draft); file (the disk artifact, not the thing); paper.

**Done-test**:
The test, carried by each pain in a **Suggestion**, that tells a maintainer when the change is finished, checkable without asking the sender. On a solved problem it is what the practitioner accepted in the session; on a gap it is the end result they wanted.
_Avoid_: acceptance criteria, completion criteria (the Job Board card).

**Doubt**:
A reason to distrust one statement — seated on the statement, never the postulate or proposition. One marker 👃, named per domain: *suspicious* (doubtful facts) on a statement of fact, *dubious* (doubtful legal basis) on a statement of law. Modes: withdrawn, wrong at the source, outweighed, misread, misattributed, out of time.
_Avoid_: posture (the retired column name); not noted up (that is **Note up**, workflow not doubt).

**Draft**:
A rendered-for-review file in any format — markdown, .doc, .docx or .pdf — that the practitioner reads; the review surface, never the filed face. A Writing is a folder of drafts.
_Avoid_: document (reserved for the evidence-side **Document**); report.

**Drafting criteria**:
Every criterion of a Writing kind except the Gate criterion.
_Avoid_: all criteria.

**Element**:
A requirement that must be satisfied for a proposition's consequence to follow. In the pool it is a clause linked to a proposition with the type element. It is met or not met, and a proposition is met only when every one of its elements is met. The party relying on the proposition establishes it. Case data stores elements under the frozen code name `legal_criteria`.
_Avoid_: criterion, condition, requirement (name the clause type: element, exception or factor).

**Eligible**:
A Ready fast-path job, on a Writing not yet filed, whose every key still derives, whose marker instances are all on the design's named list, and which has no either/or partner. Derived per render and shown as the Ready card subtitle "can be picked up with nobody present".
_Avoid_: one-step (necessary, not sufficient); ripe (every Ready job is ripe).

**Evidence**:
Non-privileged material linked to a fact as support (or contradiction) for it.

**Exception**:
A circumstance that takes a case out of a proposition: when it is present, the consequence does not follow even though every element is met. In the pool it is a clause linked to a proposition with the type exception, or, in place of a clause, a pointer to another proposition whose conditions set the exception out. It attaches to a proposition and never to one element, exception or factor. The party resisting the proposition raises it.
_Avoid_: exception for a negative element (an absence the relying party must establish is an **Element**); **Limit**; criterion, condition (name the clause type).

**Exhibit**:
A document a statement of fact tenders through its instrument, or whose foundation fact an admission covers. **Sponsored** when some statement's or admission's exhibit pointer names it; **unsponsored** when none does — it renders 👤 on its own Evidence Index line.
_Avoid_: attachment; document (too wide); evidence (the whole support side).

**Fact**:
A discrete factual assertion about the real world (not a legal conclusion, not a party's characterization of it).

**Fact Posture**:
The practical state of a fact given all current positions on it — **derived, never stored**. Values: **disputed**, **admitted**, **not_admitted**, **no_position**, **claimed**, and **unaddressed**. Posture is always computed from current positions at read time.
_Avoid_: status. **"Status" is a lifecycle word and must never be used for posture.** Status describes the state of a proceeding or a source's ingestion; posture describes where a fact currently stands between the parties. Do not conflate the two, and do not invent a "fact status" term.

**Factor**:
A consideration weighed in deciding whether a consequence follows. In the pool it is a clause linked to a proposition with the type factor. It is a matter of degree, weighed with the proposition's other factors to reach a judgment, and is never met or unmet alone. Case data stores factors under the frozen code name `legal_criteria`.
_Avoid_: criterion, consideration (name the clause type: element, exception or factor).

**Fast-path job**:
A one-step job written from a Proposal the Opening's intake took, or the practitioner picked and left unedited. Its title, intent and single step are the Proposal's own fixed text, `<work name>: <item>`. One fast-path job per picked Proposal; the fast path never merges. A Proposal whose label the practitioner changes, or several the practitioner names as one piece of work, are outlined through the ordinary interview in the practitioner's words, and that merged job holds every key. The intake, or the pick, is its approval.
_Avoid_: fast-path ticket; derived job; auto-job; stored Proposal (nothing is written before the intake or the pick).

**Filing**:
A Writing delivered to a forum in a proceeding — a VanIAC submissions package for one round, a BCSC requisition, a letter to the court or tribunal. A Writing the forum "receives" rather than "files" is still a Filing. A Writing delivered only to another party, or kept on the file (a memo to file), is not.
_Avoid_: package (one kind of Filing); instrument; application (one kind of Writing); court document (wrong for arbitration); submission (one contention with its argument); filing for a letter to opposing counsel (a Writing, not a Filing).

**Filing-ready declaration**:
The state in which every drafting criterion reads met. It triggers the noting-up sweep, the evidence-concerns pass and court-ready assembly at the next session's Opening, announced in one line. It is withdrawn when any drafting criterion flips back, and it recurs. The approval to file remains the practitioner's act.
_Avoid_: approval to file; ready to file; approval to serve; ready to serve; sign-off.

**Final review**:
The practitioner's own reading of the content in context, whoever wrote it, done holistically and last, one Writing at a time. Until it is done, every statement of law, statement of fact, proposition, postulate, submission, order sought, clause, prose slot and rhetorical paragraph on a Writing for delivery (a Filing, or a Writing that is sent) carries 🧐 on its line once no other work marker on that line does (on a merged Notice of Application fact line, every object's markers count), and the Goal card cannot read ready. An approval is a `review_approvals` row holding a snapshot of the object's stored fields (text, excerpt, pinpoint, never rendered wording); 🧐 fires again whenever the stored fields differ from the latest snapshot, computed at render, never stored. Rendered for the human on every mockup of a Writing for delivery, never on a filed or sent face. A client letter is not a Writing and carries no 🧐: it is kept out of this database as solicitor-client material, not exempted from review. Rules: `.claude/skills/drafting-data/references/work-markers.md` row 🧐; storage: `references/review.md`. Internal names: `review_approvals`, `review_points`, criterion id `counsel-review`, `counselReviewMarker`.
_Avoid_: approval (the record, not the act); sign-off; verification (🔬, the research lawyer's act); review to-do (the void job/to-do split).

**Form-bound writing**:
Legal writing for which the venue publishes the form document itself, with fixed fields and wording: a BCSC Form 32, a Small Claims Form 2, the BCCA respondent's factum. A venue that prescribes only structure (parts, headings, numbering, caption, page limit, required statements) does not make a writing form-bound. Drafting it takes a specialist skill for that form; when none exists, the gap is reported, and the writing is drafted as an Unstructured Writing, its fixed wording copied from a saved copy of the published form.
_Avoid_: court form (names the filed artifact, not the kind of writing); template (also means a firm precedent); bespoke (the rendering path, not the kind of writing).

**Free-form writing**:
Legal writing for which no venue publishes the form document, even where it prescribes the structure: demand letters, letters to opposing counsel, client reporting letters, memos to file, a VanIAC written argument laid out to VanIAC's rules.
_Avoid_: informal (the tone is often formal); correspondence (narrower; a memo to file is free-form but addressed to no one).

**General Job**:
A job tied to no Writing (`tickets.filing_id` NULL): shared-substance work done once for every Writing in its proceeding. It is drawn on every live Writing's Job Board in that proceeding, tagged "General" on its card and ending ` · general` on its `drafting_forms__board_card` line, so a second board's copy never reads as a duplicate. Before the proceeding has a Writing it is on the proceeding's own board, untagged because every job there has no Writing, and it is never on a **Standalone Job Board**. Also called a **job with no Writing**. Not a **Writing Job**.
_Avoid_: proceeding-scoped job, proceeding-wide job (design prose only); shared job; duplicate.

**Hunch**:
A first impression drawn only from what the model already knew before the session began — nothing in the session (no file, tool result, or line of conversation) was consulted. For a view of the law, every impression outside the research-agent is a hunch, whatever it rests on.
_Avoid_: guess, gut feeling, "I think" with no label; hunch for an answer formed after reading the files (that is a **Recommendation**, except for a view of the law).

**Instrument**:
The executed or served document through which something reaches the forum — two vehicles, both fact-domain. The **witness's instrument** carries a witness's words: an affidavit or a witness statement (`statement.instrument`); execution is the signing or swearing (🖋️ sign it ⊕ ✒️ swear it), and an account with no instrument yet is ✍️ draft it. The **admission instrument** is the document through which an admission is sought from a party — notice to admit, pleading, interrogatories, or the examination transcript (`admissions.instrument`); its work is service (🎾). Fact domain only: published law arrives already executed.
_Avoid_: vehicle (generic, used only in design prose); document (too wide); affidavit, notice (one kind each); request, demand, ask (no single word covers the four methods).

**Issue**:
A question in dispute, typed as **factual** (a question of fact), **legal** (a question of law), or **mixed** (a question of mixed fact and law). Issues connect facts and legal criteria to the practitioner's strategic view of what is contested.

**Job**:
One unit of session work for `/draft`, shown on the Job Board as a job card — either drafting/research work scoped to a Writing, a **Standalone Job Board** or a proceeding (`kind = 'work'`), or the work of outlining further jobs (`kind = 'charting'`). Every card is a job: there is no job/to-do split. Stored, and always rendered on the Job Board — never on any advocacy document. Always belongs to a proceeding, never to the matter alone, including a pre-filing proceeding. A session refers to one as "Job #6", never bare "#6". File names and prose say job (`drafting-data/references/jobs.md`, `draft/references/job-session.md`). Database and code identifiers are unchanged: the `tickets` table and every `ticket_*` table and `ticket_id` column, the `#ticket-N` anchors on the board, the `board_data` key `tickets` and the Goal card's `tickets` criterion id.
_Avoid_: ticket (reserved for development tasks such as GitHub issues and Wayfinder tickets, and for database identifiers); task (collides with software usage — the design's own deliberate choice); assignment (it implies a transfer of responsibility); to-do (a practice-registry row, see **To-do**).

**Job Board**:
The page (`Job Board <id>.html` at the top of the draft folder) that tracks the work toward one statement of goals. Every Writing linked to it serves those goals as a whole. A board starts with at most one Writing and gains more only by a **Merge (Job Boards)**. It renders its Writings' **Proposals**, its jobs — ready / in progress / waiting / needing a fresh outline / superseded / completed / shelved — and its proceedings' loose threads not yet outlined. Each lane is a **Job list**, the general word, and keeps its own name (Proposed, Ready, Shelved angles, …). A Mockup like any other (never delivered to the filed face), read-only: nothing is written back from it. It prints marker glyphs only in its Proposed and Shelved angles lists, taken from the render's marker inventory, and holds no marker predicate of its own. A **pre-filing proceeding** has a Job Board of its own, with its jobs and loose threads and no Proposals, lifecycle or mockups. When the proceeding gets its first Writing, with or without a forum, that board is no longer drawn: each live Writing's board in the proceeding shows the jobs that name no Writing and every loose thread not yet outlined. A **Standalone Job Board** is a Job Board with no Writing, whose page takes the same name and holds only its own jobs and loose threads. A folder holding the older `Work Board.html` has it retired at the next write of the Job Board pages, which sit at the top of the draft folder, so no folder holds both. Internal names are unchanged: `document_type` `Work_board`, `render-work-board.ts`, `workboard-*.ts`, and the board's CSS classes, element ids and data keys.
_Avoid_: Work Board (the practice-wide page, see **Work Board**); document (a Mockup, not a Writing member).

**Lawyer account**:
One currently practising lawyer's identity with Probanda, matched to that lawyer's law-society directory record. It is **provisional** from the match until the lawyer proves they are the person in that record, then **verified**, and **suspended** while the directory shows them not practising. It owns the lawyer's keys, one for each device, and every shared service (the legal commons, the Suggestion Box, the troubleshooting store) accepts only a key that belongs to a live account. A firm's lawyers each have their own account, and all of them work in their practice's one tenant.
_Avoid_: user (also means anyone using the plugin, including staff); install key (one device's key, owned by the account); tenant (the practice, not the person).

**Leading document**:
The document a bundle exists to deliver: the affidavit body, the cover letter, the Land Title form. The first non-apparatus segment in the file. A bundle may have none (a Book of Authorities, a Record: nothing but apparatus in front of the attachments).
_Avoid_: body (the affidavit-only word; keep it for affidavit prose); parent (a storage word: the leading document's row is the attachments' parent, but the concept is the document, not the row); host (engineer-facing).

**Legal Citation**:
A reported case or statute citation (e.g. a neutral citation or statute chapter reference), used to identify an authority. Legal citations are not computed — they are recorded as reported.

**Legal Concept**:
A named body of law as case data stores it: a cause of action, doctrine, test, defence or remedy. Legal concepts are reusable law, not tied to any matter. The kind `test` is a frozen code value for a body of law known by a test's name, not a **Test**.
_Avoid_: Legal Theory (avoid the term entirely; use "Legal Concept" for general law or "Asserted Cause of Action" for the case-specific instance — "Legal Theory" conflates the two and adds no precision).

**Legal research and writing**:
A lawyer's professional work that establishes what the law is or produces writing for the practice: research, verification and briefing of authorities, court and tribunal filings, affidavits, and correspondence. Time-entry narratives and billing preparation are practice administration, not legal research and writing.
_Avoid_: legal work (the live-issue test's narrower term, limited to judgment about the content of law); LRW as a standalone word in prose.

**Letter**:
A Writing that is a letter or email to the forum or to another party in a proceeding, when it takes a position, asks for something, consents or refuses, or offers. A Letter to the forum is also a Filing; a Letter only to another party is not. Its filed face is the version actually sent. An email to a tribunal is a Letter too. Never client correspondence, which is solicitor-client material.
_Avoid_: correspondence (broader: it includes client letters, which are never Letters); email as a separate kind (the delivery, not the thing); transmittal (a covering email is its Writing's delivery, not a Letter).

**Lifecycle state**:
Derived, never stored: drafting → filed → heard → decided → appeal expired → retired, read off `filed_on`, the hearing date, `decided_on`, the appeal deadline the `docket-clerk` agent reports, and `retired_on`. A reply is a sibling Writing, not a state of the Writing it answers. The Job Board prints the derived state as its `State` row.
_Avoid_: status (an enum stored beside the dates — the thing this design refuses); archived (the renderer's word for revision-archive copies of a mockup).

**Limit**:
A boundary on a rule's scope. Outside it, the rule never applied, where an exception displaces a rule that did apply. The pool has no link or type for it, and how a limit is stored follows the prose: as wording inside the clause it bounds, as an **Element** where the prose states it as a condition the relying party meets, or as an **Exception** where the prose states it as a carve-out.
_Avoid_: limitation (reserved for limitation periods and the Limitation Act).

**Litigation Strategy**:
One page for a matter, `Litigation Strategy.html` at the top of its `0. DRAFT` folder, which `/draft` presents when the practitioner asks for it. The matter's open **To-dos** lead it, each with its BF date as a plain date and, when it points to a Writing, that Writing's line beneath it. Below them each Writing, and each **pre-filing proceeding**, is one line: name, lifecycle state, mockup status and jobs in progress. Each open **Standalone Job Board** is one line under "Job Boards", and a closed one is listed with the retired Writings as "Closed <date>". Each Writing's own jobs, steps and Proposals stay on its Job Board. A folder holding the older `Matter Board.html` or `To Do List.html` has it retired once `Litigation Strategy.html` is written there. Internal names are unchanged: `matter_board_path`, `render-matter-board.ts`, `matter-board-shell.ts` and the page's data key.
_Avoid_: To Do List (a to-do list is the **To-dos** themselves); Matter Board; Job Board (one board's page); dashboard.

**Loose thread**:
Two senses, told apart by where each appears:
- on the Job Board, an item in the "Ideas for later" lane: an idea captured mid-job without deciding anything about it — verbatim, at most five sentences, no options or recommendations. Never ripe, never a blocker; consumed only when an outlining session turns it into a real job (`seeds.charted_into`). A discarded thread stays stored, shows struck through, and can be restored. A resolved thread is one that is not open: discarded, else suggested to Probanda, else outlined into a job that is not deleted; a deferred thread is never resolved. It never counts toward a completion criterion.
- on a mockup, the 🧵 work marker, defined in `.claude/skills/drafting-data/references/work-markers.md`, which counts toward the open-items criterion.
The Job Board's own "Ideas for later" section already renders the first sense in the lawyer-facing word — the deferred vocabulary pass (design doc §11) covers only widget labels and prompts elsewhere, not the board's own headings, which were lawyer-facing from the start (that is the point of a rendered surface). Internal names are unchanged: the `seeds` table, `review_points.seed_id`, `seeds.charted_into`, the `seed` CSS class, element ids and data key.
_Avoid_: note (a different, unstored concept this schema deliberately excludes); seed.

**Matter**:
The practitioner's engagement with a client. A matter may contain zero, one, or many proceedings (e.g. a matter that is pure advice work has no proceeding; a matter with a counterclaim or a related third-party action has more than one).

**Matter number**:
The firm's number for the matter on its own, as the practice database records it. Where a matter reference carries a client number in front, the matter number is the part after the dot; the dot is a separator, never part of the value.
_Avoid_: matter ID; matter reference (a reference may carry a client number the number never does).

Note: the two **coincide on matter-only folders and are still not the same field**. Where a folder is named by the matter alone, its reference and its number are the same value. Where a folder carries a client number, the reference is the whole `{client}.{matter}` token and the number is only the part after the dot. The reference comes from the folder, the number from the practice database — never derive one from the other. Where they are equal, say so once; presenting them as two identical-looking fields reads as a duplicated field and invites a practitioner to "correct" one of them.

**Matter reference**:
The token that names a matter's folder and identifies the matter wherever our own systems point at one: either `{client}.{matter}`, a client number and a matter number joined by a dot, or the matter number alone. It is read off the folder name, never assigned — whatever the folder says, that is the matter reference. It names the matter-data folder of a matter not yet moved into its own `0. CASE DATA` (ADR 0013), binds an application, and is what a practitioner is shown when a matter must be identified.
_Avoid_: matter ID (ambiguous three ways — see **Matter row key**); client ID (Westlaw's and UNITY's label for this same value, not ours); file number (that is the court's number for a proceeding).

**Matter role**:
A dated tie between a **Contact** and a matter, with one role from a fixed vocabulary (client, prospective client, opposing party, opposing counsel, co-counsel, expert, adjuster, referral source). It may point to the contact's matter-data party and proceeding. Stored as a practice-data `matter_role` item. Witnesses and tribunal members have no matter role: they stay in matter-data.
_Avoid_: party (matter-data's record of a role in a proceeding); participant.

**Matter row key**:
Not a practitioner-facing identifier at all: the practice database's internal generated primary key on a matter row, carried as a `matter_id` foreign-key column on its dependent tables. It is never displayed. The storage name `matter_id` is also used, unrelatedly, as the key under which case data and application state store the *matter reference* — those names are load-bearing in schema, JSON, and Python and are deliberately not being changed. Read `matter_id` as the name of a column, never as "the ID we show".
_Avoid_: writing "matter ID" in any prose a practitioner reads, for any of the three senses.

**Merge (Job Boards)**:
The practitioner's act that joins one Job Board into another after confirming that their goals overlap or cohere. The survivor takes every Writing, job and loose thread of both and keeps every goal of both. A board with a Writing survives over one without, otherwise the older one.
_Avoid_: combine; consolidate.

**Merge (jobs)**:
The practitioner's act that folds a duplicate job into another job on the same Writing after `/draft` names them as likely the same work. The survivor keeps its own steps and their stamps and takes the other job's undone steps, scope and Proposal keys. The other job is superseded by the survivor, never deleted.
_Avoid_: combine; consolidate; dedupe.

**Mockup**:
A Draft in markdown format — the word is reserved exclusively for markdown. A filtered, compressed markdown rendering of the submission database for one member of a Writing, read by the practitioner and by every agent session alike — the sole review surface and the session's starting picture. It shows everything the practitioner must decide about, reserved material included. Regenerated, never hand-edited; stamped with the database revision it was rendered from. Its format is strict: a YAML header, then only wording that will be printed, work markers and `<!-- comments -->`, then the symbol Legend, which is generated and never written. A gap prints as a marker and a blank underline, with its description in a comment (`🧩 ________ <!-- signer not chosen -->`), never as a description. No commentary, suggestions or loose ideas.
_Avoid_: report; readiness report; document.

**Non-billable entry**:
A time entry recorded against a matter with `billable` false: kept on the file, excluded from WIP and accounts receivable, never billed. The consolidation push records one per retirement run, tagged `retire:<filing_id>:<retired_on>`. Matter-less administrative time is not the same thing and is still never committed.
_Avoid_: firm time, admin time (both mean no matter); write-off (a billed entry later forgiven, a different act).

**Note up**:
Vet an authority's subsequent treatment before relying on it — routine, mandatory before filing, law side only. Marked 📇 until done; the outcome lands in the authority's `treatment` column (⚠️ distinguishable, 🚨 negative treatment, ⛔ not good law, or clean). Distinct from **Doubt**. All of that is for a case: a statute or regulation is noted up by its currency check alone, its outcome its currency result; a provision of a **Rule Set** or a practice direction is noted up on **Reliance on a rule**, by its currency check and a word-for-word comparison of the text relied on with the source its **Venue source record** names; and doctrine is never noted up (`.claude/skills/shared/statute-currency.md` → Noting up legislation).
_Avoid_: suspicious, dubious (those are Doubt); treatment (the outcome, not the act); check (as a column name); verify (that is whether a lead has been confirmed in hand).

**Obiter dictum**:
A proposition stated but not necessary to the decision, and so persuasive only. It is the other value of the mark described under **Ratio decidendi**, recorded in the same place. A principle taken from legislation carries neither value.

**Oral reasons**:
A decision pronounced orally with no transcript, recorded in matter-data as an authority of type `oral_reasons` whose citation names court, file number, judge and date — never a style of cause — and pooled as treatment notes only: which cited authorities the court followed, distinguished, declined to follow, or did not consider, from the practitioner's own account. No text, excerpt, or note crosses. A later transcript upgrades the same authority.
_Avoid_: unreported decision (a reported-elsewhere question, not a transcript question); judgment (implies written reasons).

**Outlining**:
A session (an outlining interview) whose deliverable is one or more `tickets` rows — new, outlined afresh, or outlined from Proposals — and their dependencies, blockers, conflicts, and priorities — never substance. The practitioner supplies the work, conflicts and priorities, recorded in their words; the session divides the work into jobs and records what waits on what. A session either outlines or executes one assigned job, never both.
Outlining writes jobs on the practitioner's word:
- jobs in their own words, through the interview.
- jobs from their pick: a Proposal picked unedited (`draft/references/job-session.md`, "Left unedited"), or a `/prepare` stock job picked at the read-back (`/drafting-data` §3b, `prepare/SKILL.md` §6).
- a queued job reworked in place, which is an outline afresh (`/drafting-data` §3a).
Jobs written by rule with no pick are not outlining:
- the stock jobs written at the letter and memo save (`/drafting-data` §3b).
- counsel's review pair (`/drafting-data` §3c).
- the scrutiny review job (`/drafting-data` §3d).
- the gate jobs (`/drafting-data` §14, §14a).
- intake (`/drafting-data` §3e), which writes never-held Proposals as jobs at each attended Opening.
_Avoid_: planning (a different, DB-agnostic Coclerk concept elsewhere); charting (also wayfinder's verb).

**Pain point**:
Friction with Probanda that actually happened in a session and shows in behaviour: a correction, a rejection, a workaround, a repeated instruction, a refusal or abandonment. An irritated tone alone is never one. Pain points are taken from the work, never asked for.
_Avoid_: complaint (the practitioner's words, which may name no pain); bug (a fault, which goes to troubleshooting).

**Participant**:
Anyone a matter's documents name in a role: a party, a party's counsel, a witness (an expert is a witness), or a tribunal member. Every party is a participant; not every participant is a party.

**Position**:
A party's stance on a fact: **claim**, **admit**, **deny**, **not_admit**, or **no_position**. "No knowledge" pleading language maps to `not_admit` with `position_basis = outside_knowledge`. Express abstention maps to `no_position`; actual silence is represented by no row. Verbatim limiting wording is preserved in `qualification`.
_Avoid_: claim as shorthand for a cause of action. "Claim" is a position value (a party claims a fact) and is also used loosely in ordinary English for "cause of action" — in this domain's writing, always spell out "cause of action" (or "asserted cause of action") when that is what is meant.

**Postulate**:
A fact-domain assertion in the lawyer's own words — what we say happened. Its twin in the law domain is a **Proposition**; the two combine in a **Contention**. Statements support a postulate in their own words and need not repeat it.
_Avoid_: claim (used loosely for either domain); contention (a submission's assertion — law applied to fact — never a bare postulate); allegation (a postulate anchored in a pleading, advanced formally, proof not yet marshalled); fact (the stored row, not the wording).

**Pre-filing proceeding**:
A proceeding with no Writing yet. Its forum may not yet be chosen (`forum` NULL). A Writing that needs no forum parts, such as a demand letter, may be created before the forum is chosen, and one that needs forum parts only after. It holds jobs and loose threads, for example the work of choosing the forum, on a Job Board of its own. Its first Writing ends it, with or without a forum: see **Job Board**. Choosing the forum updates the same proceeding. A second forum is a new proceeding, and no job moves between them.
_Avoid_: pre-litigation matter (the matter exists either way); undecided forum as a stored value (it is NULL, not a sentinel); pre-filing for a proceeding whose only Writing is a demand letter (nothing has gone to a forum, but it has a Writing, so it is not one).

**Preference**:
One person's saved instruction to a named skill, in generic terms, made when a fix worked for them ("Show the deadline summary before the full list"). It takes effect for that person only, from the moment it is saved, and holds no client content. Stored per person in the firm's `0. CASE DATA` folder.
_Avoid_: personal memory (the design's working name); memory (Claude's own feature); practice quirk (a device's environment note).

**Preview**:
What a **Suggestion** shows the practitioner to stand for "done": a before and after in the medium of the pain (a page variant, a redraft, a replayed exchange, a worked case). A page Preview is a deterministic render, never HTML a model wrote. Only Previews rendered from placeholder data may be posted.
_Avoid_: mockup (reserved for the markdown Draft of a Writing).

**Principle**:
A statement of law in the words an authority uses. In the pool it is a record holding that prose, kept as stated and matter-free, and linked to each **Authority** that supports it. That link carries the pinpoint: where in the authority the prose is found. Propositions are decomposed from a principle, and each records each principle that states it. One principle may state several propositions, and one proposition may be stated by several principles.
_Avoid_: principle for a rule, a test or a proposition; principle for a foundational norm that justifies rules (name the norm); concept, doctrine (as the stored entity).

**Privileged Source**:
A source subject to privilege. A privileged source may explain *how* a fact was discovered (its provenance) but can never itself be treated as admissible evidence. Privileged sources and non-privileged sources are kept in physically separate storage so that no path can accidentally connect privileged material to the evidentiary record — see the design decision on the privilege firewall.

**Proceeding**:
One court-filed case within a matter: identified by court, registry, and file number, with a style of cause, parties, and a status (active, stayed, concluded). Facts, sources, causes of action, and issues are generally scoped to a proceeding, not the matter as a whole.

**Projection**:
A Mockup generated by the deterministic engine (as opposed to one an agent wrote by hand). Every Mockup is a Projection, an Unstructured Writing's included: the model writes printed wording into the database and never writes a mockup. The word is used when the deterministic origin matters.
_Avoid_: render, output (the act / the bytes, not the thing).

**Proof**:
The litigation conclusion that a fact is established: through evidence, through an admission, through an agreed statement of facts, or otherwise. Proof is a legal/strategic judgment, not a database flag.

**Proposal**:
One work marker's remaining work, on the database row that work is done on, listed by the render engine in the Job Board's Proposed lane. At the next attended Opening a Proposal no job has ever held becomes a **fast-path job** by intake. The rest stay for the practitioner to pick. It carries no intent or steps of its own. Its label, the marker's work name and the row's item, is fixed text from the record, which the practitioner keeps or changes as the job's title in the outlining session that turns it into a job. A Proposal picked and left unedited becomes a **fast-path job**. It is rebuilt by every render and shown while its marker is the current rung of its ladder and its key is held by no queued or in-progress job and no shelving, and it is never stored. Unlike a **Loose thread** (a person's idea, stored verbatim until outlined), it needs no capture, because marker state regenerates it.
_Avoid_: seed; offer; suggestion; candidate; draft job.

**Proposition**:
What an authority asserts as law: a consequence, and the conditions it follows from where the authority states any. It may have no conditions. In the pool it is one record, read with its links: the clause that is its **Consequence** and the clauses that are its conditions, each an **Element**, an **Exception** or a **Factor**. The record is named `test` whatever its size, and has one consequence, so one record is one proposition, however many principles state it. A proposition with two or more elements or factors is a **Test**. One with fewer is called a proposition and not a test. A **Rationale** is the "because" beside a proposition and is not part of it. A proposition's authority and pinpoint are reached through each **Principle** that states it. In a draft, a proposition is the one sentence that states this, and each **Statement of law** hangs from it. Its fact-domain twin is a **Postulate**.
_Avoid_: proposition for a factual assertion (a **Postulate**); proposition to mean proposal; holding; principle.

**Provenance**:
Where a fact was learned; this may be privileged (e.g. a client interview) even when the fact itself is later provable through non-privileged means. A fact can have provenance without evidence — that is a trial-prep gap (a fact you know how you learned, but cannot yet prove admissibly).

**Publisher map**:
A record of how one official publisher issues instruments: where their text is found, how each instrument's **Consolidation parts** are listed, and which signals show that the text is current. It never holds an instrument's text.
_Avoid_: rule-set map, source list.

**Qualified admission**:
A single **admit** position where the limiting language is recorded verbatim (never split into a separate admit row and a separate deny row, and never paraphrased).

**Ratio decidendi**:
A proposition necessary to the decision, and so the part of a decision capable of binding. Whether it binds a given forum is a separate question of law. In the pool it is recorded on the link between a proposition and a principle that states it, so that two propositions drawn from one principle can be marked apart. The pool's older `obiter` field, on the link from a principle to its authority, marks a whole principle at once and is not changed.
_Avoid_: ratio for "the court's own words" (obiter is also the court's own words), or for a text-similarity score.

**Rationale**:
A clause that states why a proposition exists: its purpose, basis or justification. The way to tell one: it is the "because" that justifies the proposition, and it is not a statement of the rule. It helps a decision maker understand the proposition, and decide when and how to exercise a discretion the proposition grants. It states no outcome and no condition, so it never decides whether the consequence follows and never counts when two propositions are compared. It attaches to a proposition, with the principle that states it, and one rationale may be shared by several propositions. It is kept, never discarded.
_Avoid_: rationale for a condition (an **Element**, **Exception** or **Factor**); a rationale attached to a single condition or to a consequence (it attaches to a proposition, and its own words name what it explains); **Ratio decidendi**.

**Recommendation**:
An answer formed from information already within reach — the repository, the matter's files, tool results, the conversation — without sending a separate agent off to research the point.
_Avoid_: hunch (understates it); advice (overstates it — no independent research yet).

**Record**:
The kind of bundle a court prescribes as numbered Parts with no leading document: a BC Court of Appeal Application Book or Response Book, a chambers record, a petition record, an appeal record. A kind, not a separate shape: a record is a bundle whose attachments are Parts. Classified by its prescribed Part structure, not by how many Parts hold content.
_Avoid_: book (an Application *Book* is a record; a Book of Authorities is a bundle of authorities); binder.

**Recovery**:
Clearing `retired_on` and its reason so a retired Writing drafts again. Offered before an empty sibling Writing of the same proceeding, kind, round and subkind is created. Superseded jobs stay superseded; recovery never re-initiates a push; the practitioner may, and only the practitioner may, flip the retirement's non-billable time to billable.
_Avoid_: restore, reopen, un-retire.

**Redirect**:
The permanent record that sends an old principle id to the id that replaced it, so that every id ever issued still resolves. In the pool it is a row in a separate table, one hop deep, and the lookup tool follows it without showing it. Existing redirects are kept. The revised structure makes none, because it links and never merges.
_Avoid_: tombstone

**Reliance on a rule**:
Making a result depend on a provision of a **Rule Set** or a practice direction: quoting or reproducing it in a document, resting a paragraph, argument or submission on it, or calculating a date or deadline under it. Reading, searching or asking what a provision says is not reliance. Reliance is the point at which the provision must be **Noted up**.
_Avoid_: relying party (the party who must establish an **Element**).

**Representative**:
The principle a **Variant** points at. In the pool it is a principle whose `variant_of` field is empty, and its cluster is that principle with every variant that points at it, one level deep. The word matters only where a variant points at the principle.

**Reserve**:
Whether a postulate, statement, authority, argument or order sought is held back — stored and drafted, rendered only in the Mockup's trailing "Held in reserve" section, marked 🂡, never in the filed face — or deployed into the body. How held-in-reserve material lives in the same database as delivered material. A reserved row is still work (deploy-or-abandon is deferred, not absent).
_Avoid_: disposition (has its own legal meaning — the disposal of a proceeding); privileged flag.

**Retire**:
The practitioner's explicit act that ends a Writing: sets `retired_on` and a reason (appeal expired, appeal exhausted, settled, abandoned, adjourned generally, other), supersedes the Writing's open queued jobs, hands the Writing's research — law assertions, statements of law, authorities, the opposing authorities it answered, and any oral-decision treatment notes — to matter-data through `ingest-submission-law`, and in the next turn initiates the consolidation push. Every retirement pushes; a court decision is never a precondition. A retired Writing is listed by bootstrap and never rendered again.
_Avoid_: archive (taken); close, finalize (both already name other steps); delete (nothing is removed).

**Revision stamp**:
The global monotonic database revision plus a human-readable timestamp printed on every Mockup (the Job Board carries it in its data line and does not draw it); a Mockup is stale exactly when its stamp differs from the current revision. Never a file mtime.

**Rhetorical paragraph**:
A numbered paragraph of persuasion from the record that fits no other type, for example a characterisation of the other side's pleading. It is the deliberate outlet for what the design did not anticipate. It is never refused: every link is optional (a submission, an opposing point, the record by document, pinpoint and excerpt, facts, law, or none), and it can be placed in any part of any advocacy document. Counsel reviews it (🧐) and the overstatement review reads it. Its mockup line carries the plain-text tags `(rhetorical)`, `(states law, no authority linked)` and `(states fact beyond its record)`. The last two depend on the drafter's own record of whether the wording states law or fact. All three are advisory, never block anything and are stripped from the filed face. Its links are never coverage: it never answers an opposing point (↩️) and never supplies a submission's factual (🧾) or legal (📚) basis. Undeployed, it is held in reserve 🂡, as a submission is. Rules: `.claude/skills/drafting-data/references/terms-and-symbols.md` → Consumers. Internal names: `rhetorical_paragraphs`, `filing_rhetoric`.
_Avoid_: persuasive paragraph (*persuasive* is an authority's weight); submission (a contention with its argument); fact (a postulate the record must prove).

**Ripe**:
A job that is `queued`, unlocked, every blocker completed, and (if it has one) no conflicting job currently `wip` — ready to assign, by the practitioner naming it or by an attended session's own choice. The Job Board's own "## Ready" heading already uses the lawyer-facing word for this state; see **Loose thread**'s note on why the board's headings are exempt from the deferred pass.
_Avoid_: available (generic English — "ready" here means specifically classified so by the renderer, per the CHECK-and-conflict logic above).

**Rule**:
A norm that attaches a legal consequence to conditions, by every route the law allows. In the pool it has no record of its own. It is one **Consequence**, every consequence linked to it as meaning the same, directly or through another such consequence, and every **Proposition** that points at any of them. A chain of two or more such links counts only where a person has judged every link in it, because small losses of meaning add up along a chain of model judgments. A consequence with no such link is a rule on its own.
_Avoid_: bare "rule" where the same file also means a **Court Rule** or one of the plugin's own working rules. Say which.

**Rule Library**:
The practitioner's own copy of the **Rule Sets** of the **Venues** they appear before, held on their machine, kept current against each publisher, and shared by all of the firm's matters rather than held in any one.
_Avoid_: rules database; commons (the shared pool that practitioners contribute Rule Sets to, not the practitioner's own copy).

**Rule Set**:
One instrument of **Court Rules**, whole, as its publisher issues it: every **Consolidation part**, schedule, appendix and tariff. A Venue may work under several Rule Sets, and one Rule Set may serve several Venues.
_Avoid_: bare "rules"; an instrument's short name (SCCR) used as a general term.

**Scope**:
The set of database rows an assigned job's writes may touch (`ticket_scope`), checked before every `drafting_data__execute` call the job makes. Expandable by the practitioner at any time; the expansion is itself in scope.
_Avoid_: permission (this is a work boundary, not an access-control concept).

**Severance**:
The push-time act of stripping everything matter-identifying from a principle before it leaves the privileged working layer for the shared pool. Up goes the generalized text, public citation, and doctrinal metadata; no column, relation, or free-text in the pool may point back to a matter.

**Shelve**:
The practitioner's instruction, given in a session, that moves a Proposal, or a queued or in-progress job, to the Job Board's Shelved angles list until the practitioner restores it ("shelved by you"). A shelved Proposal comes back to Proposed if its marker or its item changes from what it read when shelved. A shelved job keeps its place in the work history and is never assigned. Internal names are unchanged: `tickets.rejected_at`, the `proposal_rejections` table, the `rejected` category and lane values, and the `rejected-angles` section id.
_Avoid_: reject, rejection; dismissal; drop (a loose thread's discard, or `dropped_on` on substance); supersession.

**Source**:
Case-specific recorded material belonging to a matter: a document, but also a recording, photograph, or transcript — anything that captures information in a fixed, referenceable form. Sources are the case-specific evidentiary record. A key boundary: **unrecorded anticipated testimony is NOT a source** until it is captured in some record (an affidavit, a transcript, a will-say statement). Until captured, it cannot be cited or linked as evidence — it is merely anticipated.

**Source Citation**:
A computed reference of the form `<file_path>#<locator>`, used to pinpoint where in a source a fact or position comes from (e.g. a paragraph, a page/line range in a transcript). A page-less source (a Word document, an email) is located by an ordinal body paragraph or its header block, so that an independent reader re-deriving the same text reaches the same place.

**Source to get**:
A court decision, an enactment or a file that a job's work has named and is about to retrieve or read, recorded on the job before the work that gets it. It is open until it is closed as got or as not retrieved. It is the job's own record beside its **Steps** and never one of them: the steps are the practitioner's plan, and a source to get is found by the work. Its label is a citation, an instrument or a file name, never what an authority holds. Not a **Source**: that is the matter's own evidentiary record. Internal name: the `ticket_sources` table.
_Avoid_: discovered item; sub-step; download (it also covers legislation and files to read); source (alone).

**Split (Job Boards)**:
The practitioner's act that divides a Job Board with more than one goal, by naming the goals on each side. Each Writing, with the facts, law and arguments it uses, goes to the side whose goals it serves. A Writing is never divided, so goals it serves together stay on one board. Which goals a Writing serves is worked out only at a split.
_Avoid_: unmerge.

**Stage**:
One of the outlining sessions in which `/prepare` is re-run: opening the bundle, after the gate job completes, and after responses arrive.
_Avoid_: phase; step (a job's unit).

**Standalone Job Board**:
A Job Board with no Writing, for work in a proceeding that is not a document: finding a paper original, stamping it, re-scanning it. It exists only on a proceeding that already has a Writing, and its title is the practitioner's own words. It shows only the jobs and loose threads that name it, never the proceeding-wide ones, and lists its loose threads on its page. It has no mockup, view pages, completion criteria, Proposals or stock jobs. Its state is Open or Closed: closing it is a retirement with the reason `other`, after which it has no page, and reopening it clears that retirement. In chat it is `Job Board <id>: <title>`. Internal names: it is stored as a `filings` row of the reserved kind `task-board`, written only by `/drafting-data`'s Job Board creation write.
_Avoid_: task board; Writing (it is stored beside the Writings and is not one).

**Statement of fact**:
One witness's account supporting a postulate: the witness, the **Instrument** carrying the witness's words, an optional **Exhibit** it tenders, the verbatim excerpt (the witness's words, or the exhibit's passage where it tenders one), the pinpoint into the instrument, and the exhibit's own pinpoint. Its law-domain twin, **Statement of law**, is one authority's words supporting a proposition, at a pinpoint in the authority. ↩️ 👃 🏷️ attach identically to both; the excerpt and pinpoint markers split by basis: 📜 📍 authority · 📑 📌 exhibit · 💬 🧷 testimony.
_Avoid_: evidence use (schema legacy); excerpt (the words, not the link); testimony (a statement of fact with no exhibit — the witness's own words alone).

**Statement of goals**:
What the practitioner is trying to achieve on one Job Board, written as a list of self-contained goals, one list per board. Each goal is confirmed, inferred or declined on its own: confirmed when the practitioner approved its wording, inferred when the session wrote it after the practitioner declined, or declined with nothing inferred yet. It shows in its own card at the top of every Job Board, labelled Goal, above the **Completion criteria**: closed, the card shows a short description, such as "Default Judgment Requisition Drafting"; open, it shows the statement as stored, an inferred one in italics with the caption "Inferred, not confirmed". A session reads it only as `board_summary`'s `Goal:` line and `drafting_forms__board_card`'s `goals` lane. Nothing relies on an inferred one as confirmed. Internal names: the `db_meta` key `board_goal:<filing or proceeding>:<id>`, the tool `drafting_data__set_board_goal`, and the page data key `goals` (never `goal`, which is the Completion criteria card's).
_Avoid_: Goal card (the Completion criteria card's code name); objective; Goal (alone, except as the card's label).

**Step**:
One line item on a job card, in order, stamped done as its work completes. Human-only work (a deponent swearing, a witness signing) is a step listed for the practitioner and never dispatched. Internal names are unchanged: the `ticket_steps` table and its columns.
_Avoid_: line item; task; to-do.

**Stock bundle job**:
A fixed-text job `/prepare` offers for a Writing kind (availability letter, file and serve, application book), which the practitioner picks or declines at the closing read-back.
_Avoid_: stock bundle ticket; template job; default job (nothing is written unpicked).

**Structured Writing**:
A Writing whose type has a declared layout: which parts it has, in what order, and which of its wording is fixed. Letters, memos, the release and the BCSC forms with their own generators are Structured.
_Avoid_: bespoke (a rendering path: a Structured Writing may render through the shared general renderer); form-bound (a different axis: a demand letter is Structured and free-form).

**Submission**:
One contention with its argument. A Written Argument's *Submissions*, or Form 32 Parts 2 and 3 together, is the Writing's selected submissions. A submission may rest on facts only or on law only (a jurisdiction submission).
_Avoid_: argument (the support, not the whole).

**Suggestion**:
Feedback about Probanda that a practitioner expressly submits to its maintainers through the Suggestion Box: a summary plus one item per **Pain point**, each with its **Done-test**, its constraints and changes that are accepted or declined one by one. Stripped of anything that identifies a person, entity or matter. Its source is `user` (their own), `assisted` (drafted by Probanda, confirmed by them) or `llm` (a vetted loose thread).
_Avoid_: Proposal (a work marker's remaining work); ticket; feature request.

**Tender (adduce)**:
To **adduce** is to put evidence into the trial record at trial. Two forms: **elicit** — adducing viva voce evidence from a witness; **tender** — entering affidavits or documents into evidence (not only affidavits: some tribunals do not require them). One act, two objects in this plugin: a statement of fact tenders its exhibit; 🕹️ tenders the admission instrument and its response as proof of the admission. Elicited (viva voce) evidence is unmodelled today.
_Avoid_: enter (say tender); file, serve (different acts); adduce for a document alone (the genus — say tender).

**Test**:
A **Proposition** with two or more elements or factors: one way of reaching a legal outcome through several conditions. Exceptions are not counted. It is stored as every proposition is, and the label is taken from the count of its elements and factors when the record is shown.
_Avoid_: limb (an alternative limb is a test of its own; a cumulative limb is an element); test for a whole rule.

**Theorized Fact**:
A fact **theorized for the purpose of investigation** — a fact the case theory needs but that no source yet evidences. It cannot be derived from anything (theorizing is an act, not an inference), so it is recorded; but it is **not a party position** (no stance is on any record) and **not a posture** (nothing exists to derive one from). What it *is* is **provenance**: the fact's source is the case theory itself, modelled as a well-known placeholder source (one *Theory of the case* work-product source per application, created lazily). A theorized fact is precisely a fact whose only provenance is that theory placeholder and whose evidence is empty — the trial-prep gap described under **Provenance**, at the earliest stage, where "not yet evidenced" is the expected pre-affidavit state, not a defect. It is privileged work product, so its `main.facts` row is a **Bare Row**: the wording lives on the privileged side only. It graduates when a non-privileged source states the same Fact, so the row takes that source's own Statement of Fact, and real evidence then lands: an ordinary evidence link makes it an ordinary evidenced fact, and it stops being theorized **by construction** — no "evidenced" marker exists or is needed. The theory provenance stays as the history of how the fact entered. The only other exit is **Dismissed**.

**To-do**:
One row of the practitioner's task registry (`/task-prioritization`), client, admin or professional work, larger than a job. A to-do is one outcome the practitioner would cross off. The work toward it is jobs on its Writing's Job Board, never further to-dos. "To-do" is its visible name everywhere. It may carry a BF (bring-forward) date, the date its work should start and never time remaining, and a deadline, which drafting sessions never see. It may point to one Writing or pre-filing proceeding of its own matter, and it holds no jobs. A Writing has at most one open to-do within its matter. A to-do entered in error or merged into another is `withdrawn`: kept, never open and never completed. Internal names are unchanged: the `practice_tasks` table, the `/task-prioritization` skill and the task tools.
_Avoid_: task (internal names only); job (one unit of session work on a Job Board).

**Treatment**:
What one authority does to a **Principle** or to another authority: follows, applies, distinguishes, overrules and the rest. Probanda records treatment per principle, on the link between an authority and a principle, so one case can follow one principle of a precedent and distinguish another. Citators record it per case. Every value and its definition are in `.claude/skills/shared/treatment-vocabulary.md` and nowhere else. Why Probanda departs from the citator norm: `docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md`.
_Avoid_: overturns (say overrules, reverses or superseded by statute); affirms for endorsing a principle (it means appellate history only: say approves or follows); considers and not_considered as opposites (considers is fact comparison, not_considered the oral-reasons note).

**Tribunal member**:
A decision-maker or registry officer the matter deals with: a judge, associate judge, arbitrator, tribunal member or registrar. A participant, never a party, with no role in a proceeding's style of cause.

**Unattended run**:
A `/draft` session the practitioner launches on one named Writing with nobody present. It takes at most one job, chosen by the server's eligibility predicate in queue order. It stops and reports wherever a session would pause for a human. It never outlines, takes over or creates a job.
_Avoid_: scheduled run; background worker; AFK (wayfinder's word); `/prepare` (not the worker).

**Unless-admitted guard**:
Two branches silence the evidence-side work for a postulate. An admission silences it only as against the admitting party; against every other party the postulate still needs proof. A court-record link (`facts.court_record`) silences it against all parties — the one silence that is not per party. Neither branch silences the capture and locate work on the admission instrument and its response (📑 📌 or 💬 🧷, the pair set by the route), their tender (🕹️), or the court-record link's own pinpoint (📌) — every proof path ends at a pinpoint.
_Avoid_: admitted = proven (true for one party, not the fact).

**Unstructured Writing**:
A Writing whose type has no declared layout yet. Its printed wording is drafted freely, and the practitioner gets the same review, revisions, Job Board and Word handoff as for any Writing. Once it is sent, it can be converted into a type with a declared layout, so the next Writing of that type is Structured. A form-bound writing with no specialist skill is drafted this way, its fixed wording copied from a saved copy of the published form.
_Avoid_: free-form (a different axis: a court form with no generator is Unstructured and form-bound); hand-written mockup (its mockup is still generated).

**Up-pointer**:
The one-way, local-only record "my local principle = cloud principle #N". The cloud holds no reciprocal pointer; a cloud ID, once minted, must resolve forever.

**Variant**:
A principle recorded, under the pool's earlier design, as another judge's wording of a point that a different principle already makes. In the pool it is a principle whose `variant_of` field names that other principle, with a note on the difference. Existing variants are kept, and a lookup of any member returns the whole cluster. The revised structure adds none: sameness of meaning is recorded between clauses instead.

**Venue**:
A body a lawyer appears before whose procedure a **Rule Set** governs: a court, an administrative tribunal or board, or an arbitral institution. It is named by its neutral-citation code where it has one, and otherwise by its full official name.
_Avoid_: court, tribunal (each names one kind of Venue).

**Venue source record**:
A record, for one **Venue**, of the most authoritative online source for the current text of its **Rule Sets** and practice directions, the place where changes to them are first announced, and when announced changes come into force. It never holds rule text.
_Avoid_: **Publisher map** (how one publisher issues instruments, whichever Venues use them).

**Verified**:
Describes whether the *extraction or classification* of a row has been quality-checked — nothing more. It does NOT mean the underlying fact is true, proven, admitted, or accepted by a court. A fact can be fully verified (the extraction accurately reflects what the source document says) while still being hotly disputed on the merits.
_Avoid_: verified as a synonym for "proven" or "true" anywhere in prose.

**Work Board**:
The practice-wide page (`Work Board.html` beside practice.db) showing the open work of every matter, billable or not, in four panels: Overdue, Due today, Coming up and Other open work. Its cards are deadlines, events and to-dos, each naming its matter and client. Written only by `practice_data__render_practice_board`, in the deadline lane (`shared/html-pages.md`, The Work Board). Its internal name is `practice_board`.
_Avoid_: Job Board (one board's page); `Work_board` (the Job Board's internal document type); Litigation Strategy (one matter's page).

**Work marker**:
One emoji from a closed set, printed on a Mockup where a predicate over the database is true (an open jurisdictional-basis slot, an excerpt with no pinpoint, a fact with no witness…), each naming the work that finishes it. The compressed to-do list of a Writing. Deferred work counts (a reserved row awaits its deployment decision); only ⬜ means nothing started; an emoji that names no work is not a marker. Three types: **work** (we act), **event** (they or the world acted — reports that outcome and renders as prefix of the work it routed; several events may route the same work), **hold** (our posture — renders only in Held in reserve). Rules, tables and mis-readings: `.claude/skills/drafting-data/references/work-markers.md` (SSOT).
_Avoid_: badge (one marker); glyph; readiness decoration; checklist; status label (of our work — an event marker reports their outcome, never our progress).

**Writing**:
Any legal writing `/draft` drafts in a proceeding: a Filing, a demand letter, a letter to opposing counsel, a memo to file. It carries its own metadata, its selection and order of the proceeding's shared substance, and its mockups. Every Writing belongs to exactly one proceeding, which may have no forum. Every Writing is either **Form-bound writing** or **Free-form writing**. On a separate axis, every Writing is either a **Structured Writing** or an **Unstructured Writing**. A client letter is not a Writing: it is solicitor-client material, drafted from guidance only, with no Job Board or Goal card. Internal names are unchanged: a Writing is stored as a `filings` row, with its `kind` values, except that a `filings` row of the reserved kind `task-board` is a **Standalone Job Board** and never a Writing. Lowercase "filing" in this glossary means only the act of delivering a Writing to a registry or forum, never the Writing itself.
_Avoid_: filing for a Writing (filing is the act of delivery to a registry or forum); document (reserved for the evidence-side **Document**); draft (a rendered-for-review file of a Writing).

**Writing Job**:
A job tied to one Writing (`tickets.filing_id` that Writing's id), drawn only on that Writing's Job Board and untagged. A job on a **Standalone Job Board** names that board's id and is neither a Writing Job nor a **General Job**.
_Avoid_: filing job; Writing-scoped ticket.

**Written Argument**:
The VanIAC Writing member that carries the submissions. Not a prescribed court form.
