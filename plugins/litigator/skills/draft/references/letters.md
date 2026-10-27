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

A letter's words are the scrivener's (`shared/correspondence-isolation.md`). This file holds the letter as a document: its audience, its parts, its checks, its sending. The `lawyer:scrivener` agent writes its body (section 3).

## 1. The letter and its audience

A letter to anyone but the client is a Writing. A standalone request for one opens this skill like any other: it is saved first on its proceeding, whether or not the proceeding has a forum (SKILL.md section 8), drafted through the gatekeeper, and reviewed on its mockup (SKILL.md section 11), never in chat. A letter to the client is never a Writing (section 10). Nor is a reply to a message from the tribunal or counsel, asked for as a reply and not as a letter: it follows `references/reply.md`.

Before drafting anything, identify who the letter is going to. Each audience calls for a different tone, structure, and set of rules. If unclear, ask: "Who is this addressed to?" When the request for a letter states no purpose either, ask for it in the same question, before reading the file (SKILL.md, "Purpose comes from the practitioner"). An email is never held back for its purpose: with none stated, its `.eml` is written with an empty body (section 8, "An email Writing").

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

Once the audience is known, read its type file before drafting. It holds the letter's layout and routing, such as whether the firm may write to that recipient at all, and names the scrivener's file for that audience's wording.

