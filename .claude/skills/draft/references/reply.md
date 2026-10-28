Read when: the practitioner asks to reply to, answer or respond to a message from the tribunal, a court registry or another party's counsel ("reply to the arbitrator's email", `/draft reply <correspondent>`) and has not asked for a formal letter.
Assumes SKILL.md is loaded. Rules are not restated here.

# The reply route

A reply to a message is a plain markdown file at the top of the matter's `0. DRAFT` folder (ADR 0040). It is not a Writing. It has no job and no mockup, so the route takes no intake and no session entry's opening (`/work`'s section 6). It opens the drafting database only to attach the file to one Milestone (section 3, ADR 0042). A formal letter is not this route: one on letterhead, one with enclosures, or one the practitioner calls a letter goes by `references/letters.md`. Asked for one mid-route, leave the route and go there.

Two doctrines hold throughout:

- **Paralegal posture** (`shared/paralegal-posture.md`). The session states no law and originates no position. The reply's substance is the practitioner's, in their words. A question about what the law is goes to `/legal-research`.
- **Deadline isolation** (`shared/deadline-isolation.md`). A response time in the message, such as "by end of day" or "respond by Friday", is never an input. It is never repeated in chat, never computed or stored, and never a reason to trim the reply.

## 1. Tools and the matter folder

Load `drafting_forms__read_message`, `drafting_forms__reply_draft`, `drafting_forms__draft_harness`, `drafting_forms__open_session`, `drafting_forms__render`, `drafting_data__query`, `drafting_data__execute` and the file-card tool in one ToolSearch, with the host prefix variants as `/work`'s section 6 loads them. The matter folder comes by section 6's **Matter folder** rule, and is never searched for. Pass that absolute path as `matter_root` on every call.

## 2. Find the message

1. **Call `read_message`.** Pass `path` when the practitioner names the file. Otherwise pass `from`, the correspondent's name or email address as the practitioner gave it.
   - Given only a role ("the arbitrator"), ask for the name in one line.
   - A `no_match` refusal is said in one line, with how many messages it scanned. Then ask for the file.
2. **Present the message.** Show it as a file card (`references/present-files.md`), by `matter_root` joined to the returned `path`.
3. **One chat line**: sender, subject, and `sent`.
4. **List the highlighted phrases**, verbatim and in order, each followed by its colour: `"<text>" (yellow)`.
   - When `highlights` is empty with `highlight_source` `none`, say in one line that the message is plain text and carries no highlights.
   - When it is empty otherwise, say there are none.
   - Nothing else of the body goes into chat unasked. Never summarise, characterise or answer the message for the practitioner.

## 3. Draft and save

1. **Write from the practitioner's words.** A reply counts as dictation only when the practitioner supplies its sentences. A rough instruction, such as "tell her we agree, but not to the costs", is not dictation and goes to the scrivener. A reply the practitioner dictates is transcribed in their words, in the order they direct, with only its spelling, punctuation, grammar or word choice corrected: the dictation exception (`shared/correspondence-isolation.md`). No sentence, fact, position, deadline or tone is added, removed or changed. Any other wording, and any change beyond those four, is the `lawyer:scrivener` agent's: spawn it as `references/letters.md` section 3 says, the message being answered among its `facts`, and save its text verbatim. If the agent is absent, say so and stop.
2. **Name the draft by `/file-naming`'s grammar:** `YYYY-MM-DD ET <recipient> re <subject>`.
   - Use today's date and `ET` (email to).
   - The recipient token follows the grammar's author/recipient rules.
   - The subject is a few words from the message's subject line.
   - Add no `DRAFT` marker: the folder already marks a draft.
3. **Save every version with `reply_draft` step `save`, always under the same name.** The server writes `<name>.md`, or the next free ` vN` when that name is taken, and never overwrites (SKILL.md section 2, item 6).
   - A revision is always a new save. A saved version is never edited, and the file is never written any other way.
4. **Present the saved `.md` as a file card** (`shared/present-files.md`), then confirm the save in one line.
5. **Attach it to a Milestone at its first save** (ADR 0042), through `/drafting-data`, which owns every particular of the write:
   - Call `drafting_forms__open_session` with `matter_root`, for the database and the draft folder. A refusal is quoted in one line: the reply stays saved, on no board yet.
   - Ask which board the reply goes on, naming each board `/drafting-data` reads for the matter. The default offered is the board of the Writing the session holds, if it holds one. A matter with no proceeding gets a forum-less proceeding first.
   - Attach the saved file by `/drafting-data`'s attach write, then render that board so its page lists the reply, and confirm both in one line.
   - Each later save of the same reply re-points the attachment to the new version's file by `/drafting-data`'s move write, on the same board.
   - The earlier version's file stays in `0. DRAFT`, on no board, by design: only the latest version is on the board.
   - Move it to another board of the matter, or detach it, only when the practitioner asks. Detaching leaves every file where it is.
   - Nothing of the reply's text, title or status is ever written to the database: only the board and the path.

## 4. Chat on this route

There is no mockup here, so the chat rule's scope does not reach it (SKILL.md section 2, item 13, and section 3, "Chat is not the review surface").
- **Showing the draft.** When the practitioner asks, show the draft or any paragraph of it in chat, in a fenced code block, verbatim from the latest saved version.
- **Edits.** An edit typed back in chat is saved as the next version before anything else.
- **Unasked.** Chat only confirms a save or a file card in one line.

## 5. The final pass, on request

Run it on the latest saved version when the practitioner asks for a final check or a proofread. It reports and never rewrites. Every finding goes into one chat reply, with quoted text in code blocks.

1. **Typos and missing words.** List each with its paragraph and the correction, as a proposal.
2. **Quoted passages.** Send each one, inline or indented, through `/verify-law` Mode A as its own claim.
   - The excerpt is the bare quoted text.
   - The source is the authority the reply cites for it, or, for a quotation of the incoming message, that message's path. `/matter-data` resolves either.
   - Mode A's step 2 runs `diff_excerpt.py`. Report each result from the script's JSON alone: identical, or the differing words from its opcodes. Never judge a match by eye. A quote on a scanned page skips the script there and goes to Mode A's verifier with the page images: report that verdict, and say the page is scanned.
   - A quote whose source cannot be resolved is reported as unverified, with the reason.
3. **Citations.** Send each citation's pinpoint through `/verify-law` Mode A too, and report its verdict.
4. **Accepting a change.** Nothing changes until the practitioner says yes to an item. An accepted change is a new save (section 3).

## 6. Export

**The email.** When the practitioner asks to email the reply, or says it is final, write it as one unsent `.eml` by `shared/email.md`, the one route for any outgoing email: `drafting_forms__draft_harness` step `write_email`, loaded by ToolSearch with the host prefix variants.
1. **Review its facts first.** Run `references/source-trace.md` on the exact `body` below, `kind` reply, the message being answered among the `sources`, and resolve every finding. A reply is correspondence like any letter: it can be used as evidence of what it states.
2. **Pass** `matter_root`; `to`, the message's sender as `read_message` returned it, which the practitioner confirms in one line, never a guessed address; `subject`, `Re: ` and the message's subject; `body`, the latest saved version's text with no closing and no name, because the signature supplies them; `output_name`, the reply's stem; no attachments.
3. **Present the `.eml`** by `shared/email.md`'s Present rule: it opens in the mail program addressed, signed and From the firm address, ready to send. Each refusal is quoted in one line, as that file says.

**The Word copy.** When the practitioner asks for one:
1. **Run `reply_draft` step `export_docx`** on the latest saved `.md`.
2. **Present the `.docx` and the `.md` as file cards (`shared/present-files.md`).** Say in one line that the `.docx` is for pasting into Outlook.
3. **Taken names.** A taken name gets the next ` vN`, reported as `versioned_from`.

Nothing is sent: the practitioner sends from their own mail program (ADR 0032). With no Writing, there is no Sent record either. The sent message is filed with the matter's other correspondence. The reply stays attached to its board until the practitioner moves or detaches it.
