---
name: show-me
user-invocable: false
description: "Use before any approval ask or sign-off, including a draft presented for sign-off, before any question to the practitioner about a specific document, even one asked again, and when the practitioner asks to see a Work Board or any job on it. Also before any reply that reports what a tribunal, court, arbitrator, opposing counsel or witness said or wrote (an email, letter, direction, order or ruling), asked for or not: quote the operative words verbatim first, with author, date and source."
---

<!-- lawyer v0.30.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Scope | Checking whether an approval, a choice, an authorization or a question about a document falls under this skill, a request to see a Work Board or a job, or reporting what a source said |
| The rules | Composing any approval ask: one decision, source file, full text, absences, the fixed order |
| Marking conventions | Highlighting a source file or writing its caption legend |
| Mechanics | Building the page extract and sending the files, text and question in order |
| Example | A bad and a good presentation are needed side by side |
| Related patterns | Finding the neighbouring skills and protocols that follow the same discipline |

This skill deliberately carries no `disable-model-invocation` line: `/timecamping`'s ceremonies open it
through the Skill tool, and its description must trigger it before every approval ask. It is a
stated exception. Do not add the line back.

# Show, Don't Tell

How to present a decision to a human for approval, once something has already decided that a human decision is needed. This governs presentation, not whether to ask — a candidate question still has to survive whatever decides that in the calling context (below). Get the presentation wrong and the human either rubber-stamps something they can't actually evaluate, or has to stop and interrogate you before they can even start deciding — both defeat the point of asking them at all.

## Scope

Applies inside any live exchange where an agent asks a human to approve, choose, or authorize something. It also applies to any question put to the practitioner about a specific document, whether the question is an approval, a factual one ("is this the letter that was sent?", "is this the signed copy?") or one already asked earlier in the session. In this repo that's mostly legal and accounting work — the housekeeping approval page, route-accounting routing-plan approvals, docket-clerk open items, draft filings or correspondence presented for lawyer sign-off, invoice/retainer approvals, apply-to-facts conclusions presented for confirmation, bookkeeping fact ratifications and write go-aheads (e.g. QBO entries) — but the discipline is domain-general: it governs any point where a skill asks a human to approve, choose, or authorize something, not only those.

It does not decide *whether* a candidate question needs a human at all — that call belongs to the calling skill's own judgment about what's consequential enough to interrupt the human for. This skill starts once the answer is yes; it governs only how that question gets presented.

A plain report of what a tribunal, court, arbitrator, opposing counsel or witness said or wrote is not an approval ask, and the rules below do not govern it. It follows `shared/report-what-a-source-said.md`: the operative words quoted verbatim first, with author, date and source, no summary in words stronger than the source's own, and the session's reading labelled "My reading:". When such a report leads into an approval ask, the ask follows this skill unchanged.

When the practitioner asks to see a Work Board, present its page as `shared/html-pages.md` ("Present each page by its path") says. Asked to see a job, present its documents as file cards instead, found from `board_card(jobs: [N])`: each memo on its `answers:` line, each attachment its `scope:` names (paths on the `attached` lane), and, for a Writing job, that Writing's mockups and `.eml` as `/draft` presents them, under its ban 20, and its published Word and PDF copies. Present the board's page only when the job has none. Never write the board's lanes, jobs, steps, goal or loose threads into chat.

## The rules

### 1. One decision at a time, in line

Present one decision per turn, and ask it as plain text at the end of the message. Do not use `AskUserQuestion` or any other widget for an approval. Present the next item only after the human has answered the current one.

Never merge two decisions into one item. Merging them makes the human untangle them before answering either. Where a calling skill defines one decision that covers several items, as `/draft`'s bulk approval in counsel's review does, that is one decision, not a merge.

If an answer would change a later item, re-present that later item after the answer. Never assume the answer.

### 2. Present the source, not a quotation of it

For any decision that turns on a document (an authority, a pleading, an affidavit, a record), send the document itself as a file the human can open, with the tool Mechanics step 3(b) names. Extract it to the relevant pages, highlight the relevant passage, and caption it with the document, the page, the paragraph or passage, and the colour legend (Marking conventions, below). The script in Mechanics step 2 builds the file.

Every time a question about a document is asked, that document's file card goes out in the same turn as the question, before the question text. A repeated question re-sends the card, even if the same file was sent earlier in the session or earlier in the turn: the practitioner answers from what is in front of them now, not from a card higher up the chat. A question that names several documents sends one card per document. A document that is not a file, such as a Writing held only in the drafting database or a mockup not yet rendered, has no card: render it first, or ask the question about the stored text in full (rule 8). A document the practitioner uploaded or named themselves this turn still gets its card, so the question and its subject sit together.

Quoting in chat is never a substitute for presenting the document. A quote can come with the file, but the file is the evidence. A prose description of what a document says, including a description of a discrepancy between two documents, is your interpretation of the evidence, not the evidence. It denies the human the chance to see something you read differently or missed entirely.

Where the item under review is itself a stored quotation (an excerpt), it is the thing being judged, not evidence. A stored excerpt is checked against the source by script (rule 9), and the practitioner sees it only as the highlighted passage in the source file. It is never pasted into chat.

A discrepancy is shown by highlighting both texts in the source file, never by quoting the two passages in chat.

When the decision turns on something purely visual (screenshots, images), render it before asking: send the image files, or display them inline.

If the decision turns on a document or an image and nothing has been presented to the human yet, the ceremony has not started.

The presented files and the full texts are exempt from every brevity, conciseness, or token-economy instruction, including user preferences for concise answers. Length spent presenting the source and the full current and proposed text is never waste. Presenting the practitioner's own matter documents back to the practitioner is not reproduction of third-party content, so present as much as the decision requires. A page extract of a public authority, presented as a file, is likewise fine.

**Worked example** (real 2026-09-01 incident, matter anonymized):

- **WRONG** (what happened): "your filed argument at para 12 says October 17, 2024, but the record says 2025 — was that intentional?" Working from the description, the practitioner confirmed it was intentional, wrongly.
- **RIGHT**: send the filed argument's pages holding paras 4 and 12 as one file, paras 4 and 12 in yellow and the two dates in orange, captioned "Filed argument, paras 4 and 12. Yellow: the two paragraphs that state the deadline. Orange: the two dates." Then ask one question: "Para 4 and para 12 give different dates for the same deadline. Which date is right?" The description produced the wrong answer because it put the agent's reading between the practitioner and the text. The marked document puts the text itself in front of the practitioner.

### 3. Present the full relevant context, not a curated slice

Show everything bearing on the decision, not only the narrowest window judged sufficient. If a specific time block or item is under review, include what's immediately before and after it, not just what falls strictly inside its boundaries. Deciding what's relevant is the human's job in this exchange — trimming the input to "what the agent judged necessary" makes that decision for them before they've seen it.

When several files or passages are presented, the cited pinpoint comes first and the surrounding context second, each as its own file, with captions saying which is which (e.g. "1 cited paras 44-45", "2 context paras 42 and 47").

### 4. Open with what is present, missing and unknowable

Before the question, state per source what was read, what is missing with its verified reason (rule 5), and what no source records. Never "data unavailable" or a bare "no screenshots". Where the calling skill has a script that prints this report, paste its output and write none of it by hand.

A gap is never a reason to ask what the practitioner remembers of an event whose local date is more than 60 hours before now. Ask only what the presented data shows, and offer no "don't remember" answer. Within 60 hours a memory question says three things: it asks for memory without reminders, an unclear memory is not to be claimed, and the data can be shown instead.

### 5. Verify an absence firsthand — never inherit a missing-data claim

Before telling the user something is missing or unavailable, check the real source of truth yourself, in the current session — read the actual database, filesystem, code, or API. Never state an absence because a prior session's ticket comment said so, because a note claims it, because you remember it from earlier, or because it seems plausible. State how you verified it: what you actually checked, and what you actually found.

A claim you haven't personally checked this session is a rumor, not a fact. If you must mention it before verifying, label it as unverified — never assert it.

This is the rule the Telus walkthrough broke hardest: told evidence was gone due to "retention cleanup" — a claim lifted from a prior session's ticket comment — the human pushed back ("I didn't authorize any retention cleanup"), which is what finally triggered an actual source check. The source check found no retention-cleanup feature anywhere in the codebase, and the real cause turned out to be a resolver path bug — the files had been there the whole time. The verification should have happened before the claim was made, not after the human caught it.

