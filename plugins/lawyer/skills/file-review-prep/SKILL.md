---
name: file-review-prep
disable-model-invocation: true
description: Assemble a complete, sourced briefing for a single client matter before engaging with it. Use for 'brief me on', 'what's the situation with', 'pull up the file for', 'prep me for [matter]', or before a client call, file review, or queued to-do.
user-invocable: true
---

<!-- lawyer v0.9.11 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# File Review Prep

Pure read-only synthesizer. Assembles a structured, sourced briefing for one matter by
delegating each data section to ``practice-data``. Never writes, never recommends, never
owns state.

## Workflow

1. Invoke ``practice-data`` `matter-lookup` with the practitioner's input. If multiple
   matters match, list them and ask the practitioner to confirm before proceeding. If no
   matter matches, report: "No matter found matching '[input]'. Check the file number or
   client name and try again."
2. Request each data section independently — a failure in one section does not block others.
   Surface the failure per-section using the placeholder syntax in the Output Template.
3. Render the briefing using the Output Template below.

### Section Operations

| Section | Operation | Notes |
|---------|-----------|-------|
| Matter identity and status | `matter-lookup` | Always available |
| Engagement signals | `read-signals` | Surface "[Status signals not available]" on failure |
| Retainer | `trust-summary` (single matter) | Operation applies sign convention; render its gap marker if unconfigured |
| Open to-dos | `open-tasks` | Always available |
| Deadlines | `active-deadlines` | Surface "[Deadlines not available]" if no deadlines recorded |
| AR state | `ar-data` (single matter) | Includes payment-in-flight state |

### Sign Convention

The `trust-summary` operation reads `accounting.csv_mapping.sign_convention` from
`probanda.json` and returns a display-ready balance string. If the sign convention is not
configured, the operation returns a gap marker — render it verbatim, do not guess.

## Output Template

Use this exact structure every time. Every data point includes its source and freshness.
Sections with missing upstream data show an explicit note — never silently omit.

```
File Briefing — [client_name] ([client_num]) / [matt_num]
[description]
Generated: [today's date]

─── MATTER STATUS ────────────────────────────────────────────────────────────
Status:  [the matter's status, or "not set"]
Signals: [list of signal_key: state (confirmed_at) per signal]
         OR: [Status signals not available]

─── RETAINER ─────────────────────────────────────────────────────────────────
Balance: [amount] — imported [last_trust_date], [N] days ago
         [⚠ approaching stale — over 14 days] (if applicable)
         OR: [No trust import on file]
         OR: [Retainer balance cannot be shown — sign convention not configured in probanda.json]

─── OPEN TO-DOS ──────────────────────────────────────────────────────────────
[For each to-do:]
  • [description]
    Type: [task_type] | Created: [created_at] | Deadline: [deadline_date or "none"]
[If no open to-dos:] No open to-dos on file.

─── DEADLINES ────────────────────────────────────────────────────────────────
Anchors:
  [anchor_type]: [anchor_date] (status: [status])
  OR: [No anchor dates on file]

Derived deadlines:
  [deadline_date] — [deadline_type]: [rule_description] ([rule_ref])
  OR: [No derived deadlines on file]
  OR: [Deadlines not available]

─── AR STATE ─────────────────────────────────────────────────────────────────
Retainer notices sent: [count]
  Last sent: [sent_at of most recent notice, or "none"]
Payment-in-flight: [amount, recorded_at, expected_clear_by]
                   OR: [None recorded]
```

## Anti-Patterns

**Writing to the database.** This skill is called immediately before engaging with a file —
any side-effect write at that moment is dangerous. All five output sections are display artifacts.
If a section looks like it should trigger a DB update (e.g., a status change), it doesn't — that
is `matter-status-tracking`'s job.

---

**Appending recommendations.** "Suggested next step: send a retainer replenishment notice" belongs
to `executive-assistant`. The briefing surfaces what is true; the practitioner decides what to do.
Even phrasing like "needs attention" edges into recommendation territory — avoid it.

---

**Silently omitting a section because its upstream data is unavailable.** A briefing that looks
complete but is missing a section gives the practitioner false confidence. Each section must
explicitly surface its own gap.

---

**Showing a retainer balance without sign convention.** If `sign_convention` is missing from
`probanda.json`, the sign of `regular_trust` is ambiguous. The `trust-summary` operation handles
this — render its gap marker, do not guess.

---

**Treating `regular_trust IS NULL` as $0.00 (depleted).** Per the practice-data consumer
contract: no import on file = unknown. `regular_trust = 0` = confirmed depleted. Collapsing
these two states causes the practitioner to act on a fabricated balance.

---

**Catching all exceptions at the top level and returning a partial briefing that looks complete.**
Each section's failure must be localized and visible. A top-level swallow that renders other
sections without flagging the failed one hides the failure.

---

**Extrapolating a trust balance from time entries.** Show the imported balance and its age;
let the practitioner weigh the staleness. Computing a current balance from unbilled hours is
extrapolation, not data.
