Read the code path before arguing. Find the renderer, the CSS, the stored shape and any skill that defines the input format. The strongest point is usually a published syntax or contract in a skill under `.claude/skills/` that the code ignores. Grep the suggestion's literal phrases (such as "or alternatively") across `.claude/skills` first.

Rendering and Job Board facts:
- The Job Board shell is `source/lawyer/mcp/src/submission/forms/workboard-shell.ts`. Its tokens are in `workboard-assets.ts`. Its e2e harness is `source/lawyer/mcp/test/workboard-file-url.e2e.test.mjs`.
- The rule for display-only changes is that a change to storage, schema or tool inputs is a minor release. Anything else is a patch. Say which one applies, with the file that shows it.
- Check Commandments 5 and 7 briefly, and say so when they do not apply.

Scoring: −1 lost, 0 conceded, +1 tie, +2 won. Concede early any point where the other side has the facts. Hold the points that rest on an exact phrase in the user's request.

<step2>
- Offer a narrower variation that fixes the defect you can show. Keep separate any part that is preference only, such as colour. Recommend splitting it into separate parts so Brahm can reject one and keep the other.
- Compute measurable claims yourself, such as contrast ratios from the token hex values, before relying on them. Do not lead with a claim that measurement would refute.
- Name the cost honestly: the files, the tests and the selectors that break.
- Name any existing test harness that can express the change. It answers "no way to verify".
</step2>

<step3>
- Check every repo claim the black hat makes by reading the cited lines. It often searches for the wrong tokens or quotes half a docstring. Quote the other half.
- Separate "the fallback preserves today's behaviour" from "a silent failure". A verbatim fallback is no hidden loss.
</step3>

<step4>
- When the black hat proposes a smaller fix, accept it as the floor. Then argue only for the increment that meets an explicit phrase in the request it cannot meet. In the last triage that was "align under the start of the text", which needed label widths.
- Find existing signals that make a feared clash moot, such as a caption or a trailing `?` that already marks inferred text.
</step4>

<step5>
- Concede preference items and any cost you understated. Contest only the points that rest on the request's wording or on a minimal exact match against a published syntax. Make each contested point concrete: an example input, and why the smaller fix fails on it.
- End with a single final position naming what to take and what to leave.
</step5>

Avoid:
- Changing an existing semantic marker, such as inferred italic, to make room for the request's styling. It loses the point.
- Recolouring half a component. It gives one card two looks.