### 6. Make each question sharp and singular

State exactly what each item needs deciding — a specific categorization, a specific approve/reject, a specific choice among named options. A vague "what do you think?" pushes the framing work back onto the human. If you don't know what concrete question to ask, that means the problem isn't framed yet — go frame it, don't hand over a blank canvas.

### 7. The fixed order for a proposed change

When the decision is whether to make a proposed change, present it in this order:

1. The proposition, or other text being decided, as it stands, in full, in a code block. If the change is to the excerpt, give the one-line script result for the current excerpt here (rule 9).
2. The source document, presented as a file card (a page-extracted PDF), turned to the cited page, with the cited paragraph highlighted. Text the stored excerpt quotes is yellow. Text it omits, or where it differs from the source, is orange. The caption gives the document, the page, the paragraph and the colour legend.
3. The recommendation. Drafter-worded replacement text goes in full in a code block, never a fragment. A proposed excerpt is shown as its highlighted span in the extract plus its one-line script result (rule 9).
4. One plain-text question, ending the turn. No widget.

Nothing comes after the question.

A proposition of law under review is presented by `/review-proposition` instead. This order, the closing question of rules 1 and 6, rule 2's caption (the cards are the highlighted page-extract PDFs, and each filename names the case, page and paragraph), rule 9's one-line report of a passing check, and Mechanics steps 3 and 4 do not apply to it. Rule 9's verbatim check still runs before it.

### 8. Full, never partial

The current text and the proposed text are always shown in full in code blocks: propositions, clauses, entries, any drafter-worded text being decided. Never "..." fragments or a diff snippet alone. A diff can supplement the full text but never replace it. Excerpts: rule 9.

### 9. Excerpts are checked by script, never by eye

An excerpt is by definition a word-for-word copy of the source. Comparing it to the source is a script's job. Never paste a stored or proposed excerpt into chat, in a code block, in a diff, or in a quotation.

Before the decision turn, run the verbatim check (`/verify-law` Mode A, step 2) on every excerpt the decision touches, changed or not. Report one line: `verbatim, pages X-Y`, or one line per opcode of the form `differs: "<ours>" in our excerpt, "<source>" in the source`. The check ships in the `researcher` plugin. If the `verify-law` skill is not available in this session, the check cannot run: say in one line that the verbatim check needs the `researcher` plugin and was not run, and treat every excerpt as unchecked. A proposed excerpt then stays unproposed.

A proposed excerpt is cut from the source with `highlight_pages.py --excerpt-out` (Mechanics step 2), never typed. Run the verbatim check on the file. Exit 0 is required before the excerpt is proposed. If the check fails, change the span's start or end words and rerun. Never edit the file by hand. If it still fails, report the differing words and stop. The proposed excerpt then stays unproposed and the practitioner decides.

