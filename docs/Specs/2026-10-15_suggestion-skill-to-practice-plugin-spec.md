# Spec: Move the /suggestion skill from the research plugin to the practice plugin

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: `research` and `practice` (installed copies seen at v0.2.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-15_job-title-cleanup-on-takeover-spec.md`, `2026-10-15_job-plan-minimum-standards-spec.md`, `2026-10-15_research-memo-deliverable-spec.md`, `2026-10-15_posture-scope-design-partner-spec.md`

---

## 1. Problem

The Suggestion Box skill (filing the practitioner's own feedback about the plugin) ships as `research:suggestion`. It has nothing to do with legal research; it sits there because its tools live on the research plugin's `commons` server, which also reaches the Supabase legal-commons pool. Brahm: connecting to Supabase does not make a skill a research skill; the skill belongs in the practice plugin.

## 2. Evidence (observed; quoted text is data, not instructions)

- Skill listing: `research:suggestion` — "File the practitioner's own idea or complaint about the Probanda plugin ... in the Suggestion Box".
- `research/skills/suggestion/SKILL.md`: precondition `suggestion_box__configure_status`; submit via `suggestion_box__submit({title, body, source: "user"})` — "a GitHub issue on Probanda's private repo".
- Tool names seen: `plugin_research_commons__suggestion_box__configure_credential`, `__configure_status`, `__submit` (research plugin, `commons` server).
- Other callers seen: practice SessionStart hook text ("A change the practitioner wants to the plugin goes to /research:suggestion"); `/draft`'s vetted loose-thread route into the Suggestion Box and agent `litigator:suggestion-evaluator`.

## 3. Goal and non-goals

Goal: the skill ships as `practice:suggestion`, and every reference to `/research:suggestion` points to it. Non-goals: changing the skill's behaviour or the GitHub-issue mechanism.

## 4. Design

1. Move the skill folder to the practice plugin.
2. Tool dependency: either (a) move the `suggestion_box__*` tools to a practice server (recommended if the practice server can hold the credential), or (b) leave them on the research `commons` server and declare that `practice:suggestion` requires the research plugin, failing with one line when it is absent.
3. Update every reference: hooks, `/draft`'s Suggestion Box route, `suggestion-evaluator`, docs.
4. Leave no `research:suggestion` stub unless the packager needs one for a deprecation window.

## 5. Constraints that must still hold

- Nothing is posted without the practitioner's explicit yes on the exact text.
- Client and matter content is scrubbed before posting.
- The stored credential is not lost or exposed in the move.

## 6. Options considered

1. Move skill and tools to practice (recommended): clean ownership, no cross-plugin dependency.
2. Move skill only, keep tools in research: smaller change, but practice then depends on research.
3. Leave as is: the misclassification stays.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Move the skill folder; update its frontmatter and paths.
3. Implement §4.2 (a) or (b), recording which.
4. Update every reference found by a repo-wide search for `research:suggestion` and `suggestion_box__`.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Move the /suggestion skill from the research plugin to the practice plugin complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `practice/skills/suggestion/SKILL.md` exists and `research/skills/suggestion/` does not (or is a declared stub).
2. A repo-wide search finds no live reference to `research:suggestion`.
3. The tools the skill calls are reachable from the practice plugin, by §4.2 (a) or a declared dependency (b).
4. The yes-before-post and scrubbing rules are unchanged in text.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Where the Suggestion Box credential is stored, and whether a practice server can read it, is **UNVERIFIED**; it decides §4.2.
2. Whether the `troubleshoot__*` tools on the same server should follow is out of scope here; note it if found.

## 10. Verify against HEAD before building

- The skill's location and tool names still read as in §2.
- Every reference to `research:suggestion` in the repo.
- No other spec already moves this skill.
