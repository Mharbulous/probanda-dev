# CoClerk — Vision & Design Philosophy

**Date:** 2026-04-11
**Amended:** 2026-07-05 — Data Sovereignty rewritten for cloud-based case-data storage (see `planning/2. Plan/2026-07-05_case-data-cloud-migration-plan.md`).
**Amended:** 2026-09-25 — Rewritten for the two-plugin split (`litigation` base, optional `legal-commons` expansion).
**Amended:** 2026-09-30 — Practitioner interview: added the drafting-context problem, the one-owner-per-kind data principle, the stop-on-unfiled-ingest rule for drafting, the workflow-based litmus test, and the never-sign rule; brought the TimeCamp and database wording up to date.

## 1. What This Is

CoClerk is a pair of Claude Cowork plugins for a BC litigation practice. The `litigation` plugin handles file management, deadline calculation, billing, time tracking, matter prioritization, case data, legal research, and submission drafting — all scoped to British Columbia law and designed for use alongside LEAP (practice management) and UNITY Accounting. The optional `legal-commons` plugin adds a shared pool of matter-free legal principles.

Most data enters through conversation — pasted from LEAP or UNITY, uploaded as reports, or described by the user. All persistent state lives in local SQLite databases on the practitioner's machine, accessed via Python's built-in `sqlite3` module — no compiled binaries, no external dependencies, no build step. Each database has exactly one gatekeeper skill, the only skill that may touch it: practice data (`/practice-data`), case data such as parties, proceedings, facts, evidence and authorities (`/case-data`), submission drafting (`/drafting-data`), and the time-tracking stores (`/time-pipeline-data`, `/timecamping-data`). The only cloud surface is the matter-free legal-commons pool of shared legal principles, accessed through that plugin's own gatekeeper skill, which ships only in the `legal-commons` plugin. TimeCamp activity is read from TimeCamp's public REST API by `/build-timeline` and classified to client matters by `/time-sorting`.

### Two Plugins

- **`litigation` is the self-contained base.** It carries every local-data skill, the plugin agents, the local data runtime, and the vendored CanLII runtime. Installing it alone yields a fully working practice. It contains no Supabase code.
- **`legal-commons` is the optional expansion.** It is the sole Supabase surface: its gatekeeper skill over the shared pool, plus the skills that generalize a matter's principles and push them to the pool.
- **The dependency runs one way: `legal-commons` → `litigation`, never the reverse.** No `litigation` skill invokes a tool of the `legal-commons` runtime, names a commons skill or agent, or checks whether commons is installed.
- **The local databases are the seam between them.** A `legal-commons` skill reaches matter data only by delegating to `/case-data`, and never names a local database file.

`/plugin-packager` enforces these rules mechanically at packaging time (its bundle-purity, dependency-direction, inverse-reference, and commons-encapsulation checks), so they do not rest on convention. Packaging and runtime detail is in `plugins/CLAUDE.md`.

### Audience

**Today:** A sole BC litigation practitioner and occasionally a legal assistant, both working within LEAP and UNITY.

**Distribution target:** Non-technical lawyers. The audience does not use terminals, compile code, set environment variables, or understand what a binary is. They install software by downloading it and clicking "Install." Any setup step that requires technical knowledge is a barrier that will stop adoption. The `litigation` plugin must be plug-and-play on its own: install, grant a folder for practice data if prompted, and start using skills. Adding `legal-commons` must not change that. Every architectural decision about binaries, database location, and platform support must be evaluated against this standard — if a lawyer can't do it without instructions, it's too complicated.

### Data Sovereignty

Lawyers have professional and regulatory obligations around client data. The Law Society of BC requires that lawyers maintain control over client information and be able to account for where it is stored. LSBC permits cloud storage of client records provided the lawyer completes documented due diligence (the LSBC cloud computing checklist), retains control of and access to the records, and discloses out-of-province storage to clients.

The storage rule is split by data domain:

