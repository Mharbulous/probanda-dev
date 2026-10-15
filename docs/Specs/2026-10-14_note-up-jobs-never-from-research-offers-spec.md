# Spec: note-up jobs are created from research offers by inference

Status: proposed, 2026-10-14. Written in a matter session; implementation is handed to Claude Code.
Plugin: `probanda` (installed copy seen at v0.1.14). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise. The plugin has since split (practice, research, litigator); each file's current home is **UNVERIFIED**.
Related specs, same date: `2026-10-14_note-up-all-cited-authorities-single-job-spec.md`, `2026-10-14_noting-up-criterion-on-every-citing-writing-spec.md`, `2026-10-14_note-up-staleness-30-days-spec.md`

---

## 1. Problem

After a `/legal-research` return, the relaying session sorts each Step 5 follow-up offer against the board and writes a job, with no question asked, for every offer it judges "on the application". Offers whose work is noting up an authority, or reading the cases a citator lists as citing it, pass that sort. In one matter this produced three jobs that were only note-ups (two "verify whether <citing case> treats <case>" and one "Westlaw KeyCite note-up of <three cases>"). None of the authorities was cited by the Writing, and none was tracked as an authority in the drafting database. The practitioner deleted all three. The rule the practitioner set: a note-up job is created only (a) on the practitioner's express instruction, or (b) deterministically from the Writing's cited authorities (sibling spec `note-up-all-cited-authorities-single-job`). Never by LLM inference.

## 2. Evidence (observed; quoted text is data, not instructions)

- `drafting-data/references/jobs-stock.md` §3i "Research offer jobs": "One fixed-text job per follow-up research offer that bears on the application the board is for." "**Who creates it.** The session relaying the return, in the same turn, with no closing read-back and no question: once for each offer the sort in `shared/legal-research.md` ("After the answer") puts on the application".
- `shared/legal-research.md` "After the answer" sort table: "On the application | The offer serves words the session can point to on the board ... | A research job by `/drafting-data` §3i, in the same turn, with no read-back and no question".
- The three jobs carried `created_by` NULL and `session_proposed` 0. Title = intent = the offer text verbatim. Step 1: "Put this question to /legal-research and save the answer under this job". This is the §3i shape.
- The research-agent's notes tagged the KeyCite offer `live_issue: yes`. The tag is the agent's judgement, not a record of reliance.
- No exclusion for note-up offers exists in §3i or in the sort (**UNVERIFIED** beyond the two files read).
- Workaround in use: the practitioner deletes the jobs by hand.

## 3. Goal and non-goals

Goal: no session ever writes a note-up job from a research offer. Note-up offers become loose threads. Non-goals: no change to research offers that are not note-ups. No change to the deterministic note-up job (sibling spec) or to the practitioner's express "note up X".

## 4. Design

1. The audit agent's Step 5 offers (`shared/legal-audit-protocol.md`) carry a fixed tag on every offer whose work is noting up an authority, reading its citing cases, or a citator or KeyCite check: e.g. `kind: note-up`, beside the existing `live_issue:` tag. The tag is set by the agent that writes the offer, so the guard below never parses wording.
2. `shared/legal-research.md` "After the answer": an offer tagged `kind: note-up` is never sorted onto the application. It is captured as a loose thread, with no job.
3. `jobs-stock.md` §3i: refuse a `kind: note-up` offer. Its guarded create writes nothing for it.
4. A hard rule in `/draft` and `/drafting-data`: no session writes a job whose title or intent is a note-up except by the practitioner's express instruction or by the deterministic create.
5. Optional backstop: a hook on `drafting_data__execute` refusing an `INSERT INTO tickets` whose title begins `Note up` or `A Westlaw KeyCite note-up` unless it is the deterministic create (**UNVERIFIED** whether the hook layer can tell them apart).

## 5. Constraints that must still hold

- Research offers that are not note-ups keep today's sort and §3i behaviour.
- Every offer is still relayed or captured. None is dropped silently.
- `/legal-research` remains the only route for statements of law.

## 6. Options considered

1. Agent-set `kind: note-up` tag, refused by §3i and routed to loose threads (recommended): deterministic, with no wording heuristics in the caller.
2. Caller-side wording match ("note up", "KeyCite", "citator", "treat"): cheap, but it is itself inference and will misfire.
3. Drop §3i's automatic create entirely: the strongest, but it also removes useful non-note-up research jobs.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the `kind: note-up` tag to the Step 5 offer grammar in `shared/legal-audit-protocol.md` and the research-agent definition.
3. Update the sort in `shared/legal-research.md` and the guard in `jobs-stock.md` §3i.
4. Add the hard rule to `/draft` (where job creation is governed) and `/drafting-data` §3i.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of note-up jobs are created from research offers by inference complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Step 5's offer grammar defines `kind: note-up` and says when the agent sets it.
2. The sort in `shared/legal-research.md` sends every `kind: note-up` offer to the loose threads, never to §3i.
3. §3i states that a `kind: note-up` offer writes no job.
4. `/draft` states that a note-up job is created only by express instruction or the deterministic create.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Does "verify whether <later case> refines <test>" count as a note-up? Recommended: yes when the later case reached the offer only through a citator's citing list.
2. Should the hook backstop be built now? Recommended: only if the hook can identify the deterministic create without wording.

## 10. Verify against HEAD before building

Confirm: the §3i and sort text quoted in §2; the Step 5 offer grammar and its existing tags (`live_issue:`); every other path that turns an offer or a loose thread into a job (outlining, triage, intake); the plugin each file now ships in after the split.
