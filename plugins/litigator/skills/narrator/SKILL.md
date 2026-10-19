---
name: narrator
description: >
  Draft Part 2 (Relevant Facts) and Part 4 (Material Relied On) for a BC
  Supreme Court form. Use when the practitioner asks to draft the factual
  basis, relevant facts, or material relied on for an NOA/Petition/NOCC/RTC,
  or invokes /narrator directly. Requires Part 1 (Orders Sought) and Part 3
  (Legal Basis) to exist -- if missing, direct the practitioner to run
  /solver or /bcsc-legal-basis first.
  For orders sought (Part 1), use /solver. For legal basis (Part 3),
  use /bcsc-legal-basis. For holistic review, use /polish-substance.
  For blank form generation or final assembly, use /publish with publish-bcsc-form.
---

<!-- litigator v0.6.1 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# narrator -- Relevant Facts (Part 2) and Material Relied On (Part 4)

Interactive agent that drafts the factual basis for a BC Supreme Court form. Reads the orders sought (Part 1) and legal basis (Part 3), queries case data for facts with posture and evidence, drafts paragraphs satisfying the legal tests with pinpoint citations, and mechanically generates the material list.

## Form Generality

Narrator is not NOA-specific. It works for any BCSC form with an Orders/Facts/Law structure (Form 32, Form 66, Form 1, Form 4). The form type does not affect how facts are drafted.

## Workflow

### 1. Locate the substance folder

Ask the practitioner for the matter workspace path if not already known from context. The substance folder is a fixed path under the matter's matter-data folder, the one `{workspace}\probanda.json`'s `case_data_dir` names:

`<matter-data folder>\bcsc-form-substance\`

In Cowork, where the project mounts only the matter folder, first request access to the matter-data folder itself (never a parent or the firm root) and use the path the session sees.

If the matter-data folder does not exist, halt: "matter-data folder not found for `{workspace}`. Initialize the matter with `/matter-data` initialize." Do not substitute another folder, and never create the matter-data folder.

Create `bcsc-form-substance\` beneath it if it does not exist.

### 2. Read peer parts

Read from the substance folder:
- `part-1-orders-sought.md` -- required
- `part-3-legal-basis.md` -- required

If either file is missing, halt with the appropriate redirect:
- Part 1 missing: "Part 1 (Orders Sought) is missing. Run `/solver` first."
- Part 3 missing: "Part 3 (Legal Basis) is missing. Run `/bcsc-legal-basis` first."
- Part 3 is a placeholder (contains "placeholder"): "Part 3 is a placeholder -- legal authorities need to be added before facts can be drafted. Run `/bcsc-legal-basis` after adding legal research."

### 3. Gather facts from case data

Invoke `/matter-data` to fetch facts for this matter. Request facts with:
- Current posture: `agreed`, `admitted`, `not_denied`, `disputed`, `claimed`, or `unclaimed`
- Computed pinpoint citations for the fact source, linked evidence, and party positions
- Evidence-link counts and any position citations needed to explain admissions or disputes

If no facts are found in case data, inform the practitioner: "No facts found in the case database. Ensure documents have been ingested via `/matter-data` before drafting Part 2." Halt -- do not draft facts from training knowledge.

### 4. Check for existing draft

If `part-2-factual-basis.md` exists in the substance folder, read it and present as the starting point: "This is the current draft of the factual basis. Would you like to revise it or start fresh?"

### 5. Draft factual paragraphs

Draft paragraphs that satisfy the legal tests identified in Part 3. For each order in Part 1, the legal test in Part 3 identifies what facts must be established.

**Structure:** One section per order, containing the factual paragraphs that satisfy the elements of that order's legal test.

```
ORDER 1: Injunction restraining the Defendant from entering the premises

The Plaintiff and the Defendant entered into a lease agreement dated
March 1, 2025 for the premises at 123 Main Street, Vancouver (Affidavit
#1 of Jane Doe, Exhibit A).

On April 15, 2025, the Defendant entered the premises without authorization
and removed personal property belonging to the Plaintiff (Affidavit #1 of
Jane Doe, paras 12-14; Exhibit C, photographs dated April 15, 2025).
```

**Rules:**
- Every paragraph must end with a pinpoint citation in parentheses
- Prioritize disputed facts -- these are the facts that must be established by evidence
- Agreed, admitted, and not-denied facts may be stated briefly with their posture noted where useful
- Claimed or unclaimed facts need evidence support before being used as proof
- Do not include facts without evidence support -- flag gaps instead: "Note: no evidence currently supports [element]. The practitioner may need to file additional affidavit material."
- Do not invent facts from training knowledge -- all facts must come from case data
- Use specific dates, names, and amounts from case data

### 6. Interactive loop

Present the draft. Accept feedback, revise, repeat. Continue until the practitioner approves.

### 7. Write Part 2

On approval, write to `{substance_folder}\part-2-factual-basis.md`.

- Plain text, UTF-8 encoding
- No markdown formatting
- No JSON
- Preserve the section-per-order structure with inline pinpoint citations

### 8. Generate Part 4 mechanically

After Part 2 is written, generate Part 4 (Material Relied On) by extracting and deduplicating citations from Part 2 and Part 3.

**Process:**
1. Scan `part-2-factual-basis.md` and `part-3-legal-basis.md` for all citations
2. Extract each unique material reference (affidavits, exhibits, case authorities, statutes)
3. Deduplicate -- same document cited in multiple places appears once
4. Sort: affidavits first (alphabetical by deponent), then exhibits, then authorities
5. Format as a plain list:

```
- Affidavit #1 of Jane Doe made April 20, 2026
- Affidavit #1 of John Smith made April 22, 2026
- Expert Report of Dr. Sarah Brown dated April 18, 2026
```

Write to `{substance_folder}\part-4-material-relied-on.md`. This is mechanical work -- do not ask the practitioner for approval of Part 4. Present it for information: "Part 4 generated from citations in Parts 2 and 3: [count] items."

### 9. Handoff

After writing both files: "Factual basis and material list saved. Start a new session and run `/polish-substance` to review all sections together."

## Constraints

- **Read peers:** `part-1-orders-sought.md` and `part-3-legal-basis.md` (both required)
- **Write:** `part-2-factual-basis.md` and `part-4-material-relied-on.md`
- **Case data:** exclusively via `/matter-data` -- no direct database access
- **No training knowledge as facts:** every factual assertion must trace to case data
- **Every paragraph needs a citation:** no uncited factual paragraphs
- **No .docx:** never touch templates or Word files
- **Plain text only:** no markdown syntax, no JSON in the file body
- **Part 4 is mechanical:** extract and deduplicate citations, do not draft creatively
