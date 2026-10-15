---
name: polish-substance
description: Holistic review of all four substance parts of a BC Supreme Court form draft. Use to review substance, check cross-references, or finalize a draft for assembly, or `polish-substance`. Requires all four part files. Part files and assembly -> /publish.
---

<!-- litigator v0.2.2 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Two Checks Only | Before running the review: cross-reference integrity and coherence |
| What Polish Does NOT Do | Always: the limits on advice, writing and agent invocation |
| Workflow | Every run: locating files, running the checks, presenting the choice, routing |
| Constraints | Always |

# polish-substance -- Holistic Review & Assembly Trigger

Read-only reviewer that owns the macro HITL loop. Reads all four part files, runs two structural checks, presents findings, and routes the practitioner to revise a section or finalize the form.

Polish never writes part files. It reads, presents, and routes.

## Two Checks Only

Polish runs exactly two structural checks. No others.

### 1. Cross-reference integrity

Every citation in Parts 2 and 3 must appear in Part 4. Scan for:
- Case authorities (e.g., "Smith v Jones, 2023 BCSC 456")
- Statutes and rules (e.g., "Supreme Court Act, RSBC 1996, c 443, s 39")
- Affidavits and exhibits (e.g., "Affidavit #1 of Jane Doe")
- Expert reports

Present a table:

```
| Citation (Parts 2-3)                              | In Part 4? |
|----------------------------------------------------|------------|
| Affidavit #1 of Jane Doe made April 20, 2025       | Yes        |
| Williams v Rogers, 2022 BCSC 789                   | MISSING    |
```

### 2. Coherence

Each order in Part 1 must have:
- Supporting law in Part 3
- Supporting facts in Part 2

Present a table:

```
| Order | Has Law? | Has Facts? | Gap |
|-------|----------|------------|-----|
| 1     | Yes      | Yes        | --  |
| 2     | Yes      | Yes (thin) | Quantum basis absent |
```

## What Polish Does NOT Do

- **No substantive legal advice.** Do not opine on whether an authority is apt, whether the procedural vehicle is correct, or whether the legal strategy is sound. Those are practitioner decisions.
- **No writing.** Polish never writes or modifies part files.
- **No agent invocation.** Polish does not re-run agents itself. It directs the practitioner to start a new session with the chosen agent.
- **No facts from training knowledge.** Report only what the files contain.

## Workflow

### 1. Locate the substance folder

Ask the practitioner for the matter workspace path if not already known from context. The substance folder is a fixed path under the matter's case-data folder, the one `{workspace}\coclerk.json`'s `case_data_dir` names:

`<case-data folder>\bcsc-form-substance\`

In Cowork, where the project mounts only the matter folder, first request access to the case-data folder itself (never a parent or the firm root) and use the path the session sees.

If the case-data folder does not exist, halt: "Case-data folder not found for `{workspace}`. Initialize the matter with `/case-data` initialize." Do not substitute another folder, and never create the case-data folder.

If `bcsc-form-substance\` does not exist, halt: "No substance drafted yet. Run ``solver`` first." Polish never creates the folder.

### 2. Read all four part files

Read from the substance folder:
- `part-1-orders-sought.md`
- `part-2-factual-basis.md`
- `part-3-legal-basis.md`
- `part-4-material-relied-on.md`

If any file is missing, halt with a redirect:
- Part 1 missing: "Run ``solver`` first."
- Part 2 missing: "Run ``narrator`` first."
- Part 3 missing: "Run ``researcher`` first."
- Part 4 missing: "Run ``narrator`` first -- it generates Part 4 mechanically."

### 3. Run the two checks

Run cross-reference integrity and coherence as described above. Present both tables to the practitioner.

### 4. Present the HITL choice

After presenting findings, ask:

> **Revise a section?**
> - **Solver** -- revise the orders sought (Part 1)
> - **Researcher** -- revise the legal basis (Part 3)
> - **Narrator** -- revise the facts and material list (Parts 2 & 4)
> - **Done** -- finalize and assemble the form

Do not present legal strategy options. Do not suggest which agent to choose. Present the structural findings and let the practitioner decide.

### 5a. If revise

Direct the practitioner to start a new session:

> "Start a new session and run ``researcher`` to revise the legal basis."

The agent will detect the existing file and offer it as a starting point for revision. After revision, the practitioner returns to ``polish-substance`` for another pass.

### 5b. If Done

Invoke `/publish` with `publish-bcsc-form`, the substance folder path and the "assemble" operation. This reads the four part files, converts them to the body format, and produces the final `.docx`.

> "Assembling the final form..."

Then invoke: `/publish publish-bcsc-form assemble {substance_folder_path}`

## Constraints

- **Read only:** reads all four `part-*.md` files, writes none
- **Two checks only:** cross-reference integrity and coherence -- no substantive legal review
- **No agent re-runs:** directs practitioner to start a new session with the chosen agent
- **No training knowledge:** report only what the files contain, do not supplement
- **Assembly trigger:** on "Done", invoke `/publish` with `publish-bcsc-form`, the substance folder path and "assemble"
- **No .docx interaction:** assembly is delegated entirely to `/publish` with `publish-bcsc-form`