- **Case data is local.** Parties, proceedings, facts, evidence, and authorities reside in SQLite databases on the practitioner's own machine. The earlier cloud store (Supabase Postgres, client-side encrypted) was retired at the three-layer teardown (B5/B6, 2026-07-14) and the data migrated back to local storage; case-data operations no longer require internet connectivity.
- **Practice data remains local.** Matter status, retainer balances, time entries, and deadlines reside in a SQLite database on the practitioner's own machine and are never uploaded to any cloud environment.
- **Only matter-free legal principles are pooled.** The one remaining cloud surface holds generalized, matter-free statements of law — no client identity, no matter facts. Every write to it is deliberate and permission-gated. It ships only in the `legal-commons` plugin, so a `litigation`-only install has no cloud storage at all.

No client data is embedded in plugin files in either domain.

### Design Constraints

- **Zero-config installation:** Each plugin must work immediately after install with no manual setup. If the user has to touch a terminal, set an environment variable, or build anything from source, the installation has failed.
- **Secret/credential delivery must be zero-config too:** Any API key, token, or secret a skill or MCP server needs must be enterable from inside a Cowork session (e.g. a `configure_credential` tool) and persisted securely on the machine — never a manual environment variable or config-file edit as the primary path. An env var may remain a convenience for CLI/dev use, but a delivery mechanism that only works via env var has failed the non-technical-lawyer audience.
- **No compiled binaries or external dependencies:** Database access uses Python's built-in `sqlite3` module only. Sole exceptions are three MCP runtimes, each shipping as a tracked Node.js bundle. Two ship in `litigation`: the local data runtime (`plugins/litigation/mcp`) and the vendored canlii runtime (`plugins/litigation/canlii-mcp`). One ships in `legal-commons`: its Supabase runtime (the `mcp` folder of the `legal-commons` plugin).
- **Jurisdiction:** British Columbia only — BC Limitation Act (SBC 2012, c 13), BC Supreme Court Civil Rules, BC Court of Appeal Rules, LSBC trust accounting requirements.
- **No direct LEAP/UNITY API integration:** Neither system has a known public API. Data enters via CSV export from UNITY, uploaded to Cowork for ingestion into the shared DB.
- **TimeCamp integration:** TimeCamp has a public REST API (token auth, available on all plans) exposing computer activity data. External API dependencies are limited to TimeCamp, CanLII, Microsoft Graph (read-only Outlook sent mail and calendar, optional), and Supabase (the matter-free legal-commons pool, reached only through the `legal-commons` plugin).

## 2. The Problem This Solves

### Problem 1: Reactive Prioritization

Without a system to surface which files need attention, work defaults to whoever asks loudest. The most demanding clients get the most work — but they also burn through retainers fastest. Meanwhile, billing gets deferred because there's always more urgent client work. The result: work performed beyond the retainer balance, leading to forced discounts. The cycle is self-reinforcing — the more reactive the practice, the worse the economics.

### Problem 2: Capacity Blindness

There is no clear picture of how much work has been committed to, on what timelines. Deadlines are given to clients and courts without a realistic view of total workload. The consequence is missed self-imposed deadlines, rushed work, and an inability to say "no" or "not yet" with confidence — because the actual capacity picture is invisible.

### Problem 3: Limitation Period Risk

Limitation period miscalculations are uncommon but catastrophic — a missed deadline can extinguish a client's cause of action entirely. The stakes are high enough that even occasional exposure justifies a dedicated tool, but this is a safety net, not a daily driver.

### Problem 4: Time Classification Overhead

Even with automatic time tracking via TimeCamp, significant time is spent classifying tracked activities into billable entries and converting them into invoices. The time pipeline addresses this: `/build-timeline` pulls the day's raw activity from TimeCamp and the other registered sources, `/time-sorting` classifies it to client matters, and time-entry drafting turns the sorted day into entries.

### Problem 5: Drafting Context Lost Between Sessions

An application, a letter, or a factum is rarely finished in one sitting. Work is interrupted, and the next session may be days away. Each time it resumes, the working state is gone: which excerpt came from which case, which lawyers are on record, how far the draft had got. That is too much to hold in one's head across sessions far apart. The result is re-researching the same cases, re-reading the same documents, and re-drafting the same passages — a slow, inefficient process. Case data, legal research, and drafting exist to hold that state in the matter's databases, so each session resumes where the last one stopped and assembles facts, authorities, and parties into a coherent document on time.

## 3. Design Principles

