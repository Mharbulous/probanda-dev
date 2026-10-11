# Terms & symbols — drafting-data vocabulary

Goals:
- Symbols self-documenting of meaning and of symmetry to other symbols.
- Symbols mapping naturally to plain language — clean LLM ↔ human communication.
- Plain-language terms mapped to precise technical meanings — exact LLM/script interpretation.

Naming rules:
- One concept, one symbol — languages differ only by syntax (snake_case SQL/Python, camelCase TypeScript, spaced prose).
- A child keeps its symbol wherever a reflection of the square preserves its meaning; distinct only where meaning changes.
- Backend matches lawyer language first; wording improvements never break the match. work-markers.md edits are gated: practitioner + Fable.
- Id-trace HTML comments (`<!-- label N -->`) follow one rule everywhere they're stamped (#379): a bare label + number is positional, matching the printed ordinal the reader sees on that line, with the label in the form's own vocabulary (`order`, `submission`, `fact` ...); an `_id`-suffixed label + number is a database row id with no printed ordinal to match, and the label names the schema table (`order_sought_id`, `fact_id`, `law_assertion_id` ...). The top-of-document `<!-- filing F proceeding P -->` provenance comment is exempt -- always database ids, no positional counterpart.

## The square

```
                                                PETITUM (the order sought)
                                                   ▲  served by ×N
                 FACTS         LAW              SUBMISSIONS (mixed fact & law)
  ASSERTION      postulate  +  proposition   =  contention
  SUPPORT        evidence   +  authorities   =  argument
```

Rows: same role, three domains — support markers ↩️ 👃 🏷️ attach identically to facts and law; the excerpt and pinpoint markers split by basis (📜 📍 authority · 📑 📌 exhibit · 💬 🧷 testimony). Columns: one relation each time — an assertion is supported by evidence ⊕ authority, through an excerpt, at a pinpoint; every path ends at a pinpoint. Diagonals: none — an authority never proves a fact, a witness never establishes law. The third column is built from the first two: a contention (law applied to fact — the position one side argues for) is supported by its argument, which is the postulates it rests on and the propositions it requires, each supported in its own domain only. Nothing in the first two columns supports a contention directly.

Above the square: the **petitum** — the order sought, the answer to "what do you want the tribunal to do?" (grant judgment ⊕ dismiss the claim — side-neutral by design). The square is entirely reasons; the petitum is the only ask, and it never sits inside a submission — it is a request, not an assertion. One petitum is served by many submissions and one submission may serve several petita, so the ask lives once, on its own node: `order_sought ─ served_by → submission ×N` (Consumers). Filed advocacy has the same shape — Form 32 states the order sought in its own Part, and a Written Argument's prayer for relief stands apart from its numbered submissions. The assertion-over-support shape repeats one level up: petitum : submissions :: contention : argument. Backend symbol stays `order_sought` (lawyer language); *petitum* names the concept.

## Trees

### `facts` — fact-domain assertions

```
facts
└─ assertion (×N)
   ├─ postulate              # the lawyer's wording — statements support it in their own words
   ├─ (reserve)              # derived: deployed by no document of the filing ⇒ 🂡
   ├─ adverse                # 0 ⊕ 1 ⊕ ∅ ; 1 ⇒ 🚩 — practitioner-set, orthogonal to (reserve)/deployment (#390)
   ├─ court_record           # → document ⊕ ∅ — the court document that proves the fact, conclusive against all parties (v8, #362) ; set ⇒ silences 👤 for every party (unless-admitted guard)
   ├─ court_record_pinpoint  # ∅ with court_record set ⇒ 📌 ; cites an exhibit letter the sworn court record may not hold (its exhibit_letters ∅, unparseable or lacking the letter, or the pinpoint's Exhibits list malformed) ⇒ 📌 (v56)
   └─ proof                  # no statement ∧ not admitted by a party ⇒ 👤 (per party) ; 👤 ∧ suppressed by counsel ⇒ 🤫 in its place (v69 marker_suppressions; the requirement stands)
      ├─ statements (×N)
      │  ├─ excerpt          # ∅ with exhibit ∅ ⇒ 💬
      │  ├─ exhibit_excerpt  # ∅ with exhibit set ⇒ 📑 (v25, #502)
      │  ├─ pinpoint         # into instrument ; ∅ with instrument set ⇒ 🧷
      │  ├─ exhibit_pinpoint # into exhibit ; ∅ with exhibit set ⇒ 📌 (v25, #502)
      │  ├─ doubt            # ≠∅ ⇒ 👃
      │  ├─ witness          # → witness (NOT NULL — #320/#328)
      │  ├─ instrument       # → document(instrument) ⊕ ∅ ; ∅ ∧ interviewed ⇒ ✍️ ; its execution ⇒ 🖋️ ⊕ ✒️
      │  ├─ exhibit          # → document ⊕ ∅ (the document this statement tenders as proof — #330)
      │  ├─ (basis_of_knowledge) # 👀 ⊕ ℹ️ — transmission, untracked (no column); renamed off `source` 2026-09-20 (#718) so the fact and law nodes stop sharing a name
      │  ├─ interviewed      # 0 ⊕ 1 ; 0 ⇒ 🗣️
      │  └─ purpose          # impeachment ⇒ 🤥 (Counsel Brief only)
      └─ admissions (×N)     # ∄ law ; one row per party per method
         ├─ party            # → party ; UNIQUE(assertion, party, method)
         ├─ method           # notice_to_admit ⊕ pleading ⊕ interrogatories ⊕ oral
         ├─ exhibit          # → document ⊕ ∅ (document whose foundation fact is admitted — mirrors statement.exhibit, #330)
         ├─ instrument       # → document ⊕ ∅ — the admission instrument (our NtA / our pleading / interrogatories / transcript; #327)
         ├─ instrument_pinpoint # ∅ past 🤝 ⊕ ⏰ ⇒ per method (NtA ⊕ pleading: 📌 ; interrogatories ⊕ oral: 🧷)
         ├─ response_due     # 📅
         ├─ response         # → document ⊕ ∅ ; set whenever answer is set (CHECK) ; set with answer ∅ ⇒ per method (answer, below)
         ├─ response_pinpoint # ∅ past 🤝 ⊕ ⏰ ⇒ per method (NtA ⊕ pleading: 📌 ; interrogatories ⊕ oral: 🧷)
         ├─ response_excerpt # Q ∧ A ; ∅ past 🤝 ⊕ ⏰ ⇒ per method (NtA ⊕ pleading: 📑 ; interrogatories ⊕ oral: 💬)
         ├─ answer           # agreed 🤝 ⊕ denied 🙅🏻‍♂️ ⊕ refused 🫸 ⊕ no_knowledge 🤷 ; ∅ with response set ⇒ per method (NtA: as no response ; pleading: 🤷)
         ├─ struck_on        # 📅 ⊕ ∅ ; ≠∅ ⇒ ⚡️
         └─ (state)          # ∅ ⊕ 🎾 ⊕ ⏳ ⊕ 🤝 ⊕ 🙅🏻‍♂️ ⊕ 🫸 ⊕ 🤷 ⊕ ⏰ ⊕ ⚡️ ⊕ 🕹️ ⊕ ✅ — derived, never stored
```

