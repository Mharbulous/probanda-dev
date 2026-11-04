---
name: rule-update
description: >
  Update the firm's court-rule set when a modelled BC rule changes: fetch the amending text,
  have the docket-clerk agent draft overlay records, take the practitioner's approval of each
  under /show-me, then have the clerk write them and recalculate the blocked deadlines. Use
  when a docket-clerk reply names /rule-update (a workflow-10 open item, a rule_stale block or
  a step-0a refusal that an amendment is in force), when the practitioner says a rule changed
  or asks to update the rules for an amending regulation, or when the morning briefing reports
  a rule change. Never from a drafting session. Never edits the shipped rule files.
---

<!-- lawyer v0.23.1 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Rule update — drive the docket-clerk's workflow 10

The `lawyer:docket-clerk` agent records a rule change in the firm rule overlay
(`shared/docket-clerk/references/rule-update.md` §3), but it cannot fetch primary text, show a
decision to the practitioner or spawn itself again. This skill does those three things, so the
practitioner's only part is to approve each record. A weekly scheduled sweep finds changes
before a matter calculation does (`references/freshness-sweep-task.md`); the morning briefing
then points here.

**What this skill never does.** It never edits a shipped rule file (`bcsc-rules.md`,
`bcca-rules.md`, `bc-arbitration-rules.md`, `limitation-rules.md`, `reckoning.md`) or
`rule-freshness.json`, never writes an overlay record or a deadline itself, and never states
what a rule means. Writes go through the clerk. A question of law met on the way goes to
`/legal-research`.

## Before starting

1. **Main session only.** If the Agent tool is not in your tool list, stop and return to your
   caller: "/rule-update runs only from the main session. It spawns the docket-clerk agent, and
   a subagent cannot spawn agents. Nothing was changed."
2. **Live issue.** Recording a rule is legal work (`shared/live-issue-test.md`). Ask once, in
   one sentence: which matter and which live issue needs this rule, or whether the practitioner
   expressly authorizes it as unbilled firm work. Carry the answer into every clerk spawn. The
   matter is never written into a record.

## The steps

1. **Identify the change.** Read `shared/docket-clerk/references/rule-freshness.json` with
   `skill_source__read`. Take the amending regulation, OIC, commencement date and sections from
   the clerk's reply, from the practitioner, or from a `pending_changes[]` entry whose
   `sections` is not empty. If none names the instrument, spawn the clerk for workflow 10's
   first spawn (step 3, without passages) and use the URL its open item names.
2. **Fetch the primary text** with `sources__fetch`:
   - The bclaws consolidation if it already shows the change (fetch the part document with
     `match` on its "current to" and "Last amended" lines first), otherwise the deposited
     regulation or OIC, for example
     `https://www.bclaws.gov.bc.ca/civix/document/id/oic/oic_cur/0264_2026`.
   - A PDF needs `save: true`. Read the `saved_path` with `Read`. If the session cannot read
     that path (a Cowork session reads only the matter folder), ask the practitioner to save
     the PDF into the matter folder and give its path.
   - `refused: "host_not_allowed"`: ask the practitioner whether to allow that host. On yes,
     record it with `knowledge__write` at `_hosts.json` (`operation: "create"`, `row` {host,
     category `venue`, page_url the URL}) and fetch again. On no, go to "If a step cannot
     finish".
   - `refused: "fetch_failed"`: go to "If a step cannot finish". Never substitute a summary,
     another decision's quotation or memory.
   - Copy each affected subrule **verbatim**. A scanned PDF's text can misread letters and
     digits, so check every number against the page as shown, not only the extracted text.
2a. **Mark standing client guidance stale**, once the instrument and its sections are known, as
   `shared/knowledge-tree.md` section 12 says. This does not wait on any approval below.
3. **Spawn the clerk with the passages** (`lawyer:docket-clerk`, workflow 10). The prompt
   carries: the live-issue answer, the instrument (reg, OIC, commencement), each passage
   verbatim with its subrule, the source URL and the fetch date. A prompt carrying passages
   skips the clerk's first spawn. Relay any open item other than an approval as
   `shared/deadline-isolation.md` "Calling docket-clerk" says, and re-spawn with the answer.
   A clerk reply that already carries drafted records answering a procedural-research item
   (description `resolves: assumption:<id>`) goes straight to step 4: there is no amending
   text to fetch.
4. **Approve one record at a time** under `/show-me`. For each drafted record the clerk
   returns, show the current shipped row in full, the proposed record in full and the source
   passage itself, then ask for approve, change or reject. Never batch the asks, and never
   approve on the practitioner's behalf.
5. **Spawn the clerk to write.** The prompt carries each approved record exactly as approved,
   with the words "approved by the practitioner under /show-me on `<date>`", and names the
   rejected ones. The clerk writes the approved records as `verified`, cascades every
   `rule_stale` deadline the change reached, and reports.
6. **Report.** Relay the clerk's summary: the records written, each recalculated deadline with
   old and new dates, and anything left flagged.

## If a step cannot finish

Never leave the update half done without a record. When a fetch fails, a host is refused, the
practitioner declines a record or the clerk is blocked, add a to-do through `/practice-data`
naming the amending regulation, what was done, and exactly what remains (the URL still to
fetch, or the records still to approve). Then tell the practitioner the deadlines it reaches
stay blocked until the update finishes or a plugin release ships the remodelled rule file.