### 3.1 Fix Root Causes, Not Symptoms

ALWAYS trace problems to their root cause before implementing a fix. NEVER patch a symptom to make an error go away.
**Why:** Claude tends to lose sight of the big picture during debugging and fixes whatever is immediately visible. In a practice management system where skills share state, a symptom fix in one skill can mask a data integrity problem that cascades across others.
**Violation example:** The Matter Status Tracker shows stale data. Claude fixes it by adding a cache refresh call in the Tracker skill — but the actual problem is that the File Prioritizer skill is writing to the wrong namespace in the shared DB. The symptom disappears for one skill while the corruption continues.

### 3.2 Surface Failures, Never Silently Degrade

ALWAYS surface errors, missing data, and uncertainty explicitly to the user. NEVER produce a plausible-looking result that papers over a gap.
**Why:** Claude's trained instinct is to gracefully degrade and produce *something* rather than admit a problem. In a litigation practice, a confident-looking but wrong answer (a deadline, a retainer balance, a priority ranking) can cause real harm.
**Violation example:** The Retainer Tracker is asked for a trust balance but the last data entry is 3 months old. Instead of warning that the data is stale, Claude extrapolates a current balance from the burn rate and presents it as fact.

### 3.3 Skills Are an Integrated System, Not Isolated Tools

ALWAYS keep persistent state in the plugin's databases, reached through each database's gatekeeper skill. NEVER build a skill that stores or manages its own state independently.
**Why:** The core problems this plugin solves — reactive prioritization, capacity blindness, billing overhead, lost drafting context — are interconnected. A File Prioritizer that can't see retainer balances, or a Matter Status Tracker that doesn't inform the capacity picture, reproduces the fragmentation problem the plugin exists to fix.
**Violation example:** Building a new "Upcoming Deadlines" skill that maintains its own list of deadlines in the SKILL.md instructions rather than reading from the practice database where the Deadline Calculator already writes them.

### 3.4 Each Kind of Matter Data Has One Owning Database

ALWAYS give each kind of matter data — parties, counsel of record, proceedings, facts, authorities — exactly one owning database, and have every other skill read it from there at the moment of use. NEVER keep a second live copy in another database. The one permitted copy is a record frozen at the moment a Writing is sent, so the sent Writing keeps showing the details as they stood on the day it went out; that copy is never read back as current.
**Why:** The plugin's value is that it remembers so the practitioner does not have to (Problem 5). A remembered copy that silently falls out of date is worse than no memory, because the practitioner has stopped checking. Two copies with no re-sync always drift, and nothing tells the drafting session which one is current.
**Violation example:** A drafting session builds a document's counsel details from the submission database's own copy of party and counsel data. Nothing re-syncs that copy, so when the counsel details change, the draft goes out of date without warning while looking authoritative.

### 3.5 Show, Don't Tell

Probanda shows the lawyer the evidence and never asks the lawyer to trust what it says. Its aim is to make the lawyer's own verification fast: each claim sits beside every source behind it, never scattered across folders, tools or sessions. Probanda runs its own checks too, but they supplement the lawyer's verification and never supersede it. A status, flag or date appears only beside what it describes: what was checked, by what, and against which source. It never stands alone as a reason to rely, though a record of a check may remind the lawyer what is still to do. A calculation, ranking or recommendation cites its data and how the result was derived.
**Why:** Every lawyer must verify the law they rely on, and Probanda warrants nothing. Evidence shown beside a claim lets the lawyer check it quickly. A status gives them nothing to check, so they must either redo the work or rely on Probanda's word.
**Violation example:** The legal commons serves an authority marked "last noted up on 2026-09-01". The reader is asked to trust that someone noted it up, did it correctly, and that nothing has changed since. Instead the commons shows the proposition, the authority it cites, the treatments recorded against that authority, and the correction history. The reader checks the proposition against the cited authority's text and notes the authority up.
**Violation example:** The File Prioritizer says "Smith v Jones is your top priority" without showing the factors (funded retainer held for 3 weeks, filing deadline in 5 days, no recent activity) that produced that ranking.

### 3.6 Accuracy First, Efficiency Later

