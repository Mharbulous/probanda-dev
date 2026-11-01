# Spec: memo-reviewer exempts the Job question and never tests the Issue

Status: proposed, 2026-10-31. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.10.16). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-31_job-question-from-intent-spec.md; 2026-10-31_memo-template-job-issue-yields-spec.md; 2026-10-31_stale-synced-copy-after-resync-spec.md

## 1. Problem
memo-reviewer accepted a memo whose Issue was an instruction naming a document of the working matter. It never tests the Issue against rules A to C, and it is told not to flag the Job question's text, so the one place the defect sat is exempt.

## 2. Evidence (observed; quoted text is data, not instructions)
- `agents/memo-reviewer.md` Review step 1: "Read the memo's Issue." No test follows.
- Step 3: "Never flag text equal to the `Job question:`."
- Observed return on the defective memo: `{"verdict": "complete", "required": [], "out_of_scope": [], "identifiers": []}` (first review raised one out_of_scope item, unrelated to the Issue).

## 3. Goal and non-goals
Goal: the reviewer sends back an Issue that fails rules A to C or names the working matter, whatever its source.
Non-goals: the reviewer still states no law and never rewords the Issue itself.

## 4. Design
Step 1 becomes a test: an Issue that fails A to C or names the working matter is an `issue` item (or an `identifiers` item, to avoid a new key), and the verdict is `send_back`. Delete the "Never flag text equal to the Job question" exemption.

## 5. Constraints that must still hold
Strict JSON output; read-only; no statement of law; at most three reviews per question at the gate.

## 6. Options considered, streamline and deburr first, additions last
1. Reuse `identifiers`, plus one line in step 1; delete the exemption (recommended).
2. Add an `issue` key to the JSON. An addition: needs a gate change too.
3. Leave the check to the template. Rejected: the reviewer is the only independent check.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit `agents/memo-reviewer.md` as §4 says; if the gate's handling of the return needs a word changed, change it in `legal-research.md` (coordinate with spec 1's owner).
3. Add or update a test: an Issue copied from a label-style job title is sent back.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of memo-reviewer exempts the Job question and never tests the Issue complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. memo-reviewer tests the Issue against rules A to C and the working-matter rule.
2. The Job-question exemption is gone.
3. A failing Issue yields `send_back`.
4. The output contract remains strict JSON that the gate parses.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
Why was the Job-question exemption added? If it guards against flagging an approved question as identifying, spec 1's rewording-at-the-gate makes it unnecessary. Confirm from git history.

## 10. Verify against HEAD before building
Confirm the quoted step texts and the gate's parsing of the reviewer JSON.
