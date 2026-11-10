Read when: a plan step touches an authority, a statement of law, or a research marker, or a job touches reserved material or a rejected item (SKILL.md section 4).
Assumes SKILL.md is loaded. Rules are not restated here.

## Doctrine (SKILL.md section 4)

The doctrine most likely to be rebuilt wrongly.

- Every authority enters as an unverified lead, whatever its provenance, including an ingested primary authority, output of `/verify-law` with `verify-authorities`, or the matter's own prior research memo. Only the research lawyer's verification upgrades it. Canonical rule: items 2 and 4 of `shared/legal-research.md`.
- Leads render for the human, beside the slot they might fill, and never on the filed face.
- Reserved material always renders for the practitioner and never reaches the filed face. On a document with a trailing held-in-reserve section, it renders there. On a court form with no such section, a reserved order renders inline, struck through and unnumbered; a reserved submission or statement does not render on the form at all; the Arguments page shows a reserved submission as Held in reserve.
- **"Rendered for the human, withheld from the forum" is the whole rule.** Never act on a rule phrased "never reaches a document": a mockup is a document and is the practitioner's only review surface.
- A layout item of a learned type file or `venue.md` that the firm has not confirmed renders as `[unverified: <rule_ref>]`, for the human and never for the forum, like a lead. Accepting it at mockup review records the confirmation through `/localize confirm` (section 11), and nothing else does.
- A rejected item is kept, not deleted. It names no outstanding work and raises no marker, so no later pass re-proposes it.
- When the practitioner says a proposition of law does not matter to the case, omit it through `/drafting-data`'s "Omitting a proposition" write, as an authority is killed. Omit only on the practitioner's word, never propose it, and restore it by the same write when they say so. If it is still linked to a submission, required by an order, or cited in a Writing's own text, say in one line that it keeps printing there, on the mockups and on the filed face, until they unlink it.
- Adverse treatment renders for the practitioner to weigh and blocks nothing. Only "not good law" mechanically reopens the slot, and the replacement research question goes out immediately with a report of what was done.
- Noting up is mandatory before a Writing is sent or filed. Its work is the Writing's one `Note up all cited authorities` job, which `drafting-data/references/jobs-create.md` §3k writes from the 📇 Proposals as renders report them (section 11). When every completion criterion printed above counsel's review holds (section 14), read the mockup for every not-yet-noted-up authority and every doubted statement, and dispatch the whole batch through the gate in one round (Noting-up sweep, below).
- **A note-up job is written only on the practitioner's express instruction or by `/drafting-data`'s "Note up all cited authorities" create.** That covers a job to note up an authority, read the cases that cite it, or run a citator or KeyCite check. Never write one from a research offer, a loose thread or a finding by the session's own reading. A research offer tagged `kind: note-up` stays a loose thread and gets no job, even on "add" (`drafting-data/references/jobs-stock.md` §3i). When the practitioner asks for a note-up in their own words, outline it under Branch B (`work/references/job-session.md`).
- Reserving is one sentence in, one sentence out. No mode, no checklist, no approval. Name in one line the supporting authority and evidence that went with it. Bringing it back is symmetric: nothing was deleted, and the material returns with its outstanding work intact. Impeachment is a species of reserve; the specific marker replaces the general one.

## Composing a research question

Name the live issue in one sentence first. Ask the gatekeeper for authorities and submissions the practitioner already reviewed and rejected on the same or a close proposition, and pass them to `/legal-research` as named exclusions rather than re-researching them. Two different legal bases are two different research questions, kept distinguishable so the practitioner never has to open a slot to learn which research is missing. Pass held leads along so the research lawyer starts warm. While research is out, leave the slot open and never fake it: any re-render in the meantime shows the same open markers and the same held leads.

When an answer states law, persist it: save it verbatim in the matter's law folder, file the decisions it cites that are not already held, and account for every citation in the relay. This is the statements-of-law doctrine's per-turn rule; the doctrine itself governs the rest.

## Reusing a stored statement

