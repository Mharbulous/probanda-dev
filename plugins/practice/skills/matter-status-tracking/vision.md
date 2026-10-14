# Matter Status Tracking — Vision & Design Philosophy

**Date:** 2026-04-14

## 1. Platform & Scope

A Cowork plugin skill. Reads and writes practice data only by invoking `practice-data` operations (`matter-lookup`, `read-signals`, `set-status`, `upsert-signal`). Layer 1 in the plugin dependency graph: it feeds the executive assistant, file prioritization, and AR follow-up skills.

The skill needs to persist two categories of data (schema design is owned by `practice-data`):

- **Status definitions and policies** — status names, descriptions, signal conditions, and auto-advance rules. Ships with defaults; practitioners can modify.
- **Per-matter signal states** — the current state of each tracked signal for each matter (conflict check completed, retainer agreement signed, deposit received, etc.).

To derive signal states, the skill reads data that upstream skills keep in practice data — primarily `retainer-tracking` (retainer balance, deposit records, via `trust-summary`) and `ar-follow-up` (payment standing, via `ar-data`; billing history, via `invoice-data`). It does not call those skills directly; it invokes those `practice-data` operations.

The displayed status label for a matter is derived deterministically from the current signal states against the policy table. The computed label is also persisted to `matters.status` so downstream skills can query it without re-running policy logic.

## 2. Purpose

### Audience

A sole BC litigation practitioner and occasionally a legal assistant.

### Pain Points

The business cycle of a law practice — client intake, retainer management, billing cycles, and offboarding — runs on a set of recurring obligations that must be met consistently across every file. Conflict checks must be completed before work begins. Retainer agreements must be signed before funds are accepted. Retainers must be replenished on time. Representation must be formally ended when matters close. Without a system tracking these obligations, they fall through the cracks: retainer requests go out late, conflict checks get skipped under pressure, files sit open long after representation has ended.

### Value Proposition

Matter-status-tracking gives every other CoClerk skill an authoritative, current answer to "what is the engagement state of this file?" — without asking the practitioner to reconstruct it. Status is not entered manually; it is computed from signal states against user-configurable policy rules. The system tracks the business cycle so the practitioner doesn't have to.

### Killer Use Case

A practitioner asks "which files need attention today?" The executive assistant, drawing on matter status, filters out closed and declined matters, flags a file where retainer funds were requested 10 days ago but the deposit still hasn't arrived, and surfaces another where the conflict check was completed but the retainer agreement was never signed. The practitioner gets a triage list grounded in actual engagement state — not reconstructed from memory.

## 3. Theme & Design Philosophy

Matter-status-tracking is the business infrastructure of the practice, not the legal infrastructure. It tracks the engagement lifecycle — intake through offboarding — for every file, regardless of practice area or court level. It does not track what the lawyer does on a matter; it tracks the state of the client relationship and the obligations that must be met to maintain it properly.

### Design Principles

**1. Universal signals only.**
Every signal tracked by this skill must apply to every client matter without exception, regardless of matter type. A signal that is meaningful for Supreme Court litigation but not for a small claims matter or a corporate transaction does not belong here — it belongs in a matter-specific planning skill. If the signal can't be tracked consistently across all files, it cannot produce a deterministic status label.

*Violation example:* Adding "statement of claim filed" as a signal because most active matters are in litigation — breaking status computation for the family law and corporate files that don't have claims.

**2. Absence of evidence is not evidence of absence.**
When the skill cannot locate a signal artifact (a signed retainer agreement, a deposit record), it must request practitioner confirmation before treating the signal as unmet. A missing document may mean the obligation was never fulfilled — or it may mean the document hasn't been scanned yet. The skill cannot distinguish between these cases. Auto-advance requires positive confirmation of a signal, never merely the absence of contradicting evidence.

*Violation example:* Auto-setting a file to "no retainer agreement" because no signed document was found in the DB, when in fact the agreement was signed but not yet digitized.

**3. Policy drives automation — and policy is configurable.**
Each status definition carries its own rule for when auto-advance is appropriate. When a signal can be positively confirmed (e.g., a retainer deposit record exists and matches the matter), the skill advances status automatically. When confirmation is uncertain, it surfaces a suggestion and waits. Practitioners can modify these rules — the defaults ship in the status definitions table, but the practitioner controls how the skill handles each status transition.

**4. Status labels are derived, not entered.**
The practitioner never manually sets a status label. They update signal states (or configure policies); the label is computed from those inputs. This ensures status labels are consistent, reproducible, and grounded in observable facts — not in whatever the practitioner happened to type last.

**5. Persisted for consumers.**
The computed status label is written back to `matters.status` after each evaluation so that downstream skills — executive assistant, AR follow-up, file prioritization — can query current status directly without re-running policy logic. This keeps the skill's internal mechanism invisible to consumers.

**6. Pure data layer.**
This skill tracks signals and derives labels. It never recommends what to do about them. Recommendations — "you should request a retainer top-up on the Smith file" — belong to the executive assistant, which has the full practice picture. Matter-status-tracking supplies the raw material.

### Litmus Test

**"Would a lawyer need to track this for every file they open, regardless of matter type?"**

- "Has the client signed a retainer agreement?" → **Yes** — applies to every engagement.
- "Has the statement of claim been filed?" → **No** — only litigation matters have claims.
- "Has the retainer been replenished after the warning?" → **Yes** — applies to every matter with a retainer.
- "Has discovery been completed?" → **No** — belongs in a litigation-planning skill.

## 4. Non-Goals

- **Litigation milestones and process tracking** — filing deadlines, discovery completion, trial preparation. These belong in a `litigation-planning` skill where each matter has its own plan.
- **Legal research or document drafting** — the skill tracks whether a retainer agreement exists; it does not draft one.
- **Client-facing output** — no status portals, no client notifications. All output is for the practitioner.
- **Trust accounting or compliance reporting** — retainer balance data comes from `retainer-tracking`; this skill reads that signal but does not own the accounting layer.
- **Recommendations** — surfacing what to do about a matter's status belongs to `executive-assistant`.

## 5. North Star

Every matter's engagement status is always current — so the practitioner is never late requesting a retainer replenishment, never forgets to get off record, and never misses a conflict check — because the system tracks the business cycle, not the lawyer.

The measure: every active matter in the DB has a computable, non-null status label derivable without practitioner input, and that label accurately reflects the current state of the engagement lifecycle.

## 6. Anti-Patterns

**Pattern:** Scoping signals to the practice's current dominant matter type (e.g., Supreme Court litigation) rather than to what applies universally.
**Why it's wrong:** Status labels become non-deterministic for matters outside that type, and the skill silently produces incorrect or missing status for a subset of the caseload.
**What to do instead:** Apply the litmus test before adding any new signal. If it doesn't apply to every file, route it to a matter-specific planning skill.

---

**Pattern:** Treating an absent document or record as confirmation that the underlying obligation was not met.
**Why it's wrong:** The DB only knows what has been entered. A signed retainer agreement that hasn't been scanned looks identical to one that doesn't exist. Auto-declining status on absence produces false negatives that damage the practitioner's trust in the system.
**What to do instead:** Absent signal → surface a suggestion with a confidence qualifier and wait for practitioner confirmation before writing a status change.
