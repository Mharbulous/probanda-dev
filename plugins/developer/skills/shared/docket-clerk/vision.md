# Dates and Deadlines — Vision & Design Philosophy

**Date:** 2026-04-14

## 1. Platform & Scope

A Cowork plugin skill. Accesses practice data exclusively through the ``practice-data`` gatekeeper, which keeps it in a local SQLite database on the practitioner's machine — no direct database access, no schema or queries defined in this skill. Scope is BC litigation only: BC Limitation Act (SBC 2012 c 13), BC Supreme Court Civil Rules, and BC Court of Appeal Rules.

**Public-source fetches are not a sovereignty concern.** Data sovereignty here means what Commandment 3 says of *client and privileged information*: it reaches the inference provider only through the practitioner's own session, reaches Probanda's Cloud only as vocabulary values and keyed hashes, and syncs to the firm's own storage where the firm syncs it. Fetching **publicly published** information *into* the machine is not a breach of that principle and needs no exception. The skill makes two such fetches, both read-only, no auth, no client data leaving the machine:

1. The BC Supreme Court's published **Court Calendar PDF** (`bccourts.ca/supreme_court/scheduling/CourtCalendar<YEAR>.pdf`) — closure/limited-court-open data for gating (see the docket-clerk agent's court-calendar workflow).
2. The **bclaws CiviX API** (`bclaws.gov.bc.ca`) — consolidation-currency and amendment signals from the enactment's own text for the five governing enactments, used by the calc-time rule-freshness check (see the docket-clerk agent's rule-freshness workflow and `references/rule-freshness.json`).

Both are fixed, known URL patterns against the government's own enactment text. The skill only asks the practitioner to supply a copy if a fetch itself fails.

This is a **pure data skill**. It extracts, calculates, and stores deadline data. It has no opinion about which deadlines matter most — ranking and surfacing belong to the `executive-assistant` skill.

## 2. Purpose

### Audience

Sole BC litigation practitioner (primary user). Paralegal or legal assistant (secondary).

### Pain Points

- Deadlines are tracked across too many places — calendar, sticky notes, email, spreadsheets — with no single authoritative source.
- Manual calculation of limitation periods and filing deadlines introduces human error.
- When a deadline *is* tracked, it is often not connected to the downstream deadlines that depend on it — if the trial date changes, witness list deadlines do not automatically follow.
- Getting deadlines into any tracking system requires deliberate human action; practitioners miss deadlines not because they forgot the rule, but because no one put the date in the system.

### Value Proposition

Eliminates the human failure points in the deadline capture pipeline. Deadlines are extracted from source documents rather than transcribed manually, calculated from a locally maintained rule set rather than computed by hand, validated for consistency across documents, and stored as a dependency-aware record that cascades correctly when dates change. The practitioner's job is to upload the document; the skill handles the rest.

### Killer Use Case

The practitioner uploads a Filed Notice of Trial. The skill extracts the trial date and stores it as an anchor. Later, the practitioner uploads the Trial Management Conference Order. The skill extracts the trial date from the order and the derived deadline rules it contains (e.g., "witness lists due 7 days before trial"), then compares the trial date against the Notice of Trial. If the dates match, it calculates all derived deadlines and writes them to the shared database. If the dates conflict, it surfaces the inconsistency before calculating anything. When the trial is later adjourned, the practitioner updates the trial anchor — and every derived deadline cascades to the new date automatically.

## 3. Theme & Design Philosophy

### Design Principles

**1. Explicit uncertainty over silent assumption**
When a document is ambiguous, a date cannot be confidently extracted, or two source documents disagree, the skill surfaces the problem rather than making its best guess. A wrong deadline in the database is worse than a missing one — downstream skills and the practitioner will trust whatever is stored.

*Violation example: extracting "sometime next month" as a specific date, or silently choosing the more recent document when two sources conflict.*