**Ingestion check.** It comes after the draft, never before. A requested letter, email or memo is drafted from the case data on file and shown, as its mockup or, for an email, its `.eml`, before any ingest is run or offered, and nothing about ingesting is asked before then. A letter that is a Writing and is drafted under a job, its `Availability letter` job or, on a letter saved before 2026-10-23, its `Draft the letter` job, is checked by that job's input check (`work/references/job-session.md`, "The input check"), not here, which on a requested draft also runs after the draft. A letter, email or memo drafted with no job, and a client letter, which is no Writing and has no job, make one coverage check in the turn the draft is first shown, after it is shown. One call in that turn, never a second, and a later revision does not run it again. A draft whose text was written in an earlier turn never runs it. Ask `/matter-data` for the ingest coverage of `2. SOLICITOR CLIENT*`, `3. CORRESPONDENCE*` and `5. COURT*`, the first two counting as correspondence. Never read a mailbox: an email is case data only once it is saved into the matter folder and ingested. Report the result in one line. A clean result is worded by `work/references/opening.md`, "The ingest-coverage clause", leaving discovery out since this check does not cover it. With files to ingest, the line counts them, gives the newest ingested correspondence date, says counsel may have changed and asks once, for example `4 correspondence and court files since 2026-09-14 are not yet in the file, and counsel may have changed. Shall I bring them in?` (with no dated correspondence held, leave out `since <date>`). Any damaged record, unreadable file or missing folder is named in the same line, as that clause names it. On a yes, run for each file what that clause offers it: `/ingest`, or, for a file that may be another version of a source case data holds, `/matter-data`'s supersede of the pair, with its cards. On a no, nothing changes. The check itself writes nothing, and the draft already shown stands either way. A `/matter-data` error is quoted in one line: never say the file is ingested when the check could not run. In an unattended run (`/work`'s section 14), anything but the clean line stops the run and goes in its report.

**After the ingest.** When an ingest run on that yes changes counsel of record for a party the draft is addressed to, show the draft again with the new counsel, without re-running the drafting setup: an email addressed from case data (`to_service_list` or `filing_id`) is written again by `shared/email.md`'s `write_email` with the same arguments, which gives it the next " vN", and a letter or memo's mockup is rendered again, since its recipients read counsel from case data. Say in one line what changed: who was counsel for that party and who is now. An email addressed to typed addresses is not written again: name the change in that line and leave the addresses to the practitioner.

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

Every letter type lays out the standard letter elements as parts of their own: the date, the address, the salutation, the RE: line, the body, and the signature block, whose closing is the signer's. Write each into its own part. The RE: line identifies the matter and includes the file number, and the date part dates the letter.

**The body comes from the scrivener** (`shared/correspondence-isolation.md`). This session composes and revises no sentence of a letter's body, an email's body or a covering note. Spawn the `lawyer:scrivener` agent for the body, with:

- `recipient`: the audience's `recipient` in section 1, `court` for a venue's letter, `client` for a client letter.
- `capacity`: `counsel-of-record`, or `firm-as-creditor` when the letter is about the firm's own account with its client.
- `mode`: `without-prejudice` when the letter makes a settlement offer or concession, otherwise none.
- `audience`: who else may read it, when the practitioner or the type file says.
- `purpose`: in the practitioner's words.
- `facts`: each fact the letter is to state, with its source locator, section 2's documents among them. Locators only: never a summary of what a source says.
- `matter_root`.

Relay each open item it returns to the practitioner, collect the answer, and spawn it again with the answer, naming the item, until none remain, as for `lawyer:docket-clerk` (`shared/deadline-isolation.md`, "Calling docket-clerk"). A statement of law it returns goes to `/legal-research`, a date to `lawyer:docket-clerk`, and a position conflict with the firm's earlier correspondence is a Pass 2 finding (section 4). Place the returned `text` into the body part verbatim, character for character, and keep its `sources` lines as the source-trace review's `sources`. If the agent is absent, say so and stop: never write the body here. The one exception is dictation: the practitioner's own words, transcribed, with only their spelling, punctuation, grammar or word choice corrected. No sentence, fact, position, deadline or tone is added, removed or changed.

Record each case the letter's own sentences rely on or characterize, one it answers included, through `/drafting-data` as a lead statement of law linked to this Writing, in the same write that records the statement. A case that appears only inside opposing text the letter quotes is not linked. A case or enactment the letter's text cites, by citation or by a case name in italics, that no authority row tracks prints `📇 Cited but not tracked` on the mockup and holds sending under `noting-up` until it is recorded (`/drafting-data`'s `filing-checklists.md` §6b). Scrutinizing such a statement (🔬) checks its fit against the letter's sentence that cites it.

## 4. The five passes

Before presenting the mockup of any letter, five passes run over the body's actual sentences, as the mockup prints them. These are distinct checks: passing one does not imply passing another. Passes 2 to 4 (position consistency, exploitation and voice) are the scrivener's, run over its own sentences before it returns them (`shared/scrivener/references/core.md` section 2). This session runs Passes 1 and 5.

**Pass 1 — Facts.** Verify every date, amount, name, quotation, and rule citation against the source documents gathered in section 2. Check terminology consistency with the record (e.g., a "summary trial" application must not become "summary judgment" mid-thread). A single impossible date or shifted term reads as carelessness to a judge and undercuts the letter's authority. On every render, flag any "[date] [document type]" (email, letter, order, report) fitting more than one named or enclosed document.

**Pass 5 — Overstatement.** Pass 5 is the overstatement review, `references/overstatement.md`, run on every letter, scheduling and transmittal notes included. Its assertions, its checks of each one, its verdicts and its decisions are that file's, with two additions for a letter:

- **(e) What a cited case says at the pinpoint.** Compare the sentence with the saved decision's words at the pinpoint, words only, as for a provision. A pinpoint taken from a research memo or case brief is a lead: name that memo as the finding's source, and do not report it supported until it has been checked against the decision. A citation attached to a sentence that states no proposition of law, such as the firm's own intended action, is unsupported.
- **(f) Its rewrite is the scrivener's.** A finding's rewrite at the source's strength is written by the scrivener, given the finding as its `instruction`, never composed here.

Every fix Passes 1 and 5 call for is a revision the scrivener writes (section 5). Then run the source-trace review, `references/source-trace.md`, and present the mockup as SKILL.md ban 20 allows.

**Findings go to the Job Board, never into the letter or beside it.** No open-items list, no findings table, no report file and no file card: the mockup's work markers show where open work is, and the board holds why. State each finding to the practitioner in one line in the turn it is found, quoting the draft's words and the source's. A finding they resolve in that turn is never written down. Each one left undecided becomes one `/drafting-data` §3g job, under its pass's fixed title:

- **Pass 1:** a date, amount, name, quotation or citation that cannot be put right from its source in this turn, a source not located included.
- **Pass 2:** every position conflict the scrivener returns, a position that requires changing or damage control. That is a strategy decision counsel owns, never a silent edit, so the session states it and never fixes it. It stands as a job unless counsel decides it in that turn, and while the job is open the letter is held from being recorded as sent (section 8, `position-conflict`).
- **Pass 5:** each flagged assertion not decided in the turn (`references/overstatement.md`, "Findings").
- **Passes 3 and 4** write nothing: the scrivener fixes what they catch before it returns the text.

Before writing a finding, read the board's `live` lane (`drafting_forms__board_card`) and, in the line that states the finding, name any open job that appears to cover it already, such as a research job on the same point. Write the finding unless the practitioner says that job covers it. A finding already on the board is caught by §3g's guard and written once only. A client letter is no Writing, so its findings become no job (section 10): they are stated and decided in chat and written nowhere.

## 5. Revising

A revision is asked for and re-rendered like any other (SKILL.md section 12), and its words are the scrivener's: spawn it with `prior_draft`, the body as it stands, and `instruction`, the practitioner's request or the finding to fix, and place its text verbatim (section 3). A dictated change is the exception, as section 3 says. Present a **clean revision by default** — no markup showing what changed. Only blackline a revision when the practitioner explicitly asks to see the changes (e.g., "show me the changes," "blackline this," "what changed").

When blacklining is requested:

- **Additions**: wrap new text in `**bold**` markdown so it renders as bold
- **Deletions**: wrap removed text in `~~strikethrough text~~` markdown so it renders as struck through

A blackline is a document for the practitioner, written in the letter's Writing folder (SKILL.md section 13), and presented as a file card (`shared/present-files.md`). It never enters the Writing. Pass 5 reruns on every assertion a revision adds or changes (`references/overstatement.md`, "Revisions"). Pass 1's date-reference check reruns letter-wide each re-render. The scrivener reruns Passes 2 to 4 over the whole text on every revision.

## 6. Dates in a letter (ADR 0024 D7)

- **The other side's missed deadline is content** (`shared/scrivener/references/core.md` section 3). The practitioner's own deadlines, past or future, stay isolated (`shared/deadline-isolation.md`).
- **The date check keeps running for it.** Pass 1 checks the cited date against the order that set it, and Pass 5 checks that the letter states it at the order's strength, condition included.
- **Hearing dates.** Give the scrivener only the open days this session fetched from `/practice-data` court-calendar-days, and dates the practitioner states. Never look up or compute another date.

## 7. The Word document

Once the drafting conditions all hold (SKILL.md section 13), `/publish` with `publish-general` makes the letter's Word document on the firm's registered letterhead. Present the letter's enclosures as file cards (`shared/present-files.md`) beside it, with no approval asked. Pass findings are on the Job Board, never a card (section 4).

**Never rebuild the letterhead.** Do not write the document from scratch with docx-js, python-docx, or any other document builder, and do not reconstruct the letterhead as styled text. A letter assembled by eye lands about an inch off every other letter in the file and is worse than no letter at all. If `publish-general` stops because the letterhead or an author field is missing, say so, name what is missing, and ask the practitioner how to proceed. Never approximate the letterhead to keep the workflow moving. This rule governs a letter on letterhead. The reply route's `.docx` carries no letterhead and is built by its own tool for pasting into Outlook (`references/reply.md`).

## 8. Sending

`Deliver` is the letter's last job, blocked by the `Availability letter` job when the letter was saved under it, by `Draft the letter` on a letter saved before 2026-10-23, and otherwise by nothing. Its first step, sending the letter to its recipients, is the practitioner's own act. Its second, `Record the letter as sent`, is `/drafting-data`'s Sent write, `drafting_data__record_sent`: the date the letter went, and the copy as sent, either its file (a `.pdf`, a `.msg`, or a `.eml` saved from the mail program after sending) or its text as pasted. Only an active roster lawyer, the person on this machine, records it. On a staff machine, name the signing lawyer and stop.

**Whether it went out is checked, never asked.** Before any question about whether a letter was sent, delivered or received, and at the opening of a letter whose `Deliver` job is open while a dated or signed copy of it sits in the correspondence folder, run the delivery check (`references/delivery-check.md`). It finds the evidence, updates a draft that differs from the letter as sent, and records the letter as sent, without asking.

**The covering email.** A letter goes by email as an attachment to a covering email, and the model never sends it. A practitioner's request to send, publish or email out a drafted email or letter means this step, written by `shared/email.md`: `write_email`, never a mail send tool. Pass `to` and `cc` from the emails of the Writing's `To` and `Cc` recipients through `/drafting-data`, `subject` from the letter's RE: line, and as `body` a short covering note the scrivener writes (section 3), with no closing and no name, because the signature supplies them. `attachments` is the signed letter PDF the practitioner names, at any path. Never attach a file ending ` UNSIGNED.pdf` unless the practitioner names it. With no signed file named, write the draft without it and say in one line to attach the signed letter before sending. The covering note passes SKILL.md ban 20 before `write_email`. Present the draft and its attachment as `shared/email.md` says (SKILL.md section 11, step 4).

**An email Writing.** A Writing the practitioner asked for as an email goes out as an email draft, with no send request needed. An email is never drafted in chat. On the request itself, its `.eml` is written and shown first, before the email is saved as a Writing, and the save, its `Deliver` job and its first mockup follow in the same turn (SKILL.md, "An email request writes the `.eml` first"), then the one coverage check (section 1, "Ingestion check"). With no purpose stated, its body is empty until the practitioner says what it is for. Its body then comes from the scrivener, or from the practitioner's dictation (section 3). After that, each time a revision of it is presented, write its `.eml` by `shared/email.md` in the same turn, as ban 20 allows: `body` is the email's text, with no closing and no name; `to` and `cc` are the emails of the Writing's `To` and `Cc` recipients through `/drafting-data`; `attachments` are the files it encloses; `folder` is the Writing's own folder. Present the mockup, then the `.eml` and each attachment as `shared/email.md` says. A client letter whose first line reads `Counsel's review: pending` gets no `.eml` until approved (section 10). Everything else (output name, signature, refusals, presenting) is as `shared/email.md` says.

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

This section covers **letters and emails to the court** — communications directed to court registries, judicial assistants, and court administration. It does **not** cover pleadings, affidavits, motions, applications, or other formal court filings. Those are a separate category. The scrivener writes the body, with `recipient` `court` (`shared/scrivener/references/recipient/court.md`).

The line between correspondence and filing blurs in a few places (requisitions being the main example). Where it blurs, this section notes it.

### Required Elements in Every Court Letter

Every piece of correspondence to the court must include:

1. **Court file number** — prominently placed, usually in the re: line or header.
2. **Style of cause** — full party names (e.g., *Doe v. Smith*).
3. **Nature of the matter or application** — briefly state what the letter concerns (e.g., "Re: Application for Summary Judgment" or "Re: Filing of Response to Civil Claim").
4. **Registry location** — identify the courthouse (e.g., Vancouver Registry, Supreme Court of British Columbia).
5. **Copies to opposing counsel** — note at the bottom if a copy has been sent to the other side, and to whom.

### Recipients and enclosures

- Copy opposing counsel on every letter to the court or a judicial assistant. A letter about a contested matter always goes to the other side too, except under an ex parte application's own procedure.
- Never address a letter, or deliver materials, to a judge directly: only to the judicial assistant or the registry.
- Enclose what the letter names: the documents for filing and the filing fee, a consent letter from opposing counsel, a draft consent order with signature lines for the judge, corrected or supplementary documents.
- Answer a registry's deficiency letter promptly: delays can affect filing dates. The registry rejects a deficient filing rather than correcting it, so check forms, fees and copies before submitting.

### Requisitions

Requisitions are standardized forms used to request registry action (e.g., setting a matter for trial, issuing a subpoena, obtaining a default judgment). They straddle the line between correspondence and filing — they are filed with the registry but function as administrative requests.

- Use the correct court form (Form 17 in BC Supreme Court for most requisitions).
- A brief cover letter may accompany the requisition but is not always necessary.
- Requisitions are addressed in the applicable court rules and practice directions; follow those precisely.

## 10. Client letters

A letter to the client is drafting guidance only. It has no kind and no type file, never enters the tree lookup, never calls `/localize`, and is never a Writing: no Writing row, no mockup and no hold in the drafting database, because solicitor-client correspondence has no place in the drafting database (ADR 0004). It is still on one Job Board, by a pointer to its file (below, ADR 0042), may have jobs (below), and is still held for counsel's review before it can be sent (below). What the law is comes only from `/legal-research`, here as anywhere (SKILL.md section 9).

Write the draft as a Markdown file directly in the draft folder, named by `/file-naming`'s grammar, `YYYY-MM-DD ET Client re {subject}.md` (its send copy is emailed), because a client letter has no Writing folder (the workspace output rule, `.claude/skills/shared/workspace-output-rule.md`), and present it as a file card (`shared/present-files.md`). Never paste its text into chat. A revision rewrites that file and presents it again. Section 2 applies, and so does section 4, with its findings stated and decided in chat only: no table, list or note of them is written into the file or beside it, and none becomes a job. `/publish` renders only a Writing, so a client letter gets no Word document from it: never build or approximate the letterhead for one (section 7).

**On a Job Board** (ADR 0042). When the file is first written, attach it to one Job Board through `/drafting-data`'s attach write, before presenting the first draft. Ask which board, naming each board `/drafting-data` reads for the matter, and offer as the default the board of the Writing this session holds. A matter with no proceeding gets a forum-less proceeding first, through `/drafting-data`. Attach the review draft's file. Then render the board so its page shows the letter's card. The board shows the file's name and reads its first line, the hold line below, at each render. Nothing else of the letter reaches the database: never write its title, its status or any of its text there. Move it to another board of the matter, or detach it, only when the practitioner asks, through `/drafting-data`'s move and detach writes. Detaching leaves the file where it is. The letter stays no Writing on its board: no mockup, no Sent write, and its findings are still decided in chat. It may have jobs, created on its board or linked with `/drafting-data`'s link write, and the board counts its pending ones on its card. A job's title, intent and steps name the file and the task (`Finish 2026-10-27 ET Client re award for counsel's review`), never the advice, the client's instructions or a finding. It stays attached after it is sent, until the practitioner moves or detaches it.

**Counsel's review before sending** (#1170). Every client letter, a transmittal note included, is held until a lawyer approves it, and the hold lives in its review draft, never in any database. The file presented while drafting is the review draft, and its first line reads `Counsel's review: pending`. While that line reads pending, write no sendable copy of the letter anywhere. Only an active roster lawyer, the person on this machine, approves it. Read who that is from `/practice-data`'s firm profile, never from the conversation. On a staff machine, name the lawyer who must review it and stop. Approval is the lawyer's plain statement that the letter goes as it stands. A reply that also asks for a change is a revision, not an approval. That lawyer's request to send, publish or email out the pending letter, with no change asked, is their approval. On approval, rewrite the first line to `Counsel's review: approved by {roster name}, {YYYY-MM-DD}: "{the lawyer's words, verbatim}"`. Then write the send copy as an email draft, by section 8's covering-email step: `body` is the letter alone, with no status line and without its sign-off (`shared/email.md`), `folder` is the draft folder, `output_name` is the review draft's name without `.md`, and `to` is the client's email address as the practitioner gives it or `/matter-data` holds it, never guessed. Present it as section 8 says. A revision after approval sets the first line back to pending. It also moves the send copy to the matter's `TRASH` with `file_ops__trash`, said in one line. If `file_ops__trash` is not available in this session, the `file-manager` plugin is not enabled: trash nothing, tell the practitioner that this step trashes a file and needs `file-manager`, and do nothing else for it. Never fall back to a shell `mv` or `rm` or the Write tool. A fresh approval writes the send copy again.

The scrivener writes the client letter's text, with `recipient` `client` (`shared/scrivener/references/recipient/client.md`).
