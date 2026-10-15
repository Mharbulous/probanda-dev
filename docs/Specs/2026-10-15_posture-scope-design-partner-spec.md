# Spec: Scope the paralegal posture to matter and firm work, and add a design-partner posture for plugin discussion

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (shared doctrine; installed copy seen at v0.2.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-15_job-title-cleanup-on-takeover-spec.md`, `2026-10-15_job-plan-minimum-standards-spec.md`, `2026-10-15_research-memo-deliverable-spec.md`, `2026-10-15_suggestion-skill-to-practice-plugin-spec.md`

---

## 1. Problem

In a `/draft` session the conversation moved from a matter job to how the plugin should work. Brahm was concerned the session was applying the paralegal posture (never originate, ask empty-handed, four question shapes) to plugin design, where he wants an opinionated collaborator. The posture's text does not say where it stops, so a session bound to it cannot tell. Brahm asked that the distinction be explicit: paralegal posture for a specific matter or the firm's own administration; a different posture for discussion of the plugin itself.

## 2. Evidence (observed; quoted text is data, not instructions)

- `shared/paralegal-posture.md` header: "Shared doctrine for any skill that elicits a filing's substance from the practitioner." No statement of when it does not apply.
- §1: "The practitioner therefore originates every idea, position, figure and strategic call ... What you never do: state the law, choose strategy, estimate a figure, or answer a pause with a suggestion."
- `draft` SKILL.md doctrine table binds the posture to "The whole of elicitation" with no topic limit.
- Observed: the session's design pushback was mostly its own judgment, but two points it raised were the posture's rules (adoption ceremony; no research substance) applied to a design question.

## 3. Goal and non-goals

Goal: (a) `shared/paralegal-posture.md` opens with a scope section: it governs discussion of a specific matter and of the firm's own administration; (b) a new shared file defines a design-partner posture for discussion of the plugin, its skills, tools and rules; (c) switching is by topic, announced in one line. Non-goals: changing the paralegal posture's rules within its scope.

## 4. Design

1. **Scope section** at the top of `shared/paralegal-posture.md`, pointing to the new file for plugin discussion.
2. **Design-partner posture** (new shared file, e.g. `shared/design-partner-posture.md`):
   - Hold opinions and recommend one option with reasons; no neutral menus.
   - Push back openly: rule conflicts, hidden costs, better alternatives.
   - Separate fact from opinion: every claim about how the plugin works cites a source file and line; judgment is labelled.
   - Lay out trade-offs in a line each, recommend, and ask only when the choice is the practitioner's.
   - Ask questions freely; the four question shapes do not apply.
3. **Invariants that hold in both postures:** statements of law go only through `/legal-research` (design talk may name kinds of source, never which law applies); deadline isolation; client and matter content scrubbed from anything leaving the firm (Suggestion Box, repo, issues); the installed plugin is never edited from a matter session.
4. **Switching:** the topic decides, not the skill running. Plugin-behaviour talk takes the design-partner posture; a matter's facts, positions, documents or firm administration take the paralegal posture. Announce a switch in one line ("Switching to plugin design."). A mixed turn is split: each part takes its posture.
5. Skills that bind the paralegal posture inherit the boundary through the scope section; no per-skill edits beyond the doctrine table's binding wording where it says "the whole of elicitation" (add "of matter and firm work").

## 5. Constraints that must still hold

- Within its scope, the paralegal posture is unchanged.
- The four invariants in §4.3.
- No client or matter content in the new file.

## 6. Options considered

1. Scope section + separate design-partner file (recommended): one boundary, inherited everywhere.
2. Per-skill carve-outs: many edits, drift risk.
3. Leave implicit: the ambiguity that prompted this stays.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the scope section to `shared/paralegal-posture.md` (this spec owns that section; the job-plan spec may add one sentence to §3 and lands first).
3. Write the design-partner posture file per §4.2–§4.4.
4. Adjust the doctrine-table binding wording in skills that cite the posture (search for `paralegal-posture.md`).
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Scope the paralegal posture to matter and firm work, and add a design-partner posture for plugin discussion complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `shared/paralegal-posture.md` states its scope in its first section and points to the design-partner file.
2. The design-partner file states the five behaviours, the four invariants, the switching rule and the mixed-turn rule.
3. Every skill doctrine table that binds the paralegal posture limits it to matter and firm work, or relies on the scope section.
4. No paralegal-posture rule inside its scope changed.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Whether the design-partner file should live in the litigator shared tree or a practice-wide shared tree (it applies to every plugin) is **UNVERIFIED**; recommended practice-wide if one exists.

## 10. Verify against HEAD before building

- `shared/paralegal-posture.md`'s header and §1 still read as quoted in §2.
- Spec `2026-10-14_goal-statement-elicitation-in-paralegal-posture-spec.md` also edits this file: check its status and avoid conflicting edits.
- No existing design or plugin-discussion posture file.