A scanned page is never read from its text layer (`/matter-data`'s design decision #71), and both `--excerpt-out` and the script check read it. So for a PDF source, call `pdf_pages__images` for the excerpt's pages first. On a page it returns as `scanned`, cut no excerpt with `--excerpt-out`, and a proposed excerpt there stays unproposed. A stored excerpt on such a page goes through `/verify-law` Mode A, whose step 2 sends it to its verifier with the page images: report that verdict in place of the one-line script result.

The file's text goes to the gatekeeper write as read from the file, never retyped.

## Marking conventions

- Yellow marks the passage relied on, or the text a stored excerpt quotes.
- Orange marks omitted text, discrepant text, or the exact word or words at issue.
- Every caption states the legend.
- Use no more than two colours.

## Mechanics

1. **Locate the source.** Find the document each decision turns on and the pages and paragraphs at issue. Verify any absence firsthand and write it up (rules 4 and 5). Do this before composing the question.
2. **Build the highlighted page extract** with the script, and check one rendered page image yourself before sending, to confirm the highlight covers the right text.

   ```bash
   python <absolute path of this skill's scripts/highlight_pages.py> <source> [--pages 12-13] --out <extract.pdf> --para 44 yellow --span "<start words>" "<end words>" orange --preview <png folder> [--excerpt-out <excerpt.txt>]
   ```

   Run it as one Bash call: the absolute script path, no `cd`, no variable, no pipe, no redirect. Resolve the path as the Installed copy note says, and again after a re-sync. The parser may print `Syntax Error` lines to stderr. They are harmless: leave them unfiltered.

   The source is a PDF, or a .doc, .docx or .rtf that the script converts with LibreOffice first, so a by-hand run of a Word source needs LibreOffice installed. `/draft`'s `scrutiny_review` host step converts with Word instead and hands the script a PDF. `--pages` is optional: without it every page is loaded and the pages written run from the first to the last page a spec lands on. `--para N` finds the line-leading paragraph numbers (`[N]`, `N.` or a bare number) that form the longest consecutive run in one column, so indented sub-lists and years are skipped. `--excerpt <file>` paints a stored excerpt, split on `[...]`, yellow where it matches the source and orange where the source differs or was omitted. `--para` and `--span` repeat as often as needed. A span can cross pages. The script prints one line per spec, found or not, with the tokens painted in its colour, and for `--para` and `--excerpt` adds `crossed page break` and `margin band: <words>` for painted words in a page's top or bottom 8 %. It exits 1 and writes nothing when any spec is not found or matches more than once: lengthen the words or correct the pages and run it again, and never send an unmarked file in its place. `--preview` writes one PNG per page. Open one and look at it. When a highlight crosses a page break, check the preview for painted running headers or footers. The optional `--excerpt-out` writes the single span's text to the file for the verbatim check and the gatekeeper write, and refuses a span that crosses a page. A bilingual report (an official S.C.R. PDF, English and French in parallel columns) is detected by itself: the script prints `layout: bilingual, English column`, and every spec finds and paints only that column, never the running header. Add `--lang fr` for the French column; `--columns off` reads each page whole, as before. In Cowork, write the extract to the session's outputs folder or a connected folder, then call `mcp__cowork__present_files` on it.
3. **Send in this order:**
   - (a) a message with the current drafter-worded text in full in code blocks, and for an excerpt its one-line script result
   - (b) the file or files, cited first and context second, as file cards. To show a file to the practitioner, use the card tool `shared/present-files.md` names, staging a PC file first on its fallback route.
   - (c) the recommendation with the full proposed drafter-worded text, and for a proposed excerpt its one-line script result
   - (d) the question, as the final text of the turn.

   In hosts where text written between tool calls is summarized rather than shown to the user (Cowork), send (a) and any other person-facing text through the host's direct user-message tool, so nothing is lost or reordered.
4. Immediately before composing the question, emit this checklist visibly in the message and check it off:
   `[ ] current drafter text in full  [ ] excerpt: one-line script result, no excerpt text in chat  [ ] source file presented, cited page, passage highlighted, legend in caption  [ ] context after cited  [ ] proposed drafter text in full  [ ] proposed excerpt: cut by script, check exit 0  [ ] one plain-text question, no widget`
   Print it fresh at this point every time. Having read the rules earlier in the session does not satisfy this step. It has to appear again, right here, right before the ask.
5. Wait for the answer before acting on anything that depends on it. Then present the next item.

## Example

**Bad** (what actually happened in ticket #420): a table of OCR text summarizing two captures that fell exactly inside an 18-second window, asking the user to categorize the block — no images shown, no context outside the window, no verification that those were the only captures available.

**Good**: send the two screenshot images inside the window under review first, captioned "1 under review: 14:02:03 and 14:02:21", then the captures immediately before and after it, captioned "2 context: the captures before and after the block". State the coverage in plain text before the question:

```text
Present: the capture store, read this session, 4 captures between 14:01:00 and 14:03:00
Missing: any capture between 14:01:40 and 14:02:03. Checked the capture store directly this session, and nothing is there
Unknowable: what was on screen in that gap
```

Then ask one plain-text question and end the turn: "This block runs 14:02:03–14:02:21. Category A or Category B?" No widget, no text after it, and the coverage was stated before the question, not discovered by the user asking why something is missing.

## Related patterns

- `time-entry-drafting` — a working example of propose-then-commit: nothing is written to the database until the human approves the draft.
- `shared/legal-audit-protocol.md`, "Unavailable ≠ broken — diagnose before you advise" — the same verify-before-you-claim-absence discipline as rule 5, applied there to legal research sources.
