Brief scoring and debating tips for my next run (style, word limits and evidence rules) are already in my instructions, so I have not repeated them. These notes cover what this debate taught me.

General method
- First split the suggestion into separate parts (content, layout, colour, wording). Argue each part on its own merits. The oracle tends to propose parts, so a part that loses as a whole can still be won by part.
- Before claiming "no structure", "no spec" or "free text", search `.claude/skills/shared/` and the calling skill for a published syntax or rule. Use the suggestion's own tokens (labels, connectors) as search terms, not guessed ones. I missed `paralegal-posture.md` §3b (the statement-of-goals grammar) and lost my lead point.
- Turn taste claims into numbers. For colour or readability, compute the WCAG contrast from the hex tokens in `source/lawyer/mcp/src/submission/forms/workboard-assets.ts`. The oracle rejected a recolour at 8.7:1 contrast after I had already conceded it. A measured number beats a design comment.
- Before offering a smaller alternative, check that its mechanics meet the stated requirement. A hanging indent built from leading spaces cannot line up wrapped text when label widths vary. That flaw lost me the label-column point.
- Read the code path end to end: storage, the gate on writes, the renderer, the CSS and the tests. Cite exact lines.

Repo facts worth reusing (re-verify before citing)
- The Job Board shell and its CSS live in `source/lawyer/mcp/src/submission/forms/workboard-shell.ts`. The goals card is `goalsCard()`. The statement goes into one `<p class="statement">` with `pre-wrap`.
- The statement of goals is stored as one `db_meta` JSON string (`board-goals.ts`). A change to display only is a patch under the version rule.
- `drafting-data/hooks/practitioner-words-gate.py` admits a confirmed statement only as the practitioner's own turn or an approved fenced block.
- E2E harness: `source/lawyer/mcp/test/workboard-file-url.e2e.test.mjs`.
- "No users yet" (memory) cuts both ways. The one installer is often the person who filed the suggestion.

<step2>
Lead with the strongest checkable fact, ideally a measurement or a published rule, not with cost. Put each claim through a test before using it: would a search of shared skills or a contrast calculation refute it? Name one smaller alternative and check its mechanics.
</step2>

<step3>
Attack the parts of the other side's case that are not needed to fix the shown defect. Look for a mistake in each of its cited facts. Pin down whether each part answers a stated user complaint or only a preference. Don't call a part "preference" when the suggestion asks for it outright.
</step3>

<step4>
Concede quickly what is clearly lost, and spend the words on the parts still open. Bring in a measurement if you have one.
</step4>

<step5>
Scoring: −1 for a contested point lost, 0 for a point conceded, +1 for a tie, +2 for a point won. Concede only what is clearly lost. Hold[characters in excess of 3000 have been truncated in accordance with the skill rules]