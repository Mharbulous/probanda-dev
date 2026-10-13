---
name: review-proposition
description: Use when presenting a proposition of law and its authority to the practitioner for review or rewording, such as a scrutiny finding review job. Fixed template, no commentary.
---

<!-- probanda v0.1.11 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# Review proposition

A fixed template for putting one proposition of law in front of the practitioner. Follow it strictly, in this order, with nothing added and nothing left out. It is a template, not a conversation.

The host shows every file card at the end of the turn, below all text, whatever order the calls are made in. So the template puts the text first and the cards last, and the turn ends on the cards.

## Before presenting

Do the work first, silently: locate the authority's own text, run the verbatim check on the stored excerpt (/verify-law Mode A, step 2), and build the highlighted page extracts (/show-me, Mechanics step 2). If the extract script exits 1, correct the span and rerun it as /show-me Mechanics step 2 says. If the verbatim check fails, or the extract still fails, stop and say what failed in one line instead of presenting. A passing check is not reported. For a scrutiny review job, `/draft`'s `drafting_forms__draft_harness` step `scrutiny_review` does this work in one call, and its files are presented cited first, context second and the finding last: the research lawyer's answer file at `finding.answer_file.path`, or `finding.file` when the finding names no answer file.

## The template

One proposition per turn. Exactly these parts, in this order, part 5 for a scrutiny review job only:

1. Job number and description, as a level-2 heading: `## Job <n>: <description>`. The description is the job's own title. Without a job, `## Review proposition`.
2. Current wording, labelled `Current wording:`, the full proposition in a code block.
3. Proposed re-wording, labelled `Proposed re-wording:`, the full proposed proposition in a code block. Where there is no proposed re-wording, this part is instead the one fixed line `No re-wording has been proposed.`, with no label and no code block.
4. Citation, as a block quote, formatted by the legal-citation skill.
5. Scrutiny review jobs only: the one fixed line `Decision needed: change (reword, re-point, new excerpt or new authority), keep as it stands over the finding, or drop.` It recommends, ranks and invites nothing else.
6. File cards, sent as the last action of the turn: the original authority's own pages, page-extracted, the pinpointed passage highlighted yellow (omitted or discrepant text orange, no other colours), cited pinpoint first, any cited-within authority's page next, context pages next, and the research lawyer's finding last, as its own file, in full and unedited, when there is one. Send the step's highlighted page-extract PDFs, the relevant pages only. Before sending, open one of the step's preview PNGs yourself and confirm the highlight covers the right text (/show-me, Mechanics step 2). The preview PNGs are never sent. Every card's filename names the case, page and paragraph.

In hosts where text written between tool calls is summarized rather than shown (Cowork), send every text part (1 to 5) through the host's direct user-message tool before sending the cards.

When the practitioner asks for the original or the full authority, send the file the step resolved, at its `source.path`, as it is. Never convert it, highlight it, or extract from it.

## Nothing else

- No introduction, no summary, no discussion, no explanation or justification of the re-wording. The proposed re-wording speaks for itself.
- No paraphrase of the finding (the finding itself is the last card), no excerpt-check result, no recommendation, no checklist, no closing question except the fixed decision line of part 5, no offer. The practitioner answers in their own words.
- Never state law and never write wording of the drafter's own. The proposed re-wording is the practitioner's or the research lawyer's, recorded as given.
- Never paste the stored excerpt into chat.
- When the text parts went through the direct user-message tool, the final reply is empty or one non-substantive line, and never repeats any part.

Where the authority's own text is not on file, replace the file cards with one line naming the folder searched.