**2. Source provenance is non-negotiable**
Every anchor cites the document it was extracted from. Every derived deadline cites the rule or order term that produced it. The practitioner can always trace a deadline back to its origin and verify it independently.

*Violation example: storing a deadline with no indication of whether it came from a document extraction, a BC rule calculation, or a judge's order — leaving the practitioner unable to verify or challenge it.*

**3. Source reconciliation before calculation**
When multiple documents specify a date for the same anchor (e.g., a Notice of Trial and a Trial Management Conference Order both naming the trial date), the skill validates that they agree before calculating any derived deadlines. Conflicts are surfaced immediately.

*Violation example: silently using the most recently processed document's date without checking whether it matches prior sources.*

**4. Cascade recalculation on anchor change**
Derived deadlines are live, not static. When an anchor date changes, all deadlines in its dependency chain recalculate automatically. No derived deadline can become stale without the practitioner actively updating the anchor it depends on.

*Violation example: updating a trial date but leaving previously-calculated witness list and expert report deadlines at their old values.*

**5. Locally maintained rules, verified against the enactment's own text**
BC court rules change. The deadline calculation rule set is maintained *within* the skill (the per-proceeding rule files) so calculation is reliable and works offline — never fetched live to compute a date. But the skill *verifies* that local rule set against the bclaws enactment text at calculation time: it detects when the real BC law has changed since a deadline was last calculated. Verifying against a public legal database is **not** a data-sovereignty breach — only client and privileged information must stay local (see §1); public law is fetched freely. When a governing enactment has changed, affected stored deadlines are **blocked** (`review_flag='rule_stale'`) until the rule set is re-verified — not silently recalculated, since the local rules may themselves need updating first. When the check cannot run (offline), the skill calculates normally and notes that freshness was not verified, rather than blocking. Enacted-but-not-yet-in-force amendments are diarized to their commencement date so affected deadlines are re-evaluated the day the change takes effect.

*Violation example: hardcoding rule logic directly into procedural code with no mechanism for update; or silently recalculating a stale deadline from a rule file that has not itself been reconciled with the amended law.*

**6. Pure data layer**
The skill's job ends when it writes a record to the shared database. It does not rank deadlines, recommend what to work on, or generate alerts. Those responsibilities belong to `executive-assistant`.

*Violation example: adding logic to "surface the three most urgent upcoming deadlines" — that is prioritization, not deadline management.*

### Litmus Test

*Does this behavior make the deadline record more complete, accurate, or consistent?*

- **Yes** → in scope (extracting a date from a document, calculating a derived deadline, flagging a source conflict, recalculating after an anchor change, updating a rule in the rule set).
- **No** → out of scope (ranking deadlines by importance, alerting the practitioner about an approaching deadline, recommending what to work on next).

## 4. Non-Goals

- **Surfacing and alerting** — ranking deadlines by urgency or generating daily alerts is `executive-assistant`'s responsibility.
- **Legal research and rule interpretation** — the skill applies BC rules it already knows; it does not interpret novel legal questions or look up case law. Adding rule rows to the per-proceeding rule files (`references/bcsc-rules.md`, `bcca-rules.md`, `bc-arbitration-rules.md`, `limitation-rules.md`) is maintenance (Principle 5), not legal research.
- **Multi-jurisdiction support** — scope is BC only; no abstraction for other provinces or federal courts.
- **Calendar and scheduling integration** — the skill does not sync with Outlook, Google Calendar, or court scheduling systems.
- **Client-facing output** — all data is for the practitioner's internal use only.

## 5. North Star

A complete, current, dependency-correct deadline record for every active matter: every anchor date captured from its source document, every derived deadline accurately calculated from the rule or order that produced it, every dependency chain intact so that anchor changes cascade correctly, and every source conflict surfaced before it can produce a wrong answer.

If `executive-assistant` can read the deadline table and never encounter a gap, a stale derived deadline, or an unresolved source conflict — the skill is succeeding.

## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*
