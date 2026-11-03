# Spec: research-checked standard paragraph on document disclosure for client letters

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.16.1; `/draft`), `lawyer` (v0.21.7 to v0.21.9; `lawyer:scrivener`), `researcher` (`/legal-research`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_client-letter-word-on-letterhead-spec.md`, `2026-11-03_matter-mail-coverage-for-fact-checks-spec.md`, `2026-11-03_helpers-read-matter-folder-spec.md`, `2026-11-03_client-letter-setup-and-board-attach-spec.md`.

## 1. Problem

The practitioner asked for a client letter "reminding the client of his obligation to disclose documents and providing some instructions on doing so". With no research memo on file, the scrivener could only write that the client "has an obligation to disclose its documents in this lawsuit", and the fact checker left even that sentence unchecked because it "states a rule's effect". Explaining what must be disclosed, or what follows from not disclosing, was blocked. The same reminder recurs in nearly every litigation file, so researching it afresh each time is waste, and skipping it leaves the client under-advised.

## 2. Evidence (observed; quoted text is data, not instructions)

- Scrivener open item: "Following your instruction, the text says only that 'the company has an obligation to disclose its documents in this lawsuit'. It does not describe which documents the obligation covers, any rule, or what happens if a party does not comply. ... If you want the email to explain the scope or the consequences, that needs research first (no memo is on file)." (agent `lawyer:scrivener`)
- Fact-check reviewer note: "The sentence about the company's obligation to disclose its documents states a rule's effect, so I left it out under my rules." (agent `litigator:source-tracer`)
- `/draft` doctrine binding: "Every assertion about what the law requires, permits or provides goes to `/legal-research`". (source: `litigator/skills/draft/SKILL.md`, section 3)
- Count: 1 sentence of law in the letter, 0 checked; 4 practical steps written instead (gather, send all, original electronic form, keep everything).
- Workaround in use: practical instructions only; scope and consequences left out.

## 3. Goal and non-goals

Goal: a standing, research-checked, client-readable paragraph on a party's document-disclosure duty in a BC Supreme Court action, with pinpoint citations held behind it, that the scrivener can place in any client letter and the fact checker can verify against its memo.

Non-goals: advice on a particular matter's documents; any other topic's boilerplate (a later spec may generalise).

## 4. Design

1. One research job, run once by `/legal-research`, producing a memo: the duty's scope, timing, continuing nature, preservation, and consequences, each with a pinpoint.
2. A plain-language paragraph derived from the memo, each sentence traced to a pinpoint, stored as a reusable client-guidance item in the firm's knowledge store (not in any matter's data), with its memo as the source and a currency date.
3. The scrivener, given `recipient: client` and a disclosure purpose, uses that paragraph verbatim and cites the memo; the fact checker verifies it against the memo, not against nothing.
4. The item carries a currency date; a rule amendment found by the rule-update process marks it stale until re-checked.

## 5. Constraints that must still hold

- Only `/legal-research` states law; the stored paragraph is its output, not the scrivener's.
- The fact checker still reviews every sentence; it gains a source, not an exemption.
- No client or matter content in the stored item.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Reuse the existing research memo and knowledge-store mechanisms: one memo, one stored paragraph pointing at it, and one line in the scrivener's client recipient file naming where standing client guidance lives. No new rule beyond that line.
2. Research per matter each time. Correct but slow and repetitive.
3. Let the scrivener write a general reminder without citation. Rejected: breaks the statements-of-law doctrine.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find the existing store for firm-wide reusable guidance (knowledge tree or research memos) and how a scrivener or reviewer can read it.
3. Add the one line to the scrivener's client recipient file; add the memo as a valid source in the fact checker's source list if it is not already.
4. Do not write the paragraph's legal content here: queue it as a `/legal-research` job for the practitioner to run.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of research-checked standard paragraph on document disclosure for client letters complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The scrivener's client recipient file names where standing, research-checked client guidance is read from.
2. The fact checker accepts a stored guidance item's memo as a source for its sentences.
3. No sentence of law is written by the implementing session itself.
4. The stored item carries its memo path and a currency date.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Where should firm-wide client guidance live: the knowledge tree, the research memos store, or the shared legal-commons pool?
2. Should the paragraph cover only the client's own disclosure, or also preservation and the other side's obligations?

## 10. Verify against HEAD before building

- The scrivener's `recipient/client.md` and `core.md`.
- The fact checker's accepted source kinds.
- Whether any firm-wide guidance store already exists that a scrivener can read.