When a stored statement of law is pulled into a new draft or an answer, its proposition never travels alone. Read its provenance line through `/drafting-data` ("Read a statement's provenance") and show that line beside the proposition. The line gives the authority's year, the pinpoint, whose words the excerpt is, and when the statement was verified. If the line carries 🕰️, `quoting`, or `pinpoint none`, offer `/verify-law` Mode A on the statement before it is reused. The line describes where the statement came from. It never says what the law is, and it upgrades nothing (Doctrine, above).

## Verbatim check route

A verbatim check of a stored excerpt goes to `/verify-law`, never to `/legal-research`. Read the stored excerpt and the proposition it sits under through the gatekeeper, write the excerpt to a temporary file in the session scratchpad directory, and invoke `/verify-law` with that file, the citation and the path the gatekeeper's locate operation returns. It performs a deterministic word-level difference. An agent reading two passages is not a difference engine, and a correct quotation sent to `/legal-research` comes back reported as a misquotation.

A substantive question (does this still bear the weight, how has it been treated, is it distinguishable) goes to `/legal-research` instead.

Label every passage handed to any agent as either a stored verbatim excerpt or the practitioner's own proposition. Never present a proposition as a quotation, and never ask an agent to "verify the quote" while handing it a paraphrase, a verbatim test on a paraphrase fails by construction.

Before relaying any claimed misquotation, have the difference output in hand and present it, with its one-line result per `/show-me` rule 9 and the authority's own file presented per `/show-me` (page-extracted, the passage highlighted, omissions or discrepancies in orange), before any interpretation. An agent's impression is a reason to run the check, never a finding.

If the authority's own text is not on file, say so before dispatching, naming the folder searched. Carry any "matches the reproduction in <case> at para N, authority's own text not verified" label through to the practitioner unchanged.

## Verification and treatment

Provenance never upgrades an authority (Doctrine, above). A scrutiny the research lawyer does not pass is recorded too, never dropped: see Failed scrutiny below.

A note-up of a case asks the research lawyer to state its finding as exactly one of the four words good law, distinguishable, negative or overruled (overruled is the "not good law" result above), and to give its coverage and any qualification separately. Record the return through `/drafting-data`'s "Record a note-up return", which writes that word with the coverage and qualifications verbatim. An `INCOMPLETE` memo, a refusal, or a return that names no single one of the four words records nothing: say so once in chat, and the note-up job stays open. There is no approval pause: the mockup prints the coverage and qualifications beside the authority's citations, and counsel's review carries the result.

## Noting-up sweep

The sweep runs when the Doctrine above calls for it, as the work of the Writing's `Note up all cited authorities` job (`drafting-data/references/jobs-create.md` §3k), never as a second note-up job. A 📇 Proposal still in Proposed is first written into that job by §3k. Then, with the job in Ready, assign it and dispatch its open steps in one round. With no 📇 open, the sweep dispatches no note-up. Its one-round dispatch makes the same note-up request for each case, and each return is recorded the same way (Verification and treatment above). Leave out every statement whose scrutiny failed or was settled: a failed statement's finding is the practitioner's decision (Failed scrutiny below), a settled statement's is the finding counsel already decided, and the sweep never re-dispatches either. For a statute, regulation or rule the request is the statute-currency check, and its relayed value is recorded as the authority's currency result through `/drafting-data`, never as a treatment (`shared/statute-currency.md` → Noting up legislation).

## Dead end

When research on a basis slot comes back exhausted: record it, re-render, present the mockup, then state it once, plainly, in chat. Never fold it into a task list, never queue it behind other work, never duplicate it into a separate to-do. A dead end is not a denial and not an ordinary gap: it renders only where research or investigation actually ran dry, and a refusal to admit or a slot not yet researched carry different markers.

Offer exactly three options with no recommendation, and stop:

1. **Reframe.** They restate the point, and a fresh research question opens through the gate. Never supply a replacement authority yourself.
2. **Drop.** Ask the one follow-up this needs: remove outright, or hold in reserve.
3. **Proceed unsupported.** Record it as the practitioner's tactical call. The point is never dressed up as supported, and the skill neither endorses nor argues against the choice beyond having presented it.

