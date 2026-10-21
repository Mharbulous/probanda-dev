---
name: case-brief
disable-model-invocation: true
description: >
  Produce a concise case brief from a court decision — Issues, Relevant Facts,
  Disposition, and Propositions (with ratio decidendi / obiter dictum labeling).
  Optionally persists the decision as a legal authority via matter-data.
---

<!-- researcher v0.7.2 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Overview | Always |
| Scope and Output | Always, to know the output and the file path the user must give |
| Citation Preflight | Before briefing a decision, to check whether it is already held as an authority |
| Context Isolation | Briefing more than one decision |
| Brief Format | Writing any brief |
| Optional Focus | The user names issues to focus on |
| Quality Guidelines | Writing any brief |
| Multi-Brief Responses | Briefing multiple decisions |
| Optional Persistence | After delivering the brief, when offering to save the decision as an authority |

# Case Brief

## Overview

This skill reads a court decision and produces a structured four-section case brief as a chat response. After delivering the brief, it offers to persist the decision as a legal authority in the case database by delegating to ``matter-data``.

## Scope and Output

Output is a chat response containing a four-section case brief. Do not create a file unless the user explicitly asks for a document.

The user must provide the file path to the decision. This skill does not query databases to locate files.

## Citation Preflight

Before briefing, check whether the decision is already held as an authority, in
the order `shared/research-priority.md` sets: tier 1, the matter's ingested layer
via ``matter-data``; then tier 2, the shared pooled layer by exact public citation
where this runtime can reach it (that file says how, and what to do when it
cannot). Where either returns propositions already derived from this decision,
say so and cite them alongside your own Section 4 — a proposition someone has
already stated and noted up is worth more than a fresh paraphrase of it, and a
divergence between the two is itself worth the reader's attention. This never
replaces reading the decision: the brief is always your own reading of the text.

## Context Isolation

When briefing more than one decision, spawn one read-only Sonnet subagent per decision using the prompt in `agents/brief.md`. The subagent reads the decision and returns the four-section brief. The main agent assembles the multi-decision response. For a single decision, inline reading is acceptable.

## Brief Format

### Section 1: Issues

The legal questions the court addressed. State each issue as a question. For multi-issue decisions, number them. Focus on issues the court actually decided, not issues raised but not reached.

### Section 2: Relevant Facts

Only facts material to the legal issues — not a complete factual narrative. Include the procedural posture (what kind of proceeding, what relief was sought). Organize by issue when a multi-issue decision makes this clearer.

### Section 3: Disposition

All orders made by the court:
- Main disposition (judgment for plaintiff/defendant, appeal allowed/dismissed)
- Damages or other monetary relief
- Costs awards (amount or scale, who pays whom, conditions, timelines)
- Injunctive, specific performance, or declaratory relief
- Stays, compliance timelines, or directions for further proceedings
- Conditions attached to orders

### Section 4: Propositions

Statements of law in the court's own voice. Each proposition is labeled:

- **Ratio decidendi** — the binding principle that decided the case on its facts. A proposition is ratio if removing it would change the outcome on at least one issue.
- **Obiter dictum** — a non-binding remark. The court could have reached the same result without it.
- When uncertain, label as **Ratio (arguable)** or **Obiter (arguable)** with a one-line explanation.

Do not extract propositions from passages describing party submissions or rejected arguments. Apply the grammatical voice test (see `agents/brief.md`) to distinguish the court's own statements from reported speech.

Format each proposition as:

> **[Ratio decidendi]:** [Statement of law]
> - Source: para. [number(s)]
> - Decides: [which issue]

> **[Obiter dictum]:** [Statement of law]
> - Source: para. [number(s)]
> - Why obiter: [why not necessary to the outcome]

## Optional Focus

If the user specifies issues to focus on (e.g. "brief this case on the attornment analysis only"), narrow all four sections to those issues.

## Quality Guidelines

- Quote key phrases when helpful for precision
- Use pinpoint citations (paragraph or page numbers) when referencing the decision
- Maintain objectivity — report what the court found/held, not personal analysis
- Use precise legal terminology appropriate to the jurisdiction
- Do not omit important details for brevity

## Multi-Brief Responses

When briefing multiple decisions, structure the response with clear headings per decision:

```markdown
# Brief: [Case Name 1]

## Issues
...

## Relevant Facts
...

## Disposition
...

## Propositions
...

# Brief: [Case Name 2]
...
```

## Optional Persistence

After delivering the brief, offer to persist the decision as a legal authority in the case database. This is optional — many briefs are read-and-discard.

**Prompt:** "Would you like me to save this decision as a legal authority in the case database?"

**If the user accepts:**

1. Invoke ``matter-data`` for legal authority ingestion, passing the decision's file path and any issue scope the user specified.
2. matter-data handles extraction, authority registration, concept mapping, and all database writes. Do not pass schema-level details, SQL, or structured proposition data — matter-data's own extraction subagents produce the schema-specific format it needs.
3. Report what matter-data persisted (authority registered, concepts found, criteria stored).

**Relationship to ``ingest``:** Both paths use matter-data's legal authority ingest operation. ``ingest`` ingests directly without producing a brief. ``case-brief`` briefs first, then optionally persists — the user gets both a human-readable brief and persistent legal authority data. When briefing multiple decisions, offer persistence once after all briefs are delivered, not after each individual brief.
