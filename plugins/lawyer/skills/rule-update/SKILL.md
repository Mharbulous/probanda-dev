---
name: rule-update
description: "Use when a docket-clerk reply names /rule-update, when the practitioner says a BC court rule changed or asks to update the rules for an amending regulation, or when the morning briefing reports a rule change. Never from a drafting session. Never edits the shipped rule files."
---

<!-- lawyer v0.34.4 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

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
