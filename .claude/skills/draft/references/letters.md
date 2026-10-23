Read when: the Writing is a letter (a `_NoVenue` letter kind, or a venue's `letter` kind), or the practitioner asks for a letter to their own client. Section 8 alone also governs an internal memo, which is sent like a letter.
Assumes SKILL.md is loaded. Rules are not restated here.

## Contents
- 1. The letter and its audience
- 2. Referenced correspondence
- 3. Drafting
- 4. The five passes
- 5. Revising
- 6. Dates in a letter (ADR 0024 D7)
- 7. The Word document
- 8. Sending
- 9. Court correspondence
- 10. Client letters

Letters and emails to any audience, written with the tone, style, and professionalism of an experienced BC trial lawyer.

## 1. The letter and its audience

A letter to anyone but the client is a Writing. A standalone request for one opens this skill like any other: it is saved first on its proceeding, whether or not the proceeding has a forum (SKILL.md section 8), drafted through the gatekeeper, and reviewed on its mockup (SKILL.md section 11), never in chat. A letter to the client is never a Writing (section 10). Nor is a reply to a message from the tribunal or counsel, asked for as a reply and not as a letter: it follows `references/reply.md`.

Before drafting anything, identify who the letter is going to. Each audience calls for a different tone, structure, and set of rules. If unclear, ask: "Who is this addressed to?" When the request states no purpose either, ask for it in the same question, before reading the file (SKILL.md, "Purpose comes from the practitioner").

| Audience | Kind | `recipient` |
|---|---|---|
| Opposing counsel (the other side's lawyer) | `letter_to_opposing_counsel` | `opposing-counsel` |
| Opposing party directly (not through their lawyer) | `letter_to_opposing_party` | `opposing-party` |
| Independent (lay) witness | `letter_to_witness` | `witness` |
| Expert witness (retained for opinion evidence) | `letter_to_expert` | `expert` |
| A public body that is not a venue: the police, a ministry, a municipal or bylaw office | `letter_to_public_body` | `public-body` |
| Anyone else who is not the client and not a venue: an insurer, landlord, bank or records holder, employer, strata, the media | `letter_to_non_party` | `non-party` |
| A court or tribunal: its registry, judicial staff, or an arbitrator | that venue's `letter`, never a `_NoVenue` kind (section 9) | none |
| Your client | none: guidance only (section 10) | none |

The first six are `_NoVenue` kinds, looked up with their `recipient` (SKILL.md section 8). A phrase such as "demand letter" is an alias on each audience's kind, not a kind of its own, so the recipient picks the file.

A letter to a witness, an expert, a public body or a non-party takes no default recipients: add the person it is addressed to by hand, through `/drafting-data`, as its `To` recipient off the forum default, their name, capacity and contact details in the practitioner's own words and never guessed, so they never reach a later letter to the forum.

Once the audience is known, read its type file before drafting. Each holds tone guidance, structure, what to avoid, and examples for that audience. Do not rely on general principles alone: the nuances differ significantly between audiences.

**Ingestion check.** A letter that is a Writing and is drafted under a job, its `Availability letter` job or, on a letter saved before 2026-10-23, its `Draft the letter` job, is checked when that job is claimed (`/work`'s `references/job-session.md`, "The input check"), not here. A letter drafted with no job, and a client letter, which is no Writing and has no job, check once, before the letter's first text is written, that the matter's correspondence and court file are in case data. A client letter that already has drafted text never runs it. Ask `/matter-data` for the ingest coverage of `2. SOLICITOR CLIENT*`, `3. CORRESPONDENCE*` and `5. COURT*`, the first two counting as correspondence. Never read a mailbox: an email is case data only once it is saved into the matter folder and ingested. Show the result in one line, as `/work`'s `references/opening.md`, "The ingest-coverage clause", formats it, leaving discovery out of the clean line since this check does not cover it. When there are files to ingest, make the offer that clause gives for each one, and run it only on a yes. Declining continues drafting, and the check itself writes nothing. A `/matter-data` error is quoted in one line and drafting waits: never say the file is ingested when the check could not run. In an unattended run (`/work`'s section 14), anything but the clean line stops the run and goes in its report.

## 2. Referenced correspondence

Run this step only when you are drafting a **reply or revision to an existing thread** and the material you were given refers to a document it does not reproduce in full — "our/your letter of [date]", "as previously advised", "(attached)"/"(enclosed)" naming a letter, demand or list, a deadline or dollar figure described as previously raised without its original wording, or a notice or demand said to have already been sent but not shown.

Skip it for first-in-thread correspondence, routine scheduling with no unquoted antecedent, and threads where the whole relevant history is already quoted inline. Always find what this letter calls enclosed or attached in the matter, apply points 3–5, show it as a file card (`shared/present-files.md`) with this letter, and list what it encloses in `enclosures` at `/publish`.

When it applies:

1. Resolve the correspondence folder under the matter by glob, never a guessed literal: `2. SOLICITOR CLIENT*` for a client-audience draft, `3. CORRESPONDENCE*` for every other audience. One match → use it; zero or several → treat the reference as unresolved (point 5). Never create it. **This is a matter workspace folder, not skill source — search and read it with ordinary file tools.**
2. Look for `.pdf`, `.msg` and `.eml` files whose *filename* matches, since the firm names correspondence `YYYY-MM-DD CODE PartyToken re Subject`. Match the referenced date first; fall back to the party token and subject keywords.
3. Read each match in full, attachments included, before drafting.
4. What the source document says governs — treat its deadlines, amounts, demands, admissions and commitments as **authoritative over any paraphrase in the material you were given**.
5. If you cannot resolve a reference — no matter folder, no folder match, no file match, or a file you cannot open — **do not draft around it.** Name that specific reference and ask: "The chain refers to a letter of July 23, 2026 that I couldn't find in the correspondence folder — can you supply it, or should I proceed without it?" Then wait.

## 3. Drafting

Every letter type lays out the standard letter elements as parts of their own: the date, the address, the salutation, the RE: line, the body, and the signature block, whose closing is the signer's. Write each into its own part.

Draft argument-first. The first draft's only job is to construct the most compelling case the facts support — do not constrain it with consistency checks, hedges, or anticipated objections while composing. Those are separate passes (section 4), run against the draft after it exists. A draft written under all constraints at once is weaker than a free draft corrected afterward.

Cite a case only where the practitioner asks for authority. Never add one on your own. Give a case's full style of cause and citation at its first mention, and a short form after that.

Record each case the letter's own sentences rely on or characterize, one it answers included, through `/drafting-data` as a lead statement of law linked to this Writing, in the same write that records the statement. A case that appears only inside opposing text the letter quotes is not linked. A case or enactment the letter's text cites, by citation or by a case name in italics, that no authority row tracks prints `📇 Cited but not tracked` on the mockup and holds sending under `noting-up` until it is recorded (`/drafting-data`'s `filing-checklists.md` §6b). Scrutinizing such a statement (🔬) checks its fit against the letter's sentence that cites it.

Whatever the audience:

- Be clear, precise, and unambiguous
- Use "RE:" lines to identify the matter; include the file number
- Date correspondence appropriately
- Never make promises or guarantees about case outcomes
- Never use aggressive or unprofessional language
- A past letter's no-admission or reservation close is not a position: add per type file or request

## 4. The five passes

Before presenting the mockup of any letter that takes a position (skip for pure scheduling or transmittal notes, except Pass 4's "we" rule and Pass 5), run five passes over the draft's actual sentences, as the mockup prints them. These are distinct checks — passing one does not imply passing another.

**Pass 1 — Facts.** Verify every date, amount, name, quotation, and rule citation against the source documents gathered in section 2. Check terminology consistency with the record (e.g., a "summary trial" application must not become "summary judgment" mid-thread). A single impossible date or shifted term reads as carelessness to a judge and undercuts the letter's authority. On every render, reword any "[date] [document type]" (email, letter, order, report) fitting more than one named or enclosed document.

**Pass 2 — Position consistency.** Fact-accuracy is not position-consistency: a draft can quote every prior letter correctly and still assert a characterization the writer's own earlier correspondence contradicts. For each position the draft takes, ask: has this firm's prior correspondence in the matter taken a position this sentence contradicts, retreats from, or renders hypocritical? A contradiction hands opposing counsel a free credibility point that is disprovable from documents they already hold. If a prior position is inconvenient, do not deny it — see "Position Discipline" in the audience's type file for the own-it-then-narrow-it repair.

**Pass 3 — Exploitation review.** Read each sentence as opposing counsel will: what can be quoted back, taken out of context, or disproven from documents the other side holds? Then check the omissions: is everything in the letter earning its place (see brevity guidance), and is anything omitted that a judge would read silence on as concession?

**Pass 4 — Voice.** Compare the draft against `references/style-examples/ai-to-lawyer-style.md` and strip every AI tell it lists. When drafting for a client, skim the newest before/after pair in `references/style-examples/` to calibrate voice first. A letter or email to anyone but the client speaks as the firm outside quotes: "we", "us", "our client", never "I", "me" or "my".

**Pass 5 — Overstatement.** Pass 5 is the overstatement review, `references/overstatement.md`, run on every letter, scheduling and transmittal notes included. Its assertions, its checks of each one, its verdicts and its decisions are that file's, with one addition for a letter:

- **(e) What a cited case says at the pinpoint.** Compare the sentence with the saved decision's words at the pinpoint, words only, as for a provision. A pinpoint taken from a research memo or case brief is a lead: name that memo as the finding's source, and do not report it supported until it has been checked against the decision. A citation attached to a sentence that states no proposition of law, such as the firm's own intended action, is unsupported.

Fix what Passes 1, 3 and 4 catch as ordinary revisions (SKILL.md section 12). Then run the source-trace review, `references/source-trace.md`, on every letter, scheduling and transmittal notes included, and present the mockup only once it is resolved.

**Findings go to the Job Board, never into the letter or beside it.** No open-items list, no findings table, no report file and no file card: the mockup's work markers show where open work is, and the board holds why. State each finding to the practitioner in one line in the turn it is found, quoting the draft's words and the source's. A finding they resolve in that turn is never written down. Each one left undecided becomes one `/drafting-data` §3g job, under its pass's fixed title:

- **Pass 1:** a date, amount, name, quotation or citation that cannot be put right from its source in this turn, a source not located included.
- **Pass 2:** every position the draft takes that requires changing a position or doing damage control. That is a strategy decision counsel owns, never a silent edit, so the session states it and never fixes it. It stands as a job unless counsel decides it in that turn, and while the job is open the letter is held from being recorded as sent (section 8, `position-conflict`).
- **Pass 5:** each flagged assertion not decided in the turn (`references/overstatement.md`, "Findings").
- **Passes 3 and 4** write nothing: what they catch is fixed as a revision.

Before writing a finding, read the board's `live` lane (`drafting_forms__board_card`) and, in the line that states the finding, name any open job that appears to cover it already, such as a research job on the same point. Write the finding unless the practitioner says that job covers it. A finding already on the board is caught by §3g's guard and written once only. A client letter is no Writing and takes no job, even on the board it is attached to (section 10): its findings are stated and decided in chat and written nowhere.

## 5. Revising

A revision is asked for, written and re-rendered like any other (SKILL.md section 12). Present a **clean revision by default** — no markup showing what changed. Only blackline a revision when the practitioner explicitly asks to see the changes (e.g., "show me the changes," "blackline this," "what changed").

When blacklining is requested:

- **Additions**: wrap new text in `**bold**` markdown so it renders as bold
- **Deletions**: wrap removed text in `~~strikethrough text~~` markdown so it renders as struck through

A blackline is a document for the practitioner, written in the letter's Writing folder (SKILL.md section 13), and presented as a file card (`shared/present-files.md`). It never enters the Writing. Pass 5 reruns on every assertion a revision adds or changes (`references/overstatement.md`, "Revisions"). Pass 1's date-reference check reruns letter-wide each re-render. Pass 4 reruns over the whole letter on every revision, as section 4 scopes it (its "we" rule alone on a scheduling or transmittal note), before the mockup is presented, because a voice tell can span paragraphs the revision did not touch.

## 6. Dates in a letter (ADR 0024 D7)

- **The other side's missed deadline is content.** A past deadline the other side missed, cited from the order that set it, may be stated in a drafting session: the date the order set, and that it passed unmet, as the order records it. The practitioner's own deadlines, past or future, stay isolated (`shared/deadline-isolation.md`).
- **The date check keeps running for it.** Pass 1 checks the cited date against the order that set it, and Pass 5 checks that the letter states it at the order's strength, condition included.
- **Hearing dates.** Offer only the open days this session fetched from `/practice-data` court-calendar-days, and dates the practitioner states. Never look up or compute another date.

## 7. The Word document

Once the drafting conditions all hold (SKILL.md section 13), `/publish` with `publish-general` makes the letter's Word document on the firm's registered letterhead. Present the letter's enclosures as file cards (`shared/present-files.md`) beside it, with no approval asked. Pass findings are on the Job Board, never a card (section 4).

**Never rebuild the letterhead.** Do not write the document from scratch with docx-js, python-docx, or any other document builder, and do not reconstruct the letterhead as styled text. A letter assembled by eye lands about an inch off every other letter in the file and is worse than no letter at all. If `publish-general` stops because the letterhead or an author field is missing, say so, name what is missing, and ask the practitioner how to proceed. Never approximate the letterhead to keep the workflow moving. This rule governs a letter on letterhead. The reply route's `.docx` carries no letterhead and is built by its own tool for pasting into Outlook (`references/reply.md`).

## 8. Sending

`Deliver` is the letter's last job, blocked by the `Availability letter` job when the letter was saved under it, by `Draft the letter` on a letter saved before 2026-10-23, and otherwise by nothing. Its first step, sending the letter to its recipients, is the practitioner's own act. Its second, `Record the letter as sent`, is `/drafting-data`'s Sent write, `drafting_data__record_sent`: the date the letter went, and the copy as sent, either its file (a `.pdf`, a `.msg`, or a `.eml` saved from the mail program after sending) or its text as pasted. Only an active roster lawyer, the person on this machine, records it. On a staff machine, name the signing lawyer and stop.

**Whether it went out is checked, never asked.** Before any question about whether a letter was sent, delivered or received, and at the opening of a letter whose `Deliver` job is open while a dated or signed copy of it sits in the correspondence folder, run the delivery check (`references/delivery-check.md`). It finds the evidence, updates a draft that differs from the letter as sent, and records the letter as sent, without asking.

**The covering email.** A letter goes by email as an attachment to a covering email, and the model never sends it. A practitioner's request to send, publish or email out a drafted email or letter means this step, written by `shared/email.md`: `write_email`, never a mail send tool. Pass `to` and `cc` from the emails of the Writing's `To` and `Cc` recipients through `/drafting-data`, `subject` from the letter's RE: line, and as `body` a short covering note in the firm's voice (Pass 4), with no closing and no name, because the signature supplies them. `attachments` is the signed letter PDF the practitioner names, at any path. Never attach a file ending ` UNSIGNED.pdf` unless the practitioner names it. With no signed file named, write the draft without it and say in one line to attach the signed letter before sending. The covering note passes `references/source-trace.md` before `write_email`. Present the draft and its attachment as `shared/email.md` says (SKILL.md section 11, step 4).

**An email Writing.** A Writing the practitioner asked for as an email goes out as an email draft, with no send request needed. Each time a revision of it is presented, write its `.eml` by `shared/email.md` in the same turn, after `references/source-trace.md`'s review of the exact `body`: `body` is the email's text, with no closing and no name; `to` and `cc` are the emails of the Writing's `To` and `Cc` recipients through `/drafting-data`; `attachments` are the files it encloses; `folder` is the Writing's own folder. Present the mockup, then the `.eml` and each attachment as `shared/email.md` says. A client letter whose first line reads `Counsel's review: pending` gets no `.eml` until approved (section 10). Everything else (output name, signature, refusals, presenting) is as `shared/email.md` says.

For a letter sent as an attachment, its copy as sent is the signed PDF that went, which the Sent write compares. The sent email saved from Outlook is a `.msg`, recorded by path only. The draft `.eml` is never the copy as sent.

The Sent write never renders. It also closes the letter's `Deliver` job, both steps done, so a job session finds it already completed once the call succeeds. On a refusal:

- **`render_first`.** Render the mockup (SKILL.md section 11), then call the Sent write again with the same arguments.
- **`held`.** The pre-send hold, on every letter, a venue's `letter` included. The Sent write has left a `Pre-send gate` job, one step per unmet criterion among `primary-authority`, `excerpts`, `noting-up`, `recipients` and `position-conflict`. Name each in one line and ask the practitioner whether to meet it, outlined as work on the Job Board, or to send anyway. An unmet `recipients` means the letter has no `To` recipient: meeting it is adding the person it went to as its `To` recipient through `/drafting-data`, then rendering the mockup and calling again. An unmet `position-conflict` means a Pass 2 job is open on the letter (section 4): meeting it is counsel's decision on that job, closed by `/drafting-data` §3g, then calling again. On "send anyway", call again with the practitioner's own words, verbatim, as `send_anyway`, never paraphrased, completed or composed for them. The Sent write alone writes, waives and completes the `Pre-send gate` job: never touch it.
- **`sent_copy_mismatch`.** Run the delivery check on the copy passed, if it has not run (`references/delivery-check.md`). When the check confirms that copy was sent and allows the update, the mismatch is resolved by that file's section 4, never by asking: the stored text is replaced with the letter as sent, the Sent write is called again, and both versions are shown as file cards (`shared/present-files.md`), the draft as it stood and the letter as sent, every time. Only when the check does not confirm the copy was sent, or does not allow the update, relay each paragraph of the stored text the copy lacks, say what the check found, and ask the practitioner which is right. A change to the stored text is then an ordinary revision.
- **Any other refusal.** Quote it in one line and stop. Never retry to force a result.

A `.msg` copy is recorded by path and not compared: say so in one line. The Sent write retires nothing, and recording a letter as sent never leads to a retirement offer (ADR 0042): the letter stays on its Job Board until the practitioner asks to retire it (`references/retire-filing.md`). On a Writing of kind `unstructured` or `unstructured-<recipient>`, the conversion offer is made in the same turn (`references/unstructured.md` section 5).

**The follow-up to-do.** When the Sent write succeeds and the letter's own text asks its recipient to respond by a date it states, offer once, in the same turn, as one question, to add a to-do pointing to this letter: "Check for reply to <title>; next step if none", `<title>` being the Writing's title. Name the response date as the letter states it, and ask the practitioner for the to-do's BF date, the day to start that check: they state one, or confirm the letter's date as it. Never compute, suggest or offset a date, and never ask or say how long remains (`shared/deadline-isolation.md`). On a yes with a BF date, hand the to-do to `/task-prioritization` to add (its "Add a to-do"): that description, `filing_ref` `filing:<id>` naming this letter, and the practitioner's date as its one-shot BF date, with no deadline. A refusal because the letter already has an open to-do is answered as `/task-prioritization` says: relay its offer. Once the to-do is added, render the mockup (SKILL.md section 11) so the board's To Do line shows it. On a no, write nothing and never offer it again for this letter. A letter whose text states no response date gets no offer, and a refused Sent write gets none.

A venue's `letter` takes the pre-send hold like any other letter, and never the pre-filing gate (SKILL.md section 13), which reads an assembled package a letter lacks. Because the hold reads the latest render's inventory, a venue's letter must be rendered before it is recorded as sent.

**An internal memo** is sent the same way, by its own `Deliver` job (`/drafting-data`'s memo text for its stock job): circulated to its addressee in the firm, or put on file, then recorded as sent, with the pre-send hold as above, the citation scan included. Its copy as sent is the email that circulated it or, for a memo to the file, its PDF. Its signer is the lawyer stored at its creation.

## 9. Court correspondence

### Scope

This section covers **letters and emails to the court** — communications directed to court registries, judicial assistants, and court administration. It does **not** cover pleadings, affidavits, motions, applications, or other formal court filings. Those are a separate category.

The line between correspondence and filing blurs in a few places (requisitions being the main example). Where it blurs, this section notes it.

### Tone

Correspondence to the court is **formal, deferential, and concise**. Courts are busy. Registry staff process high volumes of material. Judicial assistants manage packed schedules.

- Be precise about what you need and why.
- Be courteous — never demanding, never impatient.
- Keep it short. A cover letter should rarely exceed one page. A request for a hearing date should state the request, the reasons, and the logistics, then stop.
- Use "respectfully" where appropriate, but do not grovel. Professional courtesy is the standard.

### Required Elements in Every Court Letter

Every piece of correspondence to the court must include:

1. **Court file number** — prominently placed, usually in the re: line or header.
2. **Style of cause** — full party names (e.g., *Doe v. Smith*).
3. **Nature of the matter or application** — briefly state what the letter concerns (e.g., "Re: Application for Summary Judgment" or "Re: Filing of Response to Civil Claim").
4. **Registry location** — identify the courthouse (e.g., Vancouver Registry, Supreme Court of British Columbia).
5. **Copies to opposing counsel** — note at the bottom if a copy has been sent to the other side, and to whom.

### Common Types in BC

#### Cover Letters for Filing Documents

When submitting documents to the registry for filing (e.g., a Notice of Civil Claim, an affidavit, or a consent order), include a brief cover letter that:

- Lists each document enclosed, with the number of copies.
- States whether you are requesting the registry file the documents or return stamped copies.
- Encloses the correct filing fee (or notes it is being paid online/by trust cheque).
- Requests return of filed copies if needed (include a self-addressed stamped envelope for mail filings, though electronic filing has largely replaced this).

#### Requesting Hearing Dates or Trial Dates

When writing to the registry or a judicial assistant to schedule a hearing:

- State the type of hearing (chambers application, trial, case planning conference, etc.).
- Provide your time estimate for the hearing.
- Indicate whether the other side has been consulted on available dates, and whether dates are agreed or contested.
- List any dates you or opposing counsel are unavailable.
- Reference any applicable scheduling rules or practice directions (e.g., trial management conferences required before trial in Supreme Court).

#### Requesting an Adjournment

- State the scheduled hearing date and what is being adjourned.
- Explain the reason briefly and factually — do not over-explain.
- Confirm whether the adjournment is on consent (attach a consent letter from opposing counsel if possible) or contested.
- Propose alternative dates if available.

#### Writing to a Judicial Assistant

Judicial assistants manage a judge's schedule and logistics. When writing to one:

- Address the letter to the judicial assistant by name if known.
- Be specific about what you need (confirming a date, providing a time estimate, advising of settlement, etc.).
- Copy opposing counsel on all communications.
- Never attempt to discuss the merits of the case. The judicial assistant is not a decision-maker and ex parte contact about substance is improper.

#### Responding to a Registry Request

Registries sometimes send deficiency letters — the filing was rejected or additional information is needed. When responding:

- Reference the registry's letter by date and subject.
- Address each deficiency specifically.
- Enclose corrected or supplementary documents as needed.
- Be prompt. Delays in responding can affect filing dates and deadlines.

#### Consent Order Submissions

When submitting a consent order (also called a desk order) for judicial approval:

- Include a cover letter explaining the order and confirming all parties consent.
- Attach the draft order with signature lines for the judge.
- Attach a brief summary of the factual and legal basis if the order is not self-explanatory (some judges require this; check local practice directions).
- Confirm that all parties or their counsel have signed the draft or provided written consent.

#### Requisitions

Requisitions are standardized forms used to request registry action (e.g., setting a matter for trial, issuing a subpoena, obtaining a default judgment). They straddle the line between correspondence and filing — they are filed with the registry but function as administrative requests.

- Use the correct court form (Form 17 in BC Supreme Court for most requisitions).
- A brief cover letter may accompany the requisition but is not always necessary.
- Requisitions are addressed in the applicable court rules and practice directions; follow those precisely.

### What NOT to Do

**Do not argue your case in registry correspondence.** A cover letter is not a brief. Do not explain why you should win, why the other side is wrong, or why the court should rule in your favour. Registry staff do not make legal decisions, and judges should not be exposed to argument outside the proper forum.

**Do not contact judges directly.** All communication with judges flows through the judicial assistant or the registry. Never write to a judge personally, email a judge's chambers without going through the assistant, or attempt to deliver materials directly to a judge.

**Do not make ex parte communications about contested matters.** If a matter is contested, the other side must receive a copy of anything you send to the court (with narrow exceptions for ex parte applications, which have their own procedural requirements). Failing to copy opposing counsel is a serious breach.

**Do not be informal.** Even where registries accept email, maintain the same formality you would use in a letter. No casual language, no first names for judicial officers, no abbreviations.

**Do not assume the registry will fix your mistakes.** If a filing is deficient, the registry will reject it — not correct it for you. Double-check forms, fees, and required copies before submitting.

### Examples

These are patterns to adapt, not fixed text. The letter's parts are fixed by its venue type file's layout block (section 3).

#### Example 1: Cover Letter Enclosing Documents for Filing

> [Letterhead]
>
> [Date]
>
> Supreme Court of British Columbia
> Vancouver Registry
> 800 Smithe Street
> Vancouver, BC V6Z 2E1
>
> **Attention: Registry**
>
> **Re: Smith v. Jones, Vancouver Registry No. S-123456**
> **Filing of Response to Civil Claim**
>
> Dear Sir/Madam:
>
> Enclosed please find the following documents for filing in the above-noted action:
>
> 1. Response to Civil Claim (2 copies); and
> 2. Filing fee of $[amount] by trust cheque.
>
> Kindly file the original and return one stamped copy to our office in the enclosed self-addressed stamped envelope.
>
> A copy of this letter has been sent to counsel for the plaintiff.
>
> Yours truly,
>
> [Signature]
> [Lawyer Name]
> [Firm Name]
>
> cc: [Opposing counsel name and firm]
> Encl.

#### Example 2: Letter to a Judicial Assistant Requesting a Hearing Date

> [Letterhead]
>
> [Date]
>
> [Judicial Assistant Name]
> Judicial Assistant to the Honourable Justice [Name]
> Supreme Court of British Columbia
> 800 Smithe Street
> Vancouver, BC V6Z 2E1
>
> **Re: Smith v. Jones, Vancouver Registry No. S-123456**
> **Request for Hearing Date — Application for Summary Judgment**
>
> Dear [Judicial Assistant Name]:
>
> We are counsel for the defendant in the above-noted action. We write to request a hearing date for the defendant's application for summary judgment pursuant to Rule 9-4 of the Supreme Court Civil Rules.
>
> The estimated hearing time is one-half day (3 hours). We have consulted counsel for the plaintiff, [name], who advises that the following dates are unavailable: [dates]. Our office is unavailable on: [dates].
>
> We would be grateful for any available date at the court's earliest convenience.
>
> A copy of this letter has been sent to counsel for the plaintiff.
>
> Yours truly,
>
> [Signature]
> [Lawyer Name]
> [Firm Name]
>
> cc: [Opposing counsel name and firm]

#### Example 3: Letter Notifying the Registry of a Consent Adjournment

> [Letterhead]
>
> [Date]
>
> Supreme Court of British Columbia
> Vancouver Registry
> 800 Smithe Street
> Vancouver, BC V6Z 2E1
>
> **Attention: Registry**
>
> **Re: Smith v. Jones, Vancouver Registry No. S-123456**
> **Consent Adjournment of Chambers Application Scheduled [Date]**
>
> Dear Sir/Madam:
>
> We are counsel for the defendant in the above-noted action. A chambers application is currently scheduled to be heard on [date] at [time].
>
> By consent of all parties, we respectfully request that the application be adjourned to [proposed new date], or to the next available date convenient to the court. The adjournment is required because [brief reason, e.g., "the parties are engaged in settlement discussions and require additional time"].
>
> Enclosed is a letter from counsel for the plaintiff confirming consent to the adjournment.
>
> Yours truly,
>
> [Signature]
> [Lawyer Name]
> [Firm Name]
>
> cc: [Opposing counsel name and firm]
> Encl.

## 10. Client letters

A letter to the client is drafting guidance only. It has no kind and no type file, never enters the tree lookup, never calls `/localize`, and is never a Writing: no Writing row, no job, no mockup and no hold in the drafting database, because solicitor-client correspondence has no place in the drafting database (ADR 0004). It is still on one Job Board, by a pointer to its folder (below, ADR 0042), and still held for counsel's review before it can be sent (below). What the law is comes only from `/legal-research`, here as anywhere (SKILL.md section 9).

Write the draft as a Markdown file in its own folder under the draft folder, named `{CODE} {description}` by `/file-naming`'s grammar and created if absent, because a client letter has no Writing folder (the workspace output rule, `.claude/skills/shared/workspace-output-rule.md`), and present it as a file card (`shared/present-files.md`). Never paste its text into chat. A revision rewrites that file and presents it again. Section 2 applies, and so does section 4, with its findings stated and decided in chat only: no table, list or note of them is written into the file or beside it, and none becomes a job, because a client letter is no Writing and its board holds no job for it. `/publish` renders only a Writing, so a client letter gets no Word document from it: never build or approximate the letterhead for one (section 7).

**On a Job Board** (ADR 0042). When the folder is first created, attach it to one Job Board through `/drafting-data`'s attach write, before presenting the first draft. Ask which board, naming each board `/drafting-data` reads for the matter, and offer as the default the board of the Writing this session holds. A matter with no proceeding gets a forum-less proceeding first, through `/drafting-data`. Attach the folder, never a file in it: the folder holds the review draft and, later, the send copy. Then render the board so its page lists the letter. The board shows the folder's name and reads the review draft's first line, the hold line below, at each render. Nothing else of the letter reaches the database: never write its title, its status or any of its text there. Move it to another board of the matter, or detach it, only when the practitioner asks, through `/drafting-data`'s move and detach writes. Detaching leaves the folder and its files where they are. The letter stays no Writing on its board: no job, no mockup, no Sent write, and its findings are still decided in chat. It stays attached after it is sent, until the practitioner moves or detaches it.

**Counsel's review before sending** (#1170). Every client letter, a transmittal note included, is held until a lawyer approves it, and the hold lives in its draft folder, never in any database. The file presented while drafting is the review draft, and its first line reads `Counsel's review: pending`. While that line reads pending, write no sendable copy of the letter anywhere. Only an active roster lawyer, the person on this machine, approves it. Read who that is from `/practice-data`'s firm profile, never from the conversation. On a staff machine, name the lawyer who must review it and stop. Approval is the lawyer's plain statement that the letter goes as it stands. A reply that also asks for a change is a revision, not an approval. That lawyer's request to send, publish or email out the pending letter, with no change asked, is their approval. On approval, rewrite the first line to `Counsel's review: approved by {roster name}, {YYYY-MM-DD}: "{the lawyer's words, verbatim}"`. Then write the send copy as an email draft, by section 8's covering-email step: `body` is the letter alone, with no status line and without its sign-off (`shared/email.md`), `folder` is the letter's own folder, `output_name` is `Send copy`, and `to` is the client's email address as the practitioner gives it or `/matter-data` holds it, never guessed. Present it as section 8 says. A revision after approval sets the first line back to pending. It also moves the send copy to the matter's `TRASH` with `file_ops__trash`, said in one line. If `file_ops__trash` is not available in this session, the `file-manager` plugin is not enabled: trash nothing, tell the practitioner that this step trashes a file and needs `file-manager`, and do nothing else for it. Never fall back to a shell `mv` or `rm` or the Write tool. A fresh approval writes the send copy again.

This guidance governs correspondence to your own clients — the people who have hired you and whose interests you represent. The goal is to inform, advise, and get clear instructions, without over-explaining or being paternalistic.

### Voice and Tone

Client emails from this practice are direct, practical, and analytical. They read like a smart advisor talking to someone they respect — not a lawyer performing for a file. Key characteristics drawn from practice samples:

- **Informal but professional**: Open with "Hi [Name]," not "Dear Mr./Ms. [Surname]"
- **Direct**: Lead with the point, not a preamble
- **Analytical**: Show your reasoning when a decision is on the table — lay out the pros, cons, and risks so the client can make an informed choice
- **Action-oriented**: Every email should end with a clear ask or next step
- **Non-patronizing**: Don't re-explain what the client told you. If they flagged something, acknowledge it and move on
- **Plain language**: No legalese. Explain legal concepts in plain terms when they're unavoidable
- **Numbered lists for next steps**: When there are multiple action items, use numbered lists so the client can track them
- **No over-promising**: Present options honestly, including risks

### Structure

1. **Opening** — Acknowledge what triggered the email (their question, a development in the file, something they sent over). Don't use a formal acknowledgment paragraph — fold it into the first line. E.g., "Thanks for sending this over." or "No significant updates to speak of."

2. **Body** — Deliver the substance. Use numbered or bulleted lists for action items, options, or next steps. For complex decisions, lay out the full picture: what could go wrong, what the upside is, and what you recommend. Trust the client to weigh the information.

3. **Close** — Ask explicitly for instructions if a decision is needed. End with "Shall I proceed?" or "Do you want me to [X]?" Don't leave the next step ambiguous.

4. **Sign-off** — "Yours truly, [Name]" (omitted from an email body: `shared/email.md`)

### What to Avoid

- **Don't repeat what the client already knows.** If they sent you the document, don't summarize the document back to them — they wrote it.
- **Don't make decisions unilaterally.** Present options with their tradeoffs and ask for instructions.
- **Don't be vague about risks.** If there's a downside, say it plainly: "The risk here is that this might cause them to stop making the $10,000 monthly payments."
- **Don't add unnecessary pleasantries.** Skip "I hope this email finds you well."
- **Don't use formal salutations with long-standing clients.** "Hi Glen" beats "Dear Mr. Ashby."
- Don't sound AI-generated. See `references/style-examples/ai-to-lawyer-style.md` for the tells and before/after examples.

### Examples

These are patterns to adapt, not fixed text.

#### Presenting next steps after a development

> Hi Glen,
>
> Next steps:
> 1. It's been 21 days since we served the Notice of Civil Claim, so you can now apply for default judgment. It takes about a week for the court to process the application, and if the court processes the application before the Defendants file their response, then you would get default judgment. At the very least, it forces the Defendants to file their reply and move the case forward faster.
> 2. Optionally, we can also apply for a garnishing order against the bank where the Defendants bank, rather than where its subsidiaries bank. The element of surprise will be gone, so they might have moved their money or paid off debts to reduce the amount of cash in their bank.
> 3. List documents (already started preparing).
>
> Possible next steps:
> 4. Apply for summary judgment, or summary trial (depending on how the Defendants respond). There are some hints that they might bring a counterclaim against you, if only for tactical reasons and to cause delay.
>
> Yours truly,
> [Lawyer Name]

#### Explaining a nuanced decision with tradeoffs

> Hi Glen,
>
> No significant updates to speak of. Really, it is a question of whether you want to apply for a pre-judgment garnishment order at the risk of jeopardizing the ongoing $10,000 payment that they seem to be continuing to make.
>
> [Explanation of the legal and strategic considerations]
>
> However, the first step is for you to decide whether to instruct me to proceed, given the risk that this might cause them to stop making the $10,000 monthly payments, and that if they get the garnishing order set aside, you might be ordered to pay them some legal costs.
>
> Shall I proceed toward making a garnishment application?
>
> Yours truly,
> [Lawyer Name]

#### Responding to a client forwarding a non-party's request

> Hi Glen,
>
> Thanks for sending this over. [Brief summary of what you're doing in response and the relevant figures.]
>
> [Key information, in plain numbered or bulleted form if multiple items.]
>
> Do you want me to respond to [non-party] directly on your behalf?
>
> Yours truly,
> [Lawyer Name]

### Formatting Notes

- Use plain `-` bullets, not `*`
- Dollar amounts use `$` with commas: `$10,000`, not "ten thousand dollars"
- Numbered lists for sequential steps or multiple options
- Keep paragraphs short — one idea per paragraph
- No bold headers within the email body unless it's a long email with multiple distinct topics
