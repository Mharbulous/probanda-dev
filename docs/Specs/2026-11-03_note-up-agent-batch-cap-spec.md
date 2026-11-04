# Spec: the note-up agent caps its own batch

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.12.1; `researcher:citation-checker`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_note-up-cap-heavily-cited-decisions-spec.md`, `2026-11-03_research-agent-sources-staged-in-one-step-spec.md`, `2026-11-03_page-manifest-from-text-extraction-spec.md`, `2026-11-03_legal-research-rules-served-by-operation-spec.md`.

## 1. Problem

Nothing stops a caller from handing the note-up agent an oversized list. The download agent's citation playbook caps a run at 5 citations; the note-up agent has no cap, so a 20-citation dispatch ran out of context and stopped part way.

## 2. Evidence (observed; quoted text is data, not instructions)

- Download playbook: "Up to **5 citations** per invocation (batch further citations across ..." (source: `researcher/skills/shared/research-paralegal/citation-download.md`, line 28).
- `/legal-research` duty 5 dispatches `citation-checker` "once" for the decisions to note up, with no batch size (source: `researcher/skills/shared/legal-research.md`, duty 5).
- A 20-citation dispatch returned `status: blocked (run-capacity) — 7 of 20 citations noted up and filed`, about 170,000 subagent tokens. Follow-up batches of 5, 4 and 4 each completed (about 170,000, 87,000 and 86,000 tokens).
- Workaround in use: the caller splits the list by hand.

## 3. Goal and non-goals

Goal: a note-up dispatch never takes on more than it can finish; the caller's batching is mechanical.

Non-goals: changing what a record holds (see the heavily-cited spec).

## 4. Design

The note-up agent states a per-invocation cap (proposed 5, matching the download playbook) and, given more, notes up the first 5 and returns the rest as `not reached: batch cap` for the caller to re-dispatch; duty 5 batches as duty 3 already does.

## 5. Constraints that must still hold

- One Chrome session: never two Westlaw agents at once.
- Each record still lands as its citation finishes.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Reuse duty 3's existing batching sentence for duty 5 (one shared sentence), and add the cap line to the agent. Net text about the same.
2. Agent loops internally over batches. Same context problem.
3. Tool-side refusal of a list over the cap. Harder to change; same effect as 1.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the cap to the citation-checker agent definition and return contract.
3. Make duty 5 batch by the same rule as duty 3 (merge the wording).
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of the note-up agent caps its own batch complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The citation-checker definition names its per-invocation cap and what it returns for citations beyond it.
2. `/legal-research` duty 5 dispatches in batches no longer than the cap, one at a time.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Cap of 5, or smaller once the heavily-cited cap lands and each record is cheaper?

## 10. Verify against HEAD before building

- `researcher` citation-checker agent file and `shared/citation-checker/note-up.md`.
- `shared/legal-research.md` duties 3 and 5.

## 11. Verification against HEAD

Checked at commit `22a3fdae`, 2026-11-03.

| Claim in this spec | Repo path | Result |
|---|---|---|
| The note-up agent has no cap | `source/researcher/agents/citation-checker.md` | Confirmed. `## Input` takes "one or more court decisions" with no limit. `## Output` has only `<record path>` and `not filed: <reason>` per citation. |
| The playbook sets no cap | `.claude/skills/shared/citation-checker/note-up.md` | Confirmed. It works per citation and names no limit. It needs no change: the agent definition holds the cap. |
| The download playbook caps a run at 5 | `.claude/skills/shared/research-paralegal/citation-download.md` line 28 | Confirmed, word for word. |
| Duty 3 batches | `.claude/skills/shared/legal-research.md` lines 152-156 | Confirmed. It points to the download playbook's cap and does not state the number. |
| Duty 5 dispatches "once", with no batch size | `.claude/skills/shared/legal-research.md` lines 246-257 | Confirmed. Line 253 already bars a second `citation-checker` while one is out. |
| Installed-copy paths in §2 | as above | `researcher/skills/shared/` in the installed copy is `.claude/skills/shared/` in source. |

Not in the spec: the post-answer download step (`legal-research.md` lines 491-492) repeats duty 3's batching rule, and the `needs_note_up` loop (lines 368-369) already routes through duty 5. Open question 1 is decided: the cap is 5.