Write, re-render, present, in every branch.

## Failed scrutiny

Record a 🔬 return as verified only when the research lawyer affirms both halves: the excerpt supports the proposition (fit), and it is the court's own reasoning (ratio). Any other substantive return is failed, a partial pass included, and its finding quotes what held and what failed. An `INCOMPLETE` memo or a refusal records nothing. The write goes through the gatekeeper (`/drafting-data`'s "Record a scrutiny return"). Before it, save the return with `research_filing__save_answer` under `shared/legal-research.md`'s rule that the caller persists the answer: a scrutiny return is a research lawyer's return and is persisted like any other. A failed finding ends with `Answer: <path>`, where `<path>` is the `path` `save_answer` returned, from its `6. LAW\` segment onward.

A failed statement stays on file with its finding as 👃, prints on no venue face, and supports nothing on any filed face. The recording session also creates the statement's scrutiny review job through `/drafting-data` (its review job for a failed statement), then re-renders, presents the mockup, and states the failure once, plainly, in chat. It never asks for a decision in that turn and never re-dispatches scrutiny.

**The review** runs once the review job is assigned, one decision per turn. A taken-over review job reads back nothing beyond its take-over decision form (`references/take-over.md`, "A taken-over job"). The review turn starts with one `drafting_forms__draft_harness` call, step `scrutiny_review`, with the matter folder, the drafting database path and the statement id. Pass `context_paras` only when the practitioner names paragraphs; otherwise the step derives them from the finding and reports `context_paras_derived`. Make it whether or not anything changed. It reads the statement and the finding, finds the authority's own file, runs the verbatim check on the stored excerpt, and writes the cited and context extracts, each a PDF and a PNG per page, into `0. DRAFT\Scrutiny review\statement <id>\` (ADR 0036). When the finding names no answer file, the step also writes the finding there as plain text, named as the cited extract is with `3 finding` in place of `1 cited` and `.txt` in place of `.pdf`, and returns its path as `finding.file`. The last card is the finding: the answer file at `finding.answer_file.path`, or `finding.file` when the finding names no answer file. A refusal ends the turn at the stop line it matches. `source_unresolved` is the one line saying the authority's own text is not on file, naming the folders searched. `converter_missing` or `conversion_failed` is said in one line, and the review stops. `budget_exceeded` means the conversion is cached, so call once more. Any other refusal is said in one line with its detail, and the review stops.

When the authority, the pinpoint or the excerpt changes, call the step again with `proposed`: `authority_id` (a new authority is first added as an authority of the proceeding through `/drafting-data`), `pinpoint`, or `span`, the start and end words of the new excerpt in the source. The server cuts the new excerpt from the source, never typed, and checks it. `proposed.verbatim.exit` must be 0 before the confirmation write, which takes `proposed.model_only.proposed_excerpt` as read and never puts it in chat. A refused proposal writes nothing, and its detail starts "the proposal: ".

Send the step's PDFs as file cards with the card tool `shared/present-files.md` chooses, staging them with `device_stage_files` only on its `SendUserFile` route. The step's PNGs are previews for the self-check in /show-me Mechanics step 2 and are never sent. Present the review by `/review-proposition`. On a re-point or a new authority, its citation part and its cards show the authority and pinpoint as the statement will stand, from the step's `proposed …` files.

The outcomes are a change (a reword, a re-point, a new excerpt or a new authority), keeping the statement as it is over the finding, or a drop. Only the practitioner's confirmation closes the review: `/drafting-data`'s confirmation write for a change or a keep, no statement write for a drop, and then the job completes. An edit Claude made on the practitioner's instruction, such as adopting the research lawyer's suggested wording, is shown the same way and closes only on that confirmation. A drop leaves the statement failed, supporting nothing; kill the authority where nothing else relies on it.

Never re-dispatch scrutiny of a failed or settled statement. A settled statement reopens for scrutiny only when its authority, pinpoint or excerpt later changes, and then its 🔬 proposes the work by itself.
