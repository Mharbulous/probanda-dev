---
name: bcsc-legal-basis
description: >
  Draft Part 3 (Legal Basis) for a BC Supreme Court form. Use when the
  practitioner asks to draft the legal basis, legal argument, or authorities
  for an NOA/Petition/NOCC/RTC, or invokes /bcsc-legal-basis directly. Requires
  Part 1 (Orders Sought) to exist -- if missing, direct the practitioner to
  run /solver first.
  For orders sought (Part 1), use /solver. For relevant facts (Part 2),
  use /narrator. For holistic review, use /polish-substance.
  For blank form generation or final assembly, use /publish with publish-bcsc-form.
---

<!-- litigator v0.11.1 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# bcsc-legal-basis -- Legal Basis (Part 3)

Interactive agent that drafts the legal basis for a BC Supreme Court form. Reads the orders sought (Part 1), identifies the legal test for each order, cites authorities, loops with the practitioner until approved, and writes to the substance folder.

## Form Generality

bcsc-legal-basis is not NOA-specific. It works for any BCSC form with an Orders/Facts/Law structure (Form 32, Form 66, Form 1, Form 4). The form type does not affect how the legal basis is drafted.

## Workflow

### 1. Locate the substance folder

Ask the practitioner for the matter workspace path if not already known from context. The substance folder is a fixed path under the matter's matter-data folder, the one `{workspace}\probanda.json`'s `case_data_dir` names:

`<matter-data folder>\bcsc-form-substance\`

In Cowork, where the project mounts only the matter folder, first request access to the matter-data folder itself (never a parent or the firm root) and use the path the session sees.

If the matter-data folder does not exist, halt: "matter-data folder not found for `{workspace}`. Initialize the matter with `/matter-data` initialize." Do not substitute another folder, and never create the matter-data folder.

Create `bcsc-form-substance\` beneath it if it does not exist.

### 2. Read Part 1

Read `part-1-orders-sought.md` from the substance folder. This is required input -- if the file does not exist, halt: "Part 1 (Orders Sought) is missing. Run `/solver` first to draft the orders sought."

### 3. Gather legal authorities

**Primary source:** Invoke `/matter-data` to check whether legal authorities have been ingested for this matter. Request authority records organized by legal concept and criterion: authorities, concepts, concept-authority links, and legal criteria.

**Fallback:** If `/matter-data` has no legal authorities, read the matter's `6. LAW/` folder directly. Read all files in that folder -- these are the practitioner's collected legal research documents.

If both sources are empty, write a placeholder to `part-3-legal-basis.md`:
```
(Part 3 placeholder -- no legal authorities available. Add legal research
to the 6. LAW/ folder or ingest authorities via /matter-data, then re-run
/bcsc-legal-basis.)
```
Inform the practitioner and halt. Do not draft legal argument from training knowledge.

### 4. Check for existing draft

If `part-3-legal-basis.md` exists in the substance folder (and is not a placeholder), read it and present as the starting point: "This is the current draft of the legal basis. Would you like to revise it or start fresh?"

### 5. Draft legal basis

Structure: one section per order from Part 1.

For each order:

**A. Sources of authority** -- Identify the primary statutory or rule authority (e.g., Supreme Court Civil Rules, Rule 10-4). Cite alternative sources if relevant.

**B. Legal test** -- State the applicable legal test. Use direct quotes from the authorities where available. Cite with pinpoint references.

**C. Analogous cases** -- Discuss cases from the gathered authorities that applied the test in factually similar circumstances. Draw explicit analogies to the facts of this matter.

```
ORDER 1: Injunction restraining the Defendant from entering the premises

The Court's jurisdiction to grant an interlocutory injunction is found in
Supreme Court Civil Rules, Rule 10-4 and the Law and Equity Act, RSBC
1996, c 253, s 39.

The test for granting an interlocutory injunction was stated in RJR-MacDonald
Inc v Canada (Attorney General), [1994] 1 SCR 311 at 334: the applicant must
establish (a) a serious question to be tried, (b) irreparable harm if the
injunction is not granted, and (c) the balance of convenience favours
granting the injunction.

In Smith v Jones, 2023 BCSC 456 at paras 23-27, the Court granted an
injunction in factually analogous circumstances where the defendant...
```

**Rules:**
- Every legal proposition must have a pinpoint citation to an authority from Step 3
- Do not cite cases from training knowledge -- all authorities must come from the gathered sources
- If the gathered sources do not support a particular order, flag it: "No authority found for Order N in the available sources. The practitioner may need to add research to 6. LAW/."

### 6. Interactive loop

Present the draft. Accept feedback, revise, repeat. Continue until the practitioner approves.

### 7. Write output

On approval, write to `{substance_folder}\part-3-legal-basis.md`.

- Plain text, UTF-8 encoding
- No markdown formatting
- No JSON
- Preserve the section-per-order structure from Step 5

### 8. Handoff

After writing: "Legal basis saved to `part-3-legal-basis.md`. Start a new session and run `/narrator` to draft the relevant facts."

## Constraints

- **Read peers:** `part-1-orders-sought.md` (required)
- **Write:** only `part-3-legal-basis.md` in the substance folder
- **Case data:** via `/matter-data` for legal authorities; filesystem fallback to `6. LAW/` only when `/matter-data` has no authorities
- **No training knowledge as authority:** every citation must trace to a gathered source document
- **No .docx:** never touch templates or Word files
- **Plain text only:** no markdown syntax, no JSON in the file body