When building or modifying a skill, get it working correctly before optimizing. Individual skills should not sacrifice clarity or correctness for token savings.
**Violation example:** Compressing a skill's prompting to save tokens, resulting in ambiguous instructions that cause Claude to misclassify time entries.

### 3.7 Warn on Stale Data

When a skill acts on data that may be outdated, it must flag the staleness to the user before proceeding. The skill may still act — but the user must know the data's age.
**Violation example:** The Billing Summary produces a WIP report based on time entries last updated 4 weeks ago without mentioning the data age. The user makes collection decisions based on numbers that don't reflect recent work.

**Exception — drafting stops.** When a draft depends on case data and the drafting session knows of a filing not yet ingested (it sits un-ingested in the matter folder, or the practitioner mentions it), drafting stops until that filing is ingested. It does not warn and proceed. A stale party or counsel block lands in a document addressed to the court or to opposing counsel, where the error is no longer a private judgment call.

### 3.8 The Litmus Test

**"Will this workflow, form, or template be needed across multiple client matters?"**

If yes — it belongs in the plugin as a shared skill. If no — handle it in a one-off conversation. What recurs is the workflow, the form, and the template. A document's content is matter-specific and is never a reason to build or withhold a skill. Examples:

- "Track limitation periods across all active files" → **Yes**, plugin skill
- "Draft an affidavit" → **Yes**, plugin skill (`/draft`). The affidavit's content is matter-specific, but the drafting workflow and the form recur
- "Classify today's TimeCamp activities to client matters" → **Yes**, plugin skill
- "Research the law for a particular motion" → **Yes**, plugin skill (`/legal-research`). The argument is matter-specific, but the research workflow recurs
- "Build a one-time spreadsheet reconciling a single client's disputed account" → **No**, one-off conversation

### 3.9 Reach a Group Through One Front Door

The legal skills use four terms. A **front door** is a typed skill that is the one skill you open to reach a group. A **subskill** is a member filed at `<front>/subskills/<name>/SUBSKILL.md`, read by its front door as a file: it has no typed `/name` and does not appear in the skill listing. A **helper** is a skill carrying `disable-model-invocation: true`: only the practitioner can start it, by typing `/<plugin>:<name>`. Its description is left out of the model's skill list, and the Skill tool refuses the model's call to it. The opposite flag, `user-invocable: false`, hides a skill from the practitioner's `/` list but leaves the model free to invoke it, so a skill carrying only that flag is not a helper. A **gatekeeper** is the one skill permitted to touch a given database.

There are six front doors: `/legal-research`, `/verify-law`, `/draft`, `/calculate`, `/publish`, `/assemble`. A member is reached through its front door rather than by its own name, so a caller names both: open `/publish` with `publish-bcsc-form`. `/apply-to-facts` and `/polish-substance` remain standalone skills, not members.
**Why:** A member with no typed name cannot be invoked directly, and a caller that reaches for the old name gets nothing. Naming the front door plus the member keeps the group's entry point single and the routing visible.
**Violation example:** A skill tells the practitioner to type `/draft-bcsc-form`, a retired name with no typed skill behind it, instead of routing through `/publish` with the `publish-bcsc-form` member.

The reasoning is in `docs/adr/0019-front-doors-and-subskills.md`.

## 4. Anti-Patterns

### 4.1 The Debugging Rabbit Hole

**Pattern:** During debugging, Claude narrows focus to the immediate error and applies a local fix without checking whether the root cause affects other skills or shared DB state.

**Why it's wrong:** In an integrated system, a local fix that silences one skill's error can mask a shared-state problem that quietly corrupts data for other skills. The user discovers the real problem later, in a different skill, with no obvious connection to the original fix.

**What to do instead:** Before fixing, trace the data flow across skills. Check what reads and writes the affected namespace/key. Fix at the source, not at the point where the symptom is visible.

### 4.2 The Plausible Placeholder

**Pattern:** A skill is missing data it needs, so Claude fills the gap with a reasonable-sounding default or extrapolation and presents the output without flagging the substitution.

**Why it's wrong:** The user trusts the output because it looks complete. In a practice management context, acting on fabricated data (a guessed retainer balance, an assumed deadline) can cause real financial or legal harm.

**What to do instead:** Flag what's missing, state what the skill cannot determine, and ask the user to provide or confirm the data before proceeding.