The three admission capture columns — `instrument_pinpoint`, `response_pinpoint`, `response_excerpt` — owe their markers only past 🤝 ⊕ ⏰: at either rung and through 🕹️ and ✅ (ladder below; full predicates in each symbol's `condition` in `symbol-table.ts`).

### `law` — the mirror

```
law
└─ assertion (×N)
   ├─ proposition            # the lawyer's wording — statements support it in their own words
   ├─ (reserve)              # derived: deployed by no document of the filing ⇒ 🂡
   ├─ dead_end               # 0 ⊕ 1 ; 1 ⇒ 🚧 — researched, nothing found
   └─ authorities            # no counted statement ⇒ 📖 (killed, overruled, failed count as none) ; a lead, none verified or settled ⇒ 🔬 ; researched, none ⇒ 🚧
      └─ statements (×N)
         ├─ excerpt          # ∅ ⇒ 📜
         ├─ pinpoint         # ∅ ⇒ 📍
         ├─ verification     # verified ⊕ lead ⊕ failed ⊕ settled ; lead ⇒ 🔬 ; failed ⇒ counts as none, finding in `doubt` (CHECK) ⇒ 👃, never reset by an edit ; settled ⇒ counts as support, finding kept, no 👃 ; verified or settled back to lead by trigger when authority, pinpoint or excerpt moves off its snapshot — NOT NULL, no default (v25; failed v46; settled v47)
         ├─ doubt            # ≠∅ ⇒ 👃
         ├─ authority        # → authority
         ├─ (document)       # → document ⊕ ∅ (the filed copy — the vehicle) — untracked, no column
         └─ source           # class: 🥇 ⊕ 🥈 ⊕ 🥉 ; ∅ ⇒ 🏅 — read off `authority.kind`, never off what the excerpt cites
                             # ∄ interviewed · purpose · admissions · instrument · exhibit
```

### `submissions` — mixed fact & law

```
submissions
└─ assertion (×N)
   ├─ contention            # the lawyer's wording — law applied to fact
   ├─ (reserve)             # derived: deployed by no document of any filing of the proceeding ⇒ 🂡
   ├─ killed_on             # 📅 ⊕ ∅ ; set ⇒ killed — the lawyer's rejection, kept as a breadcrumb; Counsel Brief only, never re-proposed; no marker
   └─ argument              # the support — factual + legal basis ; neither link required ; both ∅ ⇒ 🧾 📚, never clean: counsel may record one decision, never both (v60)
      ├─ rests_on → facts.assertion ×N    # factual basis; ∅ ∧ no_facts_needed_on ∅ ⇒ 🧾
      └─ requires → law.assertion ×N      # legal basis; ∅ ∧ no_law_needed_on ∅ ∧ not ordinary costs ⇒ 📚
```

One submission = one contention with its argument. The contention renders first, as a numbered paragraph carrying the submission's own id trace and any submission-level marker (restored by ticket 2026-09-01, reversing the 2026-08-31 Fable-reviewed removal, which had left law-only submissions with no printed point and law-free ones with no paragraph at all); one numbered paragraph per postulate the submission rests on and per proposition it requires follows, facts before law, each with its statements' excerpts and citations beneath it. Surfaces: a Written Argument's *Submissions*, Form 32 Part 3, Form 33 Part 5, the BCCA stay response book's Part 2 written argument at its *Part 3: Analysis*, the BCCA factum's Part 3, and the Counsel Brief. On the Form 32 and Form 33, every fact a submission rests on is placed in the filing's own facts part (Part 2 of the Form 32, Part 4 of the Form 33): while the Writing is drafting, the database places it there when the fact is attached or the submission is deployed on the form (schema v59), and the legal-basis part (Part 3 of the Form 32, Part 5 of the Form 33) prints the contention and its law, never fact text. On the mockup the contention line names each such fact by paragraph number in a `<!-- supporting fact paragraphs: N -->` comment after the id trace, and names a linked fact missing from the facts part `NOT PLACED` in the same comment. The filed face carries each fact once, in the facts part, and no comment — the comment is rendered for the human and withheld from the forum — and a drafting Writing with a fact not placed gets no filed face until the fact is placed or detached. A sent or retired Writing renders as it did before v59: a linked fact missing from the facts part prints in full under its submission, and the comment lists the numbers alone. No other surface dedupes facts: there, each `rests_on` link is its own paragraph. A submission may rest on facts only (a purely factual submission) or on law only (a jurisdiction submission) — a law-only submission still fires 🧾 on its contention paragraph until counsel records that it needs no stated fact (v48), and a fact-only submission fires 📚 there until counsel records that it needs no stated law (v60), unless it only asks for ordinary costs (the 📚 decision-log bullet) (fail-visible otherwise; neither marker reads which shape was intended, per work-markers.md #373). A submission resting on neither (both ∅ in the tree above) renders its contention paragraph alone, numbered like any other and carrying 🧾 and 📚 — it never silently disappears and never degrades to an unnumbered marker-only line; the markers render for the human on every mockup and are withheld from the filed face.

### Support objects

```
witness (×N)                 # the speaker
├─ identity                  # name · relationship
└─ (credibility)

document (×N)                # instrument (the witness's vehicle ⊕ the admission instrument) ⊕ exhibit ⊕ response
├─ identity                  # label · date · description ; ∅ ⇒ 🏷️ (derived instance — 🧩 precedent, #320)
├─ is_best_copy              # 0 ⊕ 1 ; no best in its label group ⇒ 🏆
├─ served_on                 # 📅 ⊕ ∅ ; ∅ ∧ is some admissions.instrument ⇒ 🎾 (never bare)
├─ instrument                # ∅ ⊕ witness_statement ⊕ affidavit
├─ deponent                  # → witness ⇔ instrument
├─ execution                 # 🖋️ ⊕ ✒️ ↦ executed ; ✍️ sits on the statement (no instrument yet)
├─ exhibit_letters           # the sworn version's exhibit letters as letters and ranges (e.g. A-J, or A-J, L), set with execution ; ∅ only while unknown ; read by a court-record fact's 📌 (v56)
├─ (exhibited_by)            # → document(instrument) ×N — untracked: read off each statement's instrument + exhibit pair
└─ (tendered)                # derived: ∃ statement.exhibit ∨ admissions.exhibit → it ; ∅ ∧ a filing selects it ⇒ 👤 on its own line (#330)

authority (×N)
├─ kind                      # case ⊕ statute ⊕ regulation ⊕ rule ⊕ doctrine
├─ identity                  # title · citation
├─ weight                    # binding ⊕ persuasive
├─ (verification)            # derived: a lead when no statement of it is verified or settled — the column sits on the statement of law (v25)
├─ treatment                 # ⚠️ ⊕ 🚨 ⊕ ⛔ ⊕ ✅ ⊕ ∅ ; ∅ ⇒ 📇 on a case — the outcome of the check (`check` is an SQLite reserved word, never a column; #327)
├─ treatment_note            # text ⊕ ∅ — the note-up return's coverage line and any qualification, verbatim, replaced by each return; ∅ = the return gave neither; no marker
├─ currency_status           # current ⊕ repealed ⊕ archived ⊕ not-found ⊕ validation_unavailable ⊕ ∅ ; statute ⊕ regulation ⊕ rule only — the statute-currency check's result as /legal-research relayed it; ∅ = never checked; anything but current (∅ included) ⇒ 📇 (noting up a statute, regulation or rule, shared/statute-currency.md)
├─ currency_checked_on       # 📅 ⊕ ∅ — when that result was relayed
├─ (best_copy)
├─ (reserve)                 # derived: supports nothing any document deploys ⇒ 🂡
└─ killed_on                # 📅 ⊕ ∅ ; set ⇒ killed — its statements ride the brief-only cap; never re-proposed; no marker
```

### Consumers — outside the square, selecting from it

```
order_sought    ─ requires    → law.assertion    # 🏛️ ; basis_state needed ⊕ filled ⊕ dead_end 🚧 ; the edge carries excerpt_id → statement of law, the citation the 🏛️ ladder reads
                ─ served_by   → submission ×N    # the petitum — ∅ ⇒ 🦵
                ├─ crossed_out_on                # 📅 ⊕ ∅ ; set ⇒ crossed out — strikethrough + cascade
                └─ (reserve)                     # derived: deployed by no document of any filing of the proceeding ⇒ 🂡
opposing_orders ─ anchored_to → document         # the applicant's sought orders, verbatim (Form 33, #372)
relief          ─ groups      → order_sought ×N  # open decision — not realized
document        ─ deploys     → fact · submission · order_sought · rhetorical_paragraph · opposing_orders ×N  # ordered pointer list
filing          ─ renders     → form ⊕ written_argument ⊕ (counsel_brief derived)
clause          ─ selected_by → filing ×N        # `clauses` + `filing_clauses` (v31); express ⊕ implied (`basis`); express: `document` + `pinpoint` + `excerpt`, pinpoint ∅ ⇒ 📌, excerpt ∅ ⇒ 📑 ; implied: `excerpt_id` → statement of law ⊕ ∅, that statement's pinpoint ∅ ⇒ 📍, a lead ⇒ 🔬 ; 🧐 on the clause line (#1122/#1158)
prose-cited statement ─ cites → statement of law  # `filing_law` (v36): a Writing's own text cites it; 📜 📍 🔬 🏅 on its mockup-only *Authorities cited* line, withheld from the sent face (#1214)
prose slot      ─ of          → filing           # `filing_prose`: one slot of a Writing's own text; no text ⇒ 🧩 `<name> not written` ; 🧐 once, on its last line (#1207)
opposing_point  ─ answered_by → submission       # ∅ ⇒ ↩️
anticipated_point                                # our own prediction, not theirs — existence ⇒ 🚩; no edges but the advisory rebuts link, never deployed, never read by 🂡 (#390)
submission      ─ rebuts      → opposing_point ⊕ anticipated_point ×N  # v65, many-to-many; advisory, neither complete nor exhaustive — never coverage, never clears ↩️, never reads ∅ as unanswered; the Arguments view page labels a live (unkilled) reserved submission (🂡) a rebuttal, which is not ↩️'s "rebuttal needed"
rhetorical_paragraph ─ links → submission · opposing_point · fact · law.assertion · record (document + pinpoint + excerpt) ×N, every link optional  # v71; persuasion from the record that fits no other type; placed by `filing_rhetoric` (document, part facts ⊕ submissions ⊕ orders, ordinal on the host part's scale); advisory, never coverage — clears no ↩️ 🧾 📚; 🧐 on its line; reserve as a submission (🂡, #959); abandoned by scripted delete of placements, links and row, no `killed_on`; label and tells are text (rule 5): `(rhetorical)`; `(states law, no authority linked)` (drafter-recorded `states_law`, no law link); `(states fact beyond its record)` (drafter-recorded `states_fact`, no record or fact link), all stripped from every filed face
gaps            ─ attaches    → *                # 🧩 🏷️ 🕵️ ⬜
```

### Deployment — documents, reserve, crossed out

Each advocacy document of a filing (venue form; Written Arguments; further kinds additively) carries its own **ordered pointer list** into the proceeding pool — membership and paragraph order are one fact; each document numbers sequentially from its own pointer order. The **Counsel Brief** is derived: the whole pool annotated with deployment; never a pointer list, never delivered.

Three orthogonal axes. **Deployed** — some document of the filing points at the item; deployed by no document of any filing of the proceeding ⇒ 🂡 *held in reserve*, derived, never stored: drafted, deployed nowhere, Counsel Brief only. An order, submission or rhetorical paragraph (v71) deployed only by another filing of the proceeding, in any state, is not reserved: the Counsel Brief lists it marker-free (a crossed-out order keeps its strikethrough) under *used on other filings*, naming that filing and its state (#959). Facts and law assertions keep the filing-scoped predicate. **Pursued** — `crossed_out_on` ∅; set = **crossed out**: the lawyer's decision not to pursue the order — kept, visible, restorable (clear the date). **Killed** — `killed_on` ∅; set = **killed**: the lawyer's rejection of a submission or an authority after review — kept, wording and excerpts intact, so no later session re-proposes it; restorable (clear the date). Killing a submission removes its pointer rows in the same write — the one act that touches pointers — so a killed item is reserved by construction; a killed authority keeps its statements of law, which ride the brief-only cap as a lead or failed statement (`statement.verification` `'lead'` ⊕ `'failed'`) does — printed in the Counsel Brief only — but unlike leads they count toward no marker and their own lines carry none (work-markers §4 → Killed). A settled statement (`'settled'`, v47) rides no cap: it prints as a verified one does (Rendering). Killed ⊂ reserved; reserved ⊄ killed — 🂡 alone still means the deploy-or-abandon decision is pending, and a killed item carries no 🂡. Not a marker (work-markers rule 5, as crossed out). Deploying and crossing out never touch pointers.

**Cascade** (derived, never stored): a deployed submission renders struck when it serves ≥1 order and every order it serves is crossed out; a deployed fact or law assertion renders struck when ≥1 submission rests on / requires it and every such submission is struck. Serving nothing ⇒ no cascade.

**Rendering:** struck-through material renders on mockups only. Venue form: inline, in place, unnumbered. Written Arguments: below the numbered paragraphs, unnumbered, each with a reference to the crossed-out order it supports. Counsel Brief: reserved items split the same way by the orders they serve. Every delivered face omits crossed-out material; live paragraphs number contiguously, identically on mockup and delivered face — *delivered whole minus mockup-only material* (amends #370's no-content-stripping wording). Killed: Counsel Brief only, under *Killed submissions* / *Killed authorities*, one line each with the date, plain text (strikethrough belongs to the crossed-out axis); no venue mockup shows it — decided, not work. A killed authority's statements also print under their proposition, riding the brief-only cap, and there the statement's citation carries the same date as a plain-text `(killed <date>)` tag — the line renders no marker, so without it a rejected authority reads as sound support (work-markers §4 → Killed). An overruled authority's (`treatment='overruled'`) statements ride the same cap; there ⛔ on the statement's own line is the tell in place of the tag (work-markers §4 → Overruled; §1 → Overruled). A failed statement (`verification='failed'`) rides the same cap; its tell is the plain-text `(scrutiny failed: <finding>)` tag on its citation line beside 👃, on its proposition's line, and on any implied clause line citing it, each stripped from the filed face (work-markers §1 → Failed). A settled statement (`verification='settled'`, v47) does not ride the cap: it prints on the filed face by counsel's confirmed call over the finding, never withheld from a filed face — counsel's call, not unverified material reaching the forum — and its tell is a plain-text `(settled by counsel <date> over scrutiny finding)` tag on every mockup line it prints on, stripped from the filed face (work-markers §1 → Settled). An implied clause whose wording names the enactment its cited statement rests on, while that authority's `currency_status` is anything but `current` (∅ included), carries a plain-text `[currency: <value>]` tag on its mockup line (`unchecked` for ∅) — rendered for the human, withheld from the forum: the filed render refuses rather than print the line (release.md → Legislation citations; rule 5 — text, not a marker). An authority with a `treatment_note` carries a plain-text `(note-up: <note>)` tag on each of its statements' citation lines on the mockup — rendered for the human, withheld from the forum: the filed-face strip removes it (rule 5 — text, not a marker).

**Outside the pool (#390):** `anticipated_points` carries no deployment state and is never pointed to by any document — it must never be read by 🂡's "deployed by no document" predicate, which would otherwise fire vacuously on every row (nothing ever deploys a prediction). Its own posture (🚩 *adverse*, Deployment → Markers) is a separate, orthogonal axis, not a form of reserve — an adverse fact can itself be deployed, even disclosed, and still carry 🚩 (relationships → adverse orthogonal).

*Crossed out* is the lawyer's own act; *struck* ⚡️ remains the court's act. Strikethrough styling is the rendering — deliberately no emoji: it names a decision made, not work (work-markers rule 5).

### Legend — symbols

| Symbol | Reads | Symbol | Reads |
|---|---|---|---|
| `(×N)` | repeats under parent | `∄` | absent by design — no twin, no row |
| `→ X` | FK to one X | `( )` | derived or untracked — no column |
| `⊕` one · `∨` one+ · `∧` both · `¬` not | connectives | `0 ⊕ 1` | boolean · `📅` a date |
| `∅` / `≠∅` | NULL / set | `·` / `;` | within-node / values-vs-marker separator |
| `⇒` | left holds → right renders | `*` | any node · `Q ∧ A` one field |
| `↦` ladder rung · `⇔` iff — set together | | `⚡️ suffix` | composes with the state it struck |

### Legend — emojis

The work, event and hold emojis are listed in `plugins/litigation/mcp/src/submission/forms/symbol-table.ts`, one row per symbol; that file is the single source.

| Type | | Reads | | Reads | | Reads |
|---|---|---|---|---|---|---|
| values | 👀 | personal knowledge | ℹ️ | information and belief | | |
| | 🥇 | primary | 🥈 | secondary | 🥉 | tertiary |
| | ✅ | clean — nothing renders, ✅ never prints | | | | |

🥉 / 🥈 double as work markers — *only tertiary* / *only secondary*, the best-`source` rung of a proposition's statements of law (each one's `condition` in `symbol-table.ts`) — alongside their `statement.source` values, as ⚠️ 🚨 ⛔ are likewise stored values and markers. 🏅 *unrated* is a marker only, never a value: it renders law-side `source` ∅ — on the statement line, that row; on the proposition line, the rung undeterminable (no 🥇 rated ∧ ≥1 unrated), not a lower rank.

🚩 *adverse* (hold: harmful to our own position) is unrelated to *adverse treatment* (⚠️🚨⛔: an authority's citator outcome, work-markers.md diagram 7b) — same English word, distinct concepts, never sharing a line.

## Admissions — ladder

One derived state per party per method per assertion per moment, from the `admissions` row + the admission instrument's `served_on` + the response document's date — never stored. Every rung from ⏳ to ⚡️ is an **event** (work-markers 1b), 🕹️ is work and ✅ never prints: an event renders as prefix of the work it routed (⏰→📑📌🕹️ on a notice to admit, 🙅🏻‍♂️→👤) and clears when that work begins (🤫 is the exception: counsel's own act, printed in place of the work it sets aside, work-markers §1 → Suppressed); 🙅🏻‍♂️ 🫸 🤷 are three events because they report three states, even though all route the same work. ⚡️ follows the same rule (⚡️→⏳ when a new `response_due` is set, else ⚡️→👤) — no suffix convention.

| Rung | Derivation | Meaning |
|---|---|---|
| ∅ | `instrument` ∅ | not sought from this party |
| 🎾 | `instrument` set ∧ `response` ∅ ∧ `served_on` ∅ | drafted — serve it (oral rows are born answered: 🎾 ⏳ never apply) |
| ⏳ | served ∧ (`response` ∅ ∨ `struck_on` set) ∧ `response_due` unexpired — precedes ⚡️ | response period running, first or court-reset |
| 🤝 🙅🏻‍♂️ 🫸 🤷 | `response` in time (its date ≤ `response_due`, or pleading route before judgment entered) ∧ `struck_on` ∅ ∧ `answer` = agreed / denied / refused / no_knowledge; pleading ∧ `answer` ∅ ⇒ 🤷 | 🤝 admitted; the rest ⇒ prove by evidence |
| ⏰ | served ∧ `response_due` passed ∧ (`response` ∅ ∨ `response` late per method ∨ NtA `answer` ∅ ∨ `struck_on` set) ∧ (`struck_on` ∅ ∨ `response_due` > `struck_on`) | deemed — successor per method (table below); derived, never stored |
| ⚡️ | `struck_on` set ∧ `response_due` ≤ `struck_on` — event, prefixes ⏳ ⊕ 👤 | struck; new `response_due` ⇒ ⏳, else prove by evidence |
| 🕹️ | (🤝 ⊕ ⏰) ∧ no filing selects the response ⊕ affidavit of service | put it before the tribunal (tender — see Adduce) |
| ✅ | 🕹️ cleared | done |

| Method | `instrument` / `response` | Capture | ⏰ deemed ⇒ | Late response | Silent on an item |
|---|---|---|---|---|---|
| notice to admit | notice / its response | `instrument_pinpoint` = item; `answer` classifies | admitted | recorded only; state unchanged | as no response ⇒ ⏰ admitted |
| pleadings | our pleading / their Response | `instrument_pinpoint` = paragraph | admitted, withdrawable: 🕹️ = default-judgment requisition; ✅ = judgment entered | before judgment entered: reverts to `answer`; after: no effect | 🤷 |
| interrogatories | interrogatories / sworn answers | `response_excerpt` Q∧A — primary capture; `answer` classified from it | bare ⏰ — practitioner classifies (undefined route) | — | — |
| oral examination | transcript ⊕ court record (both pointers, same doc) | pinpoints = Q and A page/line ⊕ timestamp; tendered by reading in 🕹️ | born answered: 🎾 ⏳ ⏰ never apply | — | — |

(2026-08-22 grill, practitioner: the deemed consequence is a property of the route; one ⏰ everywhere, successor per method.)

## Axes of reliability

| Axis | Question | Fact | Law |
|---|---|---|---|
| Transmission | hands between thing and forum | `statement.basis_of_knowledge`: 👀 personal knowledge ⊕ ℹ️ information and belief (hearsay) — untracked today | ∄ — a case citing an earlier case for the same principle is still 🥇 (Class) |
| Class | what speaks — the law itself, or writing about it? | ∄ — a witness has no class | `statement.source`: 🥇 primary ⊕ 🥈 secondary ⊕ 🥉 tertiary ; ∅ ⇒ 🏅 — read off `authority.kind` |
| Inference | proves without inferential step? | direct ⊕ circumstantial — untracked | (on point ⊕ analogous) — untracked |
| Execution | forum-accepted form? | statement `instrument` ∅ ⇒ ✍️ ; `document.execution` 🖋️ ⊕ ✒️ | 🔬 is the law-side rung: `statement.verification` lead ↔ an unexecuted instrument |
| Weight | must tribunal accept it? | (rhyme only: admission ⊕ court record = conclusive proof) | `weight`: binding ⊕ persuasive |

Two ladders, opposite directions (practitioner, 2026-09-20, [#718](https://github.com/Mharbulous/CoClerk/issues/718)). Fact — **direct evidence > circumstantial evidence > hearsay evidence**: every hand between the thing and the forum weakens the account; a witness relaying another's observation is ℹ️ however direct the informant's observation was; ℹ️ is licensed only by naming the informant. Law — **primary authority > secondary authority > tertiary authority**: a later case that cites an earlier case for the same principle is 🥇 for it, and the stronger for citing its predecessor — the citing court's adoption is added, nothing is lost; 🥈 is never earned by quoting. The fact words span two axes (Direct — one word, two axes): *direct / circumstantial* is inference, *personal knowledge / hearsay* is transmission; the three-word order is the practitioner's ranking of evidential value, not a third column. Vocabulary never crosses domains: a case is never *hearsay* for quoting a case; a witness is never *secondary*. Execution keeps its shared shape: sworn ↔ verified, unsworn ↔ lead.

**Banned terms** (practitioner, 2026-09-20, #718 — each invites the crossing this section forbids): *primary evidence*, *secondary evidence*, *tertiary evidence*, *primary source*, *secondary source*, *tertiary source*, *direct authority*, *indirect authority*, *hearsay authority*. Where the authentic text of an authority is meant — as against metadata, a summary, or a reproduction quoted inside another decision — say **the authority's own text**.

Placement (2NF on the link): attributes varying with the (assertion, support) pair — excerpt, pinpoint, verification, doubt, source, purpose, interviewed — sit on the statement; those depending on the support object alone — kind, execution, identity, credibility, check — sit on the object (`evidence_uses.sworn_status` was the live violation until v3). Transmission sits on the statement (fact only: a witness can be first-hand on one fact, hearsay on another). Class is a function of `authority.kind` (case · statute · regulation · rule ⇒ 🥇; doctrine ⇒ 🥈; finding aid ⇒ 🥉, no kind yet — Open decisions): a case is 🥇 for every proposition it is cited for, its own holding and the earlier holding it adopts alike, never 🥈 for reciting. By this paragraph's own rule that puts `source` with the object's attributes; it stays on the statement today as a stored value (v9, [#365](https://github.com/Mharbulous/CoClerk/issues/365)) — deriving it is open, not settled. Displaced twin: check sits on the authority — fact side untracked, no mechanical citator for witnesses. Speaker ≠ vehicle in both domains: witness says it, the instrument carries it; authority says it, the filed copy carries it — fact statement → `witness` + `instrument` + optional `exhibit`; law statement → `authority` + optional `document` (untracked). Two pointers on the fact side because `pinpoint` targets the instrument and a witness may have several (`affidavit_number`); deriving the vehicle through `deponent` was ambiguous (2026-08-22).

`tier` conflates three axes → `weight` (its only remaining job) + `verification` (`'verified'` ⊕ `'lead'` ⊕ `'failed'` ⊕ `'settled'` ; lead ⇒ 🔬 ; failed counts as none, v46 ; settled counts as support, v47) + `source` 🥇 ⊕ 🥈 ⊕ 🥉 (`'doctrinal'` → 🥈 — *doctrinal* collides with 📖).

## Doubt 👃 — one marker, two words, true mirror

Seats on the statement, never the assertion; one emoji, both domains, named per domain — *dubious* (doubtful legal basis) on the law side, *suspicious* (doubtful facts) on the fact side (settled). Modes (fact / law): withdrawn (recanted / overturned ⛔) · wrong at the source (mistaken / wrongly decided) · outweighed (better witnesses / conflicting cases) · misread (both) · misattributed (didn't say it / cited for what it doesn't say) · out of time (no knowledge at material times / statute not in force). Usually triggered by the other side's cited statement, but one's own witness can recant, own authority fall. A failed scrutiny (`verification='failed'`, v46) is doubt in the *misattributed* or *misread* mode: the research lawyer's return that the excerpt does not support the proposition (fit) or is not the court's own reasoning (ratio), written into `doubt` from that return. It is the one 👃 whose work is a decision, not a check: the statement's scrutiny review job, closed only on counsel's confirmation of a change, a keep over the finding, or a drop — and the noting-up sweep never re-dispatches it (work-markers §1 → Failed). A settled statement (`'settled'`, v47) keeps the finding in `doubt` as the record and raises no 👃 (work-markers §1 → Settled).

Doubt ≠ check: *check* is the vetting act — *note up* an authority, *check sources* on a witness or document; its outcome is the authority's `treatment` column on a case, `currency_status` on a statute, regulation or rule (`check` is an SQLite reserved word and is never a column name — #327); `treatment` ∅ = *not yet noted up* — workflow, not doubt — renders 📇 **note up** on a case (work, law side only; settled 2026-08-22, reversing #305 Amendment 10's reuse of 👃); a statute, regulation or rule is noted up by its currency result instead, and an authority of kind doctrine is never noted up (shared/statute-currency.md → Noting up legislation); ⛔ grounds the *withdrawn* mode. Scrutiny is a check too, but its negative outcome is a reasoned ground against the statement rather than a citator value, so it lands in `doubt`, not in a column.

## Kind — the vehicle symmetry

| Vehicle | Fact | Law |
|---|---|---|
| spoken word | viva voce testimony (unmodelled today) | case authority |
| executed instrument | affidavit | statute |
| siblings | witness statement — executed stand-in for viva voce (arbitration) | regulation ⊕ rule |
| outside the pair | unsworn — execution axis | doctrine — class axis (🥈) |

Seat: `document.instrument` / `authority.kind` — mirrored on the support object.

## Direct — one word, two axes

Standalone *direct* = the inference sense (vs circumstantial, untracked). The transmission sense is said as *personal knowledge* 👀 / *first-hand* — the jurat's own language. Orthogonal: a first-hand observation can be circumstantial (saw the muddy boots, not the trespass); a hearsay report can be direct. The practitioner's fact ladder (*direct > circumstantial > hearsay*, Axes of reliability) is his ranking of evidential value across both axes, not an instruction to merge them — "the foreman told me he saw the truck hit the wall" is hearsay and direct at once, and a single rung has nowhere to put it.

## Tertiary 🥉 — a finding aid

Material that points at authority and is never itself cited: encyclopaedia, digest, headnote, citator summary, blog or web commentary, AI summary. A 🥉 statement says the proposition rests on a pointer to law, not on law — *only tertiary* routes the research lawyer to the authority it points at. Not `verification='lead'` (Execution): a finding aid can be verified and still uncitable; a lead can turn out to be 🥇. Not the sweep's "tier-3 lead" (broad-sweep journey) — same numeral, different axis. Today no `authority.kind` yields 🥉 (Open decisions), and a case can never be tertiary.

## Adduce — elicit ⊕ tender

Plain language (practitioner, 2026-08-23, #327): **adduce** is to put evidence into the trial record at trial. Adduce has two forms: **elicit** means adducing viva voce evidence from a witness; **tender** means entering affidavits or documents into evidence. Tender is not only for affidavits, because some tribunals do not require affidavits.

In the trees, *tender* is one act with two objects: a statement of fact tenders its `exhibit` (#330), and 🕹️ tenders the admission instrument and its response as proof of the admission. Elicited evidence (viva voce testimony) is unmodelled today (Kind table).

## Instrument — one word, two vehicles

*Instrument* names the executed or served document through which something reaches the forum, in both senses the practitioner uses it: the **witness's instrument** — the affidavit or witness statement carrying the statement of fact (`statement.instrument`, execution 🖋️ ⊕ ✒️) — and the **admission instrument** — the notice to admit, pleading, interrogatories, or examination transcript through which an admission is sought (`admissions.instrument`, service 🎾). Kept as a two-word term on the admission side: no single word covers the four methods (practitioner, 2026-08-23, #327). Both pointers → document.

## Invariants and deliberate breaks

Invariant under both reflections: `assertion` · `statement` · `excerpt` · `pinpoint` · `kind` · `reserve` · `doubt` · check (the act; column `treatment` or `currency_status` on the authority, untracked on the fact side).

Breaks:
- *source(s)* container/pointer retired (appeared twice per tree): containers → `proof` / `authorities`; pointers → `witness` + `document` / `authority`; `source` now names the law statement's **class** column 🥇 ⊕ 🥈 ⊕ 🥉, and the fact node is `basis_of_knowledge` 👀 ⊕ ℹ️ (untracked) — two axes, opposite directions, no shared name (Axes of reliability, #718).
- Transmission: fact only — a citing case gains, never loses. Class: law only — a witness has no class.
- `instrument` / execution ladder: fact only — published law arrives already executed.
- `admissions`: fact only — a concession of law binds no tribunal (work-markers §6).
- Untracked blanks (not missing symbols): fact `basis_of_knowledge`, law statement `document`, witness credibility check, authority `best_copy`.
- 🏅 *unrated*: law only — the fact side's `basis_of_knowledge` is an untracked blank (above), so no fact-side twin.
- `killed_on`: submissions and authorities only — no fact-side twin (no journey names a reader for a killed fact or witness); `reserve` stays invariant under reflection, killed does not.

## Markers — emoji ↔ predicate

Admission emoji (🎾 ⏳ 🤝 🙅🏻‍♂️ 🫸 🤷 ⏰ ⚡️ 🕹️ ✅): predicates in the ladder above; 🎾 and 🕹️ are work, the rest events, ✅ never prints.

| | Predicate |
|---|---|
| 🏛️ | `order_sought.requires(law.assertion).basis_state='needed'`; also, derived per edge, a `filled` edge whose authority is killed or whose statement is `'failed'` — the basis reads as needed again (work-markers §4, §1 → Failed); a `'settled'` statement fills, as a verified one does (work-markers §1 → Settled) |
| 🂡 | derived, never stored: pool item deployed by no document of the filing — for an order, submission or rhetorical paragraph, of any filing of the proceeding (#959; rhetorical paragraph v71) (authority: supports nothing any document deploys) |

The other markers' predicates are each symbol's `condition` in `plugins/litigation/mcp/src/submission/forms/symbol-table.ts`, one row per symbol; that file is the single source.

## Seams — glossary

| Term | Meaning |
|---|---|
| work / event / hold | the three marker types — who does the verb, when (`marker_type`) |
| unless-admitted guard | fires when the party the proof is against has admitted (derived state 🤝 ⊕ ⏰ ⊕ 🕹️ ⊕ ✅, ladder above; ADR-0006) ∨ `facts.court_record` set; silences the evidence-side ladder — an admission only as against the admitting party, the court record against all parties (work-markers §2). The admission instrument and its response keep 📑 💬 📌 🧷, the court-record link 📌 (each symbol's `condition` in `symbol-table.ts`) |
| silenced / clean | predicate holds, nothing renders / no marker renders — implicit `""` in code |
| ladder / rung / entry / terminal | lifecycle; one marker per object per moment; 🚧 the only terminal |
| track | parallel stacking lifecycle (document's 🖋️ ✒️ 🏆) |
| mirror | fact–law twin: same emoji, same work |
| held in reserve | derived, never stored: a pool item deployed by no document of the filing — for an order, submission or rhetorical paragraph (v71), of any filing of the proceeding; one deployed only on another filing is listed, not reserved (🂡; #959) — renders only in the Counsel Brief, for the human, withheld from the forum. The #367 court-form exception (reserved order inline, crossed out) is superseded by the crossed-out axis (Deployment) |
| deployed | some document of the filing points at the pool item — membership and paragraph order are one fact, the document's ordered pointer list (Deployment) |
| crossed out | `crossed_out_on` set — the lawyer's decision not to pursue an order; kept, visible, restorable (clear the date); mockup-only strikethrough + derived cascade (Deployment) |
| killed | `killed_on` set — the lawyer's rejection of a submission or authority, kept intact so no later session re-proposes it; restorable (clear the date); Counsel Brief only, no marker (Deployment) |
| unrated | law-side `statement.source` ∅ — not yet placed on the class axis; 🏅 is the marker on the blank, never a fourth value (Axes of reliability) |
| unmarked live value | a live value no marker claims — falsely reads finished |
| routed work | an event emoji prefixes the work it routed (⏰→📑📌 on a notice to admit) and clears when that work begins; several events may route the same work (🙅🏻‍♂️ 🫸 🤷 → 👤); 🤫 is the exception: counsel's own act, printed in place of the work it sets aside (work-markers §1 → Suppressed) |
| exclusive ⊕ / inclusive ∨ / both ∧ | the connectives (work-markers' "one-hot" — gated rename) |

## Aliases — state-mapped

Exact synonyms: passage, quotation, verbatim words = `excerpt` · pin cite = `pinpoint` · deponent = affiant · petitum = `order_sought` (the ask — side-neutral; BC-glossary synonym: *invitation*) · cross out = strike out (the lawyer's own act) — never ⚡️ *struck* (the court's).

Claim = the claimant-side petitum + the contentions serving it — assertion row and capstone only, no support. A claim contains no evidence and no authorities; those arrive at the proof stage, which is the support row. Not a synonym for `assertion` (alias struck 2026-08-23).



## Drift register

| # | Conflict | Reconciliation |
|---|---|---|
| 1 | work-markers reads `tier=3` (work-markers §1c); CHECK stores named values — predicate never fires | resolved 2026-08-23 (#346): work-markers now reads `verification='lead'` (tier split) |
| 2 | `slot_state='requested'` listed as unmarked live; no such v2 value | stale (#300); dropped (#346) |
| 3 | `witness_id` "struck v2 (D3)" per doc; schema retains it, markers.ts reads it (🗣️ 🖋️) | resolved 2026-08-22: #320/#328 keep it and make it NOT NULL; the doc's "struck" claim was wrong — trees updated, work-markers line fixed (#346) |
| 4 | markers.ts header claims doc predicates basis pair on `basis_kind` | resolved 2026-08-24 (#363): header rewritten, no longer claims the exception |
| 5 | 👃 = *suspicious* (work-markers) vs "not yet noted up" (filing-checklists) | resolved 2026-08-22: doubt = *dubious* (law) ⊕ *suspicious* (fact); "not yet noted up" = `treatment` ∅ ⇒ 📇 note up (ADR-0007); work-markers edit applied (#346) |
| 6 | `filing_facts.section` vs glossary/Form 32 (*Part*) | resolved 2026-08-26 (#380): renamed `part` in the v10 rebuild |
| 7 | `statements_of_law.source` CHECK permits `'tertiary'`; `AUTHORITY_TIERS` (`.codex\skills\case-data\scripts\application_state.py`) has no tertiary and its comment says tertiary is unrepresentable; submission `authorities.kind` has no tertiary kind | open (#718): definition landed in Tertiary 🥉; widening `kind` or narrowing the CHECK is a hop decision. Note that file is the **frozen** Codex mirror of a surface retired 2026-08-27 (#374) — the mapping's only written record was retired code, which is why the wrong reading won by default |
| 8 | Naming rules' id-trace rule says an `_id` label names its schema table, yet four renderer sites still stamp `relief_item_id` — `projections.ts:168`, `render-companions.ts:266`, `render-requisition.ts:243` and `:272` (parsed at `forms.ts:693`) — while `relief_items` became `order_sought` at v10 (#380); the Counsel Brief, BCCA stay response and factum stamp `order_sought_id` | open (2026-10-02, practitioner): docs only — the rule's example now reads `order_sought_id`; renaming the four sites and their goldens is a code ticket |
| 9 | One concept, one symbol: the link to `statements_of_law` carries three names — `order_sought_requires.excerpt_id`, `clauses.excerpt_id`, `filing_law.statement_id` — and *excerpt* elsewhere means the verbatim passage | open (2026-10-02): recorded; a rename is a hop touching the renderer and goldens |
| 10 | The exhibit pointer is `statements_of_fact.exhibit_id` but `admissions.exhibit`; the trees write both as `exhibit`, work-markers writes `exhibit_id` | open (2026-10-02): recorded; the trees keep the concept name `exhibit`, the markers tables the column names |
| 11 | `document` names both the support object (the `documents` table) and the deploying advocacy document (`filing_facts.document` ⊕ `filing_submissions.document` ⊕ `filing_orders.document` ⊕ `filing_rhetoric.document` (v71) = form ⊕ written_argument; Consumers → `document ─ deploys`) | open (2026-10-02): recorded; no rename proposed |

## Renames and decisions

Settled (target = trees above; migrate in v3; dated 2026-08-22 unless noted):
- Containers → `proof` / `authorities`; pointers → `witness` + `document` / `authority`; `source` freed for transmission — fact 👀 ⊕ ℹ️, law 🥇 ⊕ 🥈 ⊕ 🥉 (`basis`, `knowledge` rejected; value `'direct'` → 👀 — *direct* reserved for inference).
- `admissions (×N)` per party under `proof` (proof = statement ×N ⊕ admission); `recorded` struck; `state` derived; four methods share the row; deemed / tender / struck derived, never stored.
- `instrument` off the statement onto the document (`instrument` + `deponent` + `execution`) — 2NF, mirrors `authority.kind` (and `authority.verification`, until v25 moved verification onto the statement of law).
- `evidence` supertype withdrawn — statement carries `witness` (NOT NULL) + `instrument` (→ document, the vehicle; target of `pinpoint`) + optional `exhibit` (→ document); today's `witness_id` + `document_id` stay, `instrument` absorbs #328's paragraph link / `affidavit_document_id` (grill 2026-08-22).
- Admissions: one row per party per method, state derived from dates, never stored (ADR-0006); 🙅🏻‍♂️ 🫸 🤷 three events — distinct by state, same routed work (work-markers rule 1 is scoped to work markers); ⚡️ plain event, no suffix; 🕹️ admission-proof only; bare ⏰ on routes with no defined deemed consequence (grill 2026-08-22).
- 📇 note up = `treatment` ∅ (law), separated from 👃 doubt (ADR-0007). 🏆 not best copy, 🥉 tertiary, 🎾 serve it, marker type *event* — terms-and-symbols wins the collisions; work-markers substitutions gated (grill 2026-08-22).
- `tier` → `weight` + `verification` + `source` settled (was open); `reserve` applies to consumers (argument, order_sought) too.
- `notice` object dissolved — `admissions.instrument`/`response` → documents; `served_on` moves to `document` (the pointer was first written `notice`; renamed `instrument` 2026-08-23, #327 — the column takes the concept's name, *admission instrument*).
- `affidavit_deponent` TEXT → `deponent` FK; `disposition` (included ⊕ reserved) → `reserve` boolean everywhere (*disposition* has its own legal meaning); `facts.source_kind` struck — its states (admitted / court record / document / witness / theorised) derivable (design settled #360, grill 2026-08-23): *admitted* = the per-party ladder (ADR-0006); *court record* = new `facts.court_record` (→ documents, the court document that proves the fact — conclusive against **all** parties, the one non-per-party silence) + `court_record_pinpoint` (link set ∧ pinpoint ∅ → 📌, routed to the holder of the record); *document* / *witness* / *theorised* — no renderer ever distinguished them, no replacement. A "no response filed" fact is a pleading-route deemed admission (binds only the non-responding party), never court record — the golden fixtures storing it as `'court_record'` remodel to an admissions row in the v7 hop. Migration consequence, deliberate: existing `'court_record'` rows cannot name their proving document, so the link starts ∅ and 👤 fires until the lawyer links the record — fail-visible, not silently preserved silence.
- `text_verbatim` → `excerpt`; `gaps.wrapper` → `gaps.kind`; `sworn_status` → `interviewed` + instrument links; TS `…Glyph` → `…Marker`; basis `'open'` → `'needed'`.
- `facts.posture` → `statement.doubt` (un-collides *posture*); new law-side `statement.doubt`; 👃 = doubt both domains — *dubious* (law) ⊕ *suspicious* (fact) (practitioner 2026-08-21, names 2026-08-22; work-markers edit applied #346).
- `facts.statement` → `postulate`; law `assertion.text` → `proposition` — the lawyer's wording, which supporting statements need not repeat.
- Third column (#323, 2026-08-22): `arguments` → `submissions` (the tree root names the column, as `facts` and `law` do; `filing_arguments` → `filing_submissions`, `opposing_point.answered_by` → submission); node `assertion`, wording `proposition` → `contention` (law applied to fact — the position one side argues for; *theory* / *thesis* rejected); support container `argument` = `rests_on → facts.assertion ×N` + `requires → law.assertion ×N`, neither required; `proof_text` struck (the proof chain derives from the postulate's statements); `argument_authorities` dissolved — its `point_of_law` is the proposition, its `authority_id` + `excerpt_id` the statement of law, `slot_state` → 📖 derived from no statement ⊕ dead end on the proposition. A contention is never a bare postulate or proposition: Submission 2 on L4212 was a postulate stored in `arguments.proposition`, which is how law-side markers landed on a fact. Held: a submission with no argument (both links ∅) — no journey names a reader. **Admitted 2026-10-06** as 🧾 and 📚 (the 📚 bullet below).
- Vocabulary sweep (#327, 2026-08-23): `authorities.treatment` **keeps its name** — `check` is an SQLite reserved word (`CREATE TABLE t (check TEXT)` fails); *check* is the act, `treatment` its outcome (the `treatment` → `check` rename is withdrawn). *Admission instrument* kept as the concept (no one word covers NtA / pleading / interrogatories / transcript) → column `admissions.instrument` + `instrument_pinpoint`; *instrument* thereby names both vehicles (see Instrument section). *Tender* defined under Adduce — one act, two objects (`statement.exhibit`, 🕹️). `witness_statements` **folds into `documents`** in v3 (`instrument='witness_statement'`, `deponent` → witness, `signed_on` → its execution; `statement_paragraphs` re-parented to the document; filing membership and order through `filing_documents`) — #328. Mockup frontmatter label `Document Type:` → `Draft:` (TS key `documentType` frozen; amends #299's header list). Checked and accepted as lawyer language, not double duty: *statement of fact* vs *witness statement*; `parties.role` vs `filing_documents.role`; `kind` on several tables; `filings.round='response'` vs `admissions.response` vs *Response to Civil Claim*. *Glyph* retired (2026-08-21) — residue in `filing-checklists.md`, `SKILL.md`, `two-kinds-of-legal-basis.md`, ADR 0005 and renderer comments/tests cleared by #328's sweep with the `…Glyph` → `…Marker` identifier rename.
- Document proof (#330, 2026-08-22): a document proves nothing by itself — proved by a statement of fact that tenders it (`statement.exhibit`) or by an admission of its foundation fact (`admissions.exhibit`, same pointer mirrored); an exhibit a filing selects that neither points to renders 👤 on its own Evidence Index line (journey `tender-an-exhibit-through-a-witness`; build #333). Foundation facts (authenticity, date, business record, signature) are ordinary postulates — no grouping, no `foundation` flag, no fact↔document relevance link; which ones a document needs is a question of law per document. VanIAC r. 17(e)'s argument-only citation is a to-do, not a permitted shape.
- v10 hop (#380, 2026-08-26 — realizes #370's pointer model and #372's Form 33 structures; one hop, not a dribble):
  - Pointer model: each advocacy document of a filing carries its own ordered pointer list into the proceeding pool (membership and paragraph order one fact); Counsel Brief derived, never a pointer list, never delivered.
  - `disposition` retired from all four tables (`relief_items`, `submissions`, `statements_of_fact`, `authorities`) — supersedes the queued `disposition` → `reserve` boolean: reserve is **derived** (deployed by no document ⇒ 🂡), never stored; ADR-0004 amended by note, same pattern as #300/#301. Still true at v16: the dropped axis (2026-09-06 bullet below) stores a rejection, not a reserve.
  - Crossed-out axis: `order_sought.crossed_out_on` 📅 ⊕ ∅ — orthogonal to deployment; cascade and rendering per Deployment section.
  - `served_by` junction realized (`order_sought` ↔ submission ×N); ∅ ⇒ 🦵 *unserved petitum* (closes that open row).
  - 🧵 *loose thread* admitted: venue form deploys it, Written Arguments never argues it (closes the form-vs-WA open question; render shipped #384).
  - `tier` → `weight` + `verification` realized (law `statement.source` already shipped v9, #365); `jurisdiction_slot_state` → requires-edge `basis_state` realized; `relief_items` → `order_sought` realized (`relief` grouping node stays open); `facts.posture` → `statement.doubt` realized; `gaps.wrapper` → `kind` realized; `section` → `part` realized (closes drift #6).
  - #372 Form 33 structures: `application_response` filing kind; `opposing_orders` anchored to the applicant's document (sought orders verbatim); position pointers (consented ⊕ opposed ⊕ no position, + proposed terms); `part` value `'part4'`; Part 6 provenance value; AFS three-state flag.
- Dropped axis (practitioner + Fable, 2026-09-06, v16 hop): `submissions.dropped_on` and `authorities.dropped_on` 📅 ⊕ ∅ — a stored, practitioner-set rejection, orthogonal to deployment. Not a reversal of v10: reserve stays derived (deployed by no document ⇒ 🂡) and still says nothing about *why*; `dropped_on` answers that question for the rejected case only, as `crossed_out_on` does for an order and `verification='lead'` for a sweep lead. A date, not a boolean (the `crossed_out_on` / `served_on` / `struck_on` idiom); not a `verification` value (a verified authority can be dropped); never a delete (the wording and excerpts are what stop a later session regenerating them). *Dropped* is the practitioner's word — *abandon* rejected (BC procedural meaning), *withdrawn* taken (👃 mode), *struck* taken (⚡️). Authority-level, not statement-level: a per-statement drop is held until a journey names its reader. (Its other stated ground — the breadcrumb it extends, `verification='lead'`, being authority-level — is superseded: `verification` became statement-level at v25.) Dropping a submission deletes its `filing_submissions` rows in the same script, so dropped ⇒ reserved holds in the data; every deployed face filters `dropped_on IS NULL` as the deterministic-test backstop (ADR 0004). No emoji (work-markers rule 5, as crossed out). **Renamed *killed* at v26** (#796, practitioner 2026-09-21): `dropped_on` → `killed_on` on both tables, meaning and every stored date unchanged — *dead* was refused because it collides with 🚧 `dead_end`. This bullet, and the v10 bullet's cross-reference to it above, keep the word of their own date; everywhere else in this file the axis reads *killed*.
- Petitum (practitioner + Fable, 2026-08-23): the ask — what a party requests the tribunal do; side-neutral (claimant: grant relief; respondent: dismiss). Capstone above the square, never inside a submission — a request, not an assertion; cardinality (one petitum ← many submissions, one submission → several petita) and filed-document shape (Form 32 order-sought Part, Written Argument prayer for relief) both put the ask on its own node. New edge `order_sought ─ served_by → submission ×N`. Backend symbol stays `order_sought`; *petitum* is the concept name, *invitation* the BC-glossary synonym. *Plea* rejected (criminal overtone, `pleading` collision); *the ask* colloquial; jurisdiction glossaries deferred until a second jurisdiction exists. Alias claim = `assertion` struck: a claim is the claimant's petitum + contentions (assertion row + capstone, pleadings stage); evidence and authorities belong to proof (support row), never to the claim.
- 🧾 *factual basis needed* (practitioner + Fable, 2026-08-27, #373/#388): a contention (`submissions` row) with no `submission_facts` row fires 🧾, unconditionally — including a legitimate law-only submission (fail-visible; the marker does not read which shape was intended, and no exemption is built). Distinct from 👤 (per-fact witness support) and from 📖 (per-proposition authority support): 🧾 operates one level up, on the contention's own factual leg. Not 📖's twin — that phrase names a specific same-relation fact/law pairing that doesn't hold here; the true law-side mirror (a contention with no `submission_law` row) stays **held**, folding into the existing "submission with no argument, both links ∅" open row (#323) rather than opening a second one. **Exemption built at v48** (practitioner + Fable, 2026-10-04): this bullet's "no exemption is built" is reversed by a counsel-recorded decision. Counsel records that the contention needs no stated fact, with the reason in counsel's own words (`submissions.no_facts_needed_on`, `no_facts_needed_note`, and `no_facts_needed_contention`, the wording decided on), and 🧾 clears without a linked fact. The database resets the decision when the contention's wording changes, and a wording changed back restores nothing. It is never inferred: a law-only submission still fires 🧾 until counsel records it. The name avoids *settled*, v47's law-statement value.
- 📚 *proposition needed* (practitioner + Fable, 2026-10-06, `Engineering/1. Design/2026-10-06_application-paragraphs-spec.md`): the law-side mirror the 🧾 bullet above held is admitted, with the drafter as its reader. A contention (`submissions` row) with no `submission_law` row fires 📚 on its contention line beside 🧾, unless counsel has recorded that the contention needs no stated law, with the reason in counsel's own words (v60: `submissions.no_law_needed_on`, `no_law_needed_note` and `no_law_needed_contention`, reset when the wording changes, as v48). The practitioner calls a contention that does its job, law applied to this matter's facts in prose, an *application paragraph*, and asked that it link at least one fact and one proposition; the contention already is that paragraph, so no paragraph-kind column and no new table were added (GLOSSARY.md → Contention). The database refuses both records on one row: a contention with neither facts nor law is not a submission, so the both-∅ shape held at #323 now carries 🧾 and 📚 and never renders clean. **Ordinary costs exempt** (practitioner, 2026-10-07): a submission that only asks for ordinary costs derives no 📚, so no Proposal, job or open-items entry, because asking for ordinary costs needs no proposition of law. The test is a fixed classification rule, never a legal judgment made at runtime, and it fails closed; the `symbol-table.ts` 📚 row states it. Unusual costs orders still fire: special costs, costs in any event of the cause, a higher scale, solicitor-client, double, lump-sum, and costs against a non-party or a lawyer.
- 🚩 *adverse* (practitioner + Fable, 2026-08-27, #373/#390): privileged awareness only, never automatic disclosure — the pipeline never decides whether a disclosure duty applies (routes through `/legal-research`); Counsel Brief only, same posture family as 🂡/🤥. Two predicates, one marker: a stored boolean `facts.adverse` at the assertion level (a fact we hold true but which hurts our own position), and a new object `anticipated_points` (the practitioner's own prediction of a point the other side might run, before they've said it) whose mere existence fires the marker. Deliberately not a flag on `opposing_points` (real, served points; mixing in speculation would corrupt every downstream reader and change what ↩️ means) and deliberately not named `anticipated_submission` (collides with the defined meaning of *submission*, always our own side). `anticipated_points` sits outside the deployment axis entirely — Fable's review caught that 🂡's "deployed by no document" predicate would otherwise fire vacuously on every row; terms-and-symbols → Deployment fences this. When a prediction materializes as a real, served point, the practitioner records it as an `opposing_points` row and deletes the spent `anticipated_points` row — no link kept, ordinary CRUD (Brahm's call between delete vs. keep-marked-resolved).

Open decisions:
- `excerpts` → `statements_of_law` restructure — realized (v3, #328). `statements_of_fact.excerpt` — realized (v4, #321, Fable-reviewed 2026-08-23): additive nullable column, mirrors `statements_of_law.excerpt`.
- `relief` grouping node (relief : orders = 1 : N) — `order_sought` realized v10 (#380); the grouping node is not.
- v3 question: `gaps.kind` values `'authority'`/`'source'` are unmarked live — a marker claims each, or drop. (Distinct from `statements_of_law.source`, which 🏅 now claims — same word, different table.)
- 🏅 *unrated* and 🎖️ → 🏛️ (practitioner + Fable, 2026-09-19, #597): law-side `source` ∅ is work, not 🥉 — a marker on the blank, two sites, reader the research lawyer; *jurisdictional basis needed* returns to 🏛️ so the medal family is the source ladder's alone; 🎖️ struck, no return.
- Class ≠ transmission (practitioner + Fable, 2026-09-20, #718): law-side `source` leaves the Transmission row for its own **Class** axis, a function of `authority.kind`; the fact and law ladders run in opposite directions and share no rung — *primary / secondary / tertiary authority* vs *direct / circumstantial / hearsay evidence*, never crossing, with nine crossing terms banned (Axes of reliability). The fact tree node renames `source` → `basis_of_knowledge` (documentation only; `statements_of_fact` carries no such column). A case quoting an earlier case with a pin cite is 🥇: *Corner Brook (City) v. Bailey*, 2021 SCC 29 at para 20 quoting *Sattva* was rated 🥈 under the old sentence and corrected, along with four pre-existing L4212 rows. *Tertiary* defined as a finding aid. **Open:** derive `source` from `kind` (which retires 🏅 — `kind` is NOT NULL) or keep the stored rating; add a tertiary `kind`; drop `'tertiary'` if the practitioner rules the rung does not exist.
- 🧐 *final review* (practitioner + Fable, 2026-09-22, #859/#861; re-glyphed from 📋 *counsel's review* 2026-09-24): content stays marked until counsel approves the content as it stands, whoever wrote it; last rung before clean on both ladders; documents for delivery only (widened 2026-09-27, #1207: documents that are filed or sent only, an internal memo included, never the Counsel Brief — the markers row above reads so); not 👀, which is the Transmission value *personal knowledge*.

At v2, before the v3 hop: assertion appears as `facts.statement`, `arguments.proposition`, `excerpts.proposition`, `argument_authorities.point_of_law`; statements are `evidence_uses` / `excerpts` rows; `verbatim_words` joins `text_verbatim`; fact excerpt / `source` / credibility check untracked; admissions columns absent (`source_kind='admitted'` only); a witness statement is a `witness_statements` row, not yet a `documents` row.

## Mechanics — surfaces touched

| Surface | Files | Action |
|---|---|---|
| Migration | `references/migrations.sql`, `schema.sql` | one v10 hop (#380): pointer model, crossed-out axis, `served_by`, #372 structures, all settled renames (RENAME; table-rebuild for CHECK changes); stamp `schema_version=10`; regenerate schema.sql byte-for-byte |
| Renderer | `plugins/litigation/mcp/src/submission/forms/markers.ts`, `query.ts`, `components.ts`, `render-*.ts` | rename symbols + predicates; `npm run bundle` from the repo checkout, never a temp worktree |
| Docs (gated) | `references/work-markers.md` | already applied (#346) |
| Docs | `references/filing-checklists.md`, `SKILL.md`, `User_Journeys/*.md`, `GLOSSARY.md` glossary | substitute symbols; fix drift #5 |
| Historical | design doc (issue 291) | unchanged — schema.sql is canonical |
| Order | — | settle decision rows first; ship one hop, not a dribble |
