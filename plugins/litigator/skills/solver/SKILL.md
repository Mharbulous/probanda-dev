---
name: solver
description: >
  Draft Part 1 (Orders Sought) for a BC Supreme Court form. Use when the
  practitioner asks to draft orders sought, start substance drafting for an
  NOA/Petition/NOCC/RTC, or invokes /solver directly.
  For legal basis (Part 3), use /bcsc-legal-basis. For relevant facts (Part 2),
  use /narrator. For holistic review, use /polish-substance.
  For blank form generation or final assembly, use /publish with publish-bcsc-form.
---

<!-- litigator v0.6.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# solver -- Orders Sought (Part 1)

Interactive agent that drafts the orders sought for a BC Supreme Court form. Queries case data for parties and proceedings, presents a draft, loops with the practitioner until approved, and writes to the substance folder.

## Form Generality

Solver is not NOA-specific. It works for any BCSC form with an Orders/Facts/Law structure:

| Form | Rule |
|------|------|
| Notice of Application (Form 32) | Rule 8-1 |
| Petition (Form 66) | Rule 16-1 |
| Notice of Civil Claim (Form 1) | Rule 3-1 |
| Response to Counterclaim (Form 4) | Rule 3-4 |

The form type does not affect how orders are drafted -- it only matters at assembly time.

## Workflow

### 1. Locate the substance folder

Ask the practitioner for the matter workspace path if not already known from context. The substance folder is a fixed path under the matter's case-data folder, the one `{workspace}\probanda.json`'s `case_data_dir` names:

`<case-data folder>\bcsc-form-substance\`

In Cowork, where the project mounts only the matter folder, first request access to the case-data folder itself (never a parent or the firm root) and use the path the session sees.

If the case-data folder does not exist, halt: "Case-data folder not found for `{workspace}`. Initialize the matter with `/matter-data` initialize." Do not substitute another folder, and never create the case-data folder.

Create `bcsc-form-substance\` beneath it if it does not exist.

There is one substance folder per matter. If it already contains `part-*.md` files from a prior draft, do not silently overwrite them: tell the practitioner which parts are present and ask whether to resume that draft (revise in place) or start fresh (they must clear or move the old parts first). Proceed only once they choose.

### 2. Resolve matter context

Invoke `/matter-data` to fetch:
- Parties (names, roles, counsel)
- Proceedings (court file number, registry)

Use this to populate party names in the draft. Do not use placeholder names when real names are available from case data.

### 3. Check for existing draft

If `part-1-orders-sought.md` exists in the substance folder, read it and present as the starting point: "This is the current draft of the orders sought. Would you like to revise it or start fresh?"

If starting fresh, proceed to Step 4. If revising, present the existing text for editing.

### 4. Draft orders

Present a draft of the orders sought. Format: each order is a separate numbered block, separated by blank lines.

```
1. An order that the Defendant, John Smith, be restrained from entering the
premises located at 123 Main Street, Vancouver, British Columbia.

2. An order that the Defendant, John Smith, pay to the Plaintiff, Jane Doe,
damages in an amount to be assessed.

3. Costs of this application.
```

**Rules:**
- Use real party names from case data
- Identify affected non-parties based on the relief sought (e.g., injunctions binding third parties, receivers affecting creditors)
- Each blank-line-delimited block = one numbered order
- Final order is typically costs unless instructed otherwise
- Do not invent legal claims from training knowledge -- draft orders based on what the practitioner tells you and what case data reveals

### 5. Interactive loop

Present the draft. Accept feedback, revise, repeat. Continue until the practitioner approves.

Approval signals: "approved", "looks good", "done", "yes", "go ahead", or similar.

### 6. Write output

On approval, write to `{substance_folder}\part-1-orders-sought.md`.

- Plain text, UTF-8 encoding
- No markdown formatting (no `#`, `**`, `` ` ``)
- No JSON
- Preserve the numbered, blank-line-delimited format from Step 4

### 7. Handoff

After writing: "Orders sought saved to `part-1-orders-sought.md`. Start a new session and run `/bcsc-legal-basis` to draft the legal basis."

## Constraints

- **Read peers:** none -- solver runs first in the chain
- **Write:** only `part-1-orders-sought.md` in the substance folder
- **Case data:** exclusively via `/matter-data` -- no direct database access, no direct filesystem access to case data directories
- **No .docx:** never touch templates or Word files
- **Plain text only:** no markdown syntax, no JSON in the file body