### 4.3 The Standalone Skill

**Pattern:** A new skill is built with its own state management — hardcoded lists, in-memory tracking, or SKILL.md-embedded data — rather than reading from and writing to the shared DB.

**Why it's wrong:** The skill works in isolation but is invisible to every other skill. The integrated picture (prioritization, capacity, billing) breaks because one skill's data isn't accessible to the others.

**What to do instead:** All persistent state goes through the owning database's gatekeeper skill. If the data doesn't fit the existing schema, discuss the schema need before building around it.

The same failure appears at the skill-graph level. A skill that duplicates a member's work, or that tells the practitioner to type a retired name, rather than routing through the member's front door, is standalone in the same way: it may work on its own, but it is invisible to the group it belongs to.

## 5. Applying the Principles

The following examples illustrate how the principles in Section 3 apply to current capabilities. This list is not exhaustive — the litmus test in Section 3.8 is the authoritative scope boundary.

### The plugin does (universal across matters):

- Track matter status, key dates, and next steps across all active files
- Calculate limitation periods and court filing deadlines using hardcoded BC rules
- Rank files by priority using a retainer-first model: (1) clients with funded retainers and upcoming deadlines get top priority; (2) clients with depleted retainers and upcoming deadlines who haven't been billed or warned about replenishment; (3) clients with depleted retainers and upcoming deadlines who have been warned that work is paused pending replenishment. This rewards clients who pay promptly and ensures there's no excuse for neglecting files where the retainer is funded.
- Draft time entries from TimeCamp activity data and Google Calendar appointments
- Monitor retainer balances and burn rates
- Generate billing summaries and flag invoice issues
- Store and retrieve all of the above through the shared SQLite database so every skill sees the full picture
- Read each matter's documents into its case database (parties, proceedings, facts, evidence, authorities) and name and file them by the firm's convention
- Answer questions about what the law is through the `/legal-research` gate, where every statement of law carries a pinpoint citation to an audited authority, and apply the law that gate returns to a matter's own facts (`/apply-to-facts`)
- Draft the substance of BC filings as mockups for the practitioner's review (VanIAC submissions, BCSC applications and requisitions, BCCA stay books and factums), then fill court forms and bind filing packages (`/draft`, `/publish`, `/assemble`)
- Draft correspondence to clients, opposing counsel, witnesses, experts, and the court for the practitioner to review
- With `legal-commons` installed, generalize a matter's legal principles and share the matter-free ones through the pool

### The plugin does not (per-matter or per-conversation decisions):

- File, serve, or send anything on the practitioner's behalf. Drafts are mockups, and the practitioner decides what reaches a court, a party, or a client
- Sign anything for the lawyer. No output carries the lawyer's signature or anything presented as one, so nothing the plugin produces can appear to bear the lawyer's approval. The lawyer signs their own documents, by whatever means they choose (Adobe Acrobat, ink). This holds even when the lawyer asks: the plugin refuses and tells the lawyer they must sign it themselves
- State the law from web search, training knowledge, or secondary commentary. A statement of law comes only from the `research-agent` agent through `/legal-research`, or it is not made
- Do legal work that does not serve a live issue in a client matter being billed (see `.claude/skills/shared/live-issue-test.md`)
- Decide which matters to take on or decline
- Choose billing rates or fee arrangements
- Make judgment calls about litigation strategy

## 6. Non-Goals

- **Trust accounting bookkeeping or compliance reporting** — The plugin tracks retainer balances and burn rates to inform prioritization, but does not perform trust account reconciliation, LSBC compliance reporting, or any bookkeeping functions.
- **Conflict of interest checking** — Conflict checks require a level of legal judgment and comprehensive historical data that this plugin does not attempt to provide.
- **Unsourced legal answers** — The plugin researches law only through the `/legal-research` gate, against authorities it has audited and noted up. It never answers a legal question from general knowledge. Deadline rules (limitation periods, court deadlines) are encoded in the `docket-clerk` agent's rule files, not researched at run time.
- **Client-facing output** — No client portals, client status pages, or anything that reaches a client directly. Correspondence to a client is drafted for the practitioner to review and send. All output is for the practitioner.
