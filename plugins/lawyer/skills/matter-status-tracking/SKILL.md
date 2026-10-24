---
name: matter-status-tracking
disable-model-invocation: true
description: Track and derive the engagement lifecycle status of every client matter, from intake through offboarding. Use to ask a file's status, which files are active or closing, whether a conflict check or retainer agreement is on file, or to update a matter's status. Trigger on 'what's the status of', 'which files are active', 'update the status on'.
---

<!-- lawyer v0.9.7 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Scope | Deciding whether a request belongs to this skill |
| Schema | Asking who owns signal items and the status rules |
| Status Labels (defaults) | Looking up what a status label means |
| Signals (defaults) | Looking up a signal key or its tri-state values |
| Database | Finding where path resolution and item reads come from |
| Workflows | Evaluating a status, updating a signal, bulk-refreshing, or auto-advancing retainer_funded |
| Label Resolution | Deriving a label from signal states |
| Consumer Contract | A downstream skill reads status or signals, or meets a NULL status |
| Anti-Patterns | Before writing a status or signal, or acting on missing or stale data |

# Matter Status Tracker

Infrastructure skill that owns the engagement lifecycle layer. Judges a status label for every
matter from its per-matter signal states, then proposes it as the matter's `status` with
`set-status` for downstream consumption. Probanda's Cloud checks each status write against the
signal states and either saves it or asks a question. Signals are updated explicitly
(practitioner confirms) or auto-advanced when positive evidence exists and data is fresh; they are
never advanced on absence alone, never advanced on stale data.

## Scope

This skill tracks the client engagement lifecycle — intake, active representation, and offboarding
— using signals that apply universally to every matter regardless of practice area. It does not
track litigation milestones, filing deadlines, or matter-specific planning. See vision.md for the
full litmus test.

## Schema

Signal items and matter items are owned by `practice-data`. The lifecycle policies that decide
which status a matter may take are held by Probanda's Cloud, not by any local store, and no tool
returns them. This skill never defines or creates storage.

## Status Labels (defaults)

| Label              | Meaning                                                            |
|--------------------|--------------------------------------------------------------------|
| `prospective`      | File opened; conflict check not yet completed                      |
| `intake`           | Conflict check done; retainer agreement not yet signed             |
| `active`           | Retainer agreement signed and deposit received; work in progress   |
| `retainer_warning` | Active matter; retainer balance at or below replenishment threshold |
| `retainer_depleted`| Active matter; retainer balance confirmed zero                     |
| `closing`          | Work substantially complete; representation not yet formally ended  |
| `closed`           | Representation formally ended (off record or file closed)          |
| `declined`         | Conflict identified or matter not accepted                         |

Probanda's Cloud holds the policy behind each label and checks every `set-status` write against it.

## Signals (defaults)

| Signal key                   | Description                                              |
|------------------------------|----------------------------------------------------------|
| `conflict_check_completed`   | Conflict search run and cleared                          |
| `retainer_agreement_signed`  | Signed retainer agreement on file                        |
| `deposit_received`           | Initial retainer deposit confirmed received              |
| `retainer_funded`            | Current trust balance above replenishment threshold      |
| `representation_ended`       | Practitioner formally off record or file closed          |

All signals are tri-state: `confirmed` / `unconfirmed` / `absent`.
- **confirmed** — positive evidence exists (practitioner-confirmed or auto-advanced from fresh DB data)
- **unconfirmed** — signal has not been evaluated for this matter
- **absent** — practitioner has explicitly confirmed the signal artifact does not exist

Absent signal artifact in the DB (e.g., no retainer deposit record) → surface a suggestion and
wait. Never auto-set `absent`.

## Database

All path resolution, schema initialization, and connection setup owned by `practice-data`. See
`..`practice-data`/SKILL.md`. This skill reads matters, retainer notices and signals through
`/practice-data`.

## Workflows

### 1. Evaluate and update status for a single matter

1. Invoke ``practice-data`` `matter-lookup` to identify the matter and retrieve its current status.
2. Invoke ``practice-data`` `read-signals` for the matter — returns all signal states. It returns
   no policies.
3. Judge the highest-fidelity matching label (see "Label Resolution" below).
4. If the judged label differs from the matter's `status`, invoke ``practice-data`` `set-status`
   to propose the new label. If the write is saved, report to the practitioner: old status → new
   status, which signals drove the change, and the timestamp. If it is refused, the refusal is a
   question from Probanda's Cloud about the matter: relay that question to the practitioner as it
   stands, and change nothing until they answer.
5. If the judged label is the same as the matter's `status`, confirm to the practitioner that
   status is current.

### 2. Update a signal for a matter

When the practitioner confirms a signal (e.g., "the retainer agreement is signed for Smith"):

1. Invoke ``practice-data`` `upsert-signal` with matter_id, signal_key, state='confirmed', and
   confirmed_at (current timestamp).
2. Re-run Workflow 1 (evaluate and update status) for that matter.
3. Report: the signal updated, the old status, the new status.

### 3. Bulk evaluate all active matters

When the practitioner asks "update all matter statuses" or the executive assistant triggers a
refresh:

1. Invoke ``practice-data`` `matter-lookup` without a filter to retrieve all non-closed matters.
2. For each matter, run Workflow 1.
3. Report a summary: how many statuses changed, which labels they moved from and to, and how many
   had stale or missing trust data (see Workflow 4 staleness check).

### 4. Auto-advance from retainer data

`retainer_funded` can be auto-advanced from the matter's `regular_trust`, but only when the data is
fresh.

**Step 1: Check sign convention.** Read `accounting.csv_mapping.sign_convention` from `probanda.json`
before interpreting the sign of `regular_trust`. If `sign_convention` is missing or the
`accounting.csv_mapping` key is absent, halt and tell the practitioner:

> "Your accounting sign convention is not configured — I can't safely interpret trust balances. Please run an import with retainer-tracking to set this up."

Do not default to any assumed sign convention.

**Step 2: Check data freshness.** Read `last_trust_date` from the matter.

- If `last_trust_date` is NULL → data has never been imported. Leave `retainer_funded` `unconfirmed`; tell the practitioner trust balance data is missing for this matter.
- If `last_trust_date` is more than 14 days old → data is stale. Do not auto-advance. Warn:

> "Trust balance for [matter] was last imported [N days ago] — too stale to auto-advance retainer_funded. Import a fresh trust listing to update."

**Step 3: Interpret balance (fresh data only).**

Interpret the raw trust balance using the sign convention from `trust-summary`. Apply:
- funded (negative if `negative_is_funded`) → invoke ``practice-data`` `upsert-signal` with
  `retainer_funded`, state=`confirmed`, confirmed_at=last_trust_date
- depleted (zero under any convention) → invoke ``practice-data`` `upsert-signal` with
  `retainer_funded`, state=`absent`, confirmed_at=last_trust_date
- NULL (no import on file) → leave signal `unconfirmed`; do not auto-set `absent`

The 14-day staleness threshold is a default.

## Label Resolution

Evaluate candidate labels in priority order. Apply the first label whose conditions are satisfied:

| Priority | Label              | Condition                                                             |
|----------|--------------------|-----------------------------------------------------------------------|
| 1        | `declined`         | `conflict_check_completed` = confirmed AND practitioner marked declined |
| 2        | `closed`           | `representation_ended` = confirmed                                    |
| 3        | `closing`          | Work-complete flag set (practitioner-only; no auto-advance)           |
| 4        | `retainer_depleted`| `retainer_funded` = absent AND `retainer_agreement_signed` = confirmed |
| 5        | `retainer_warning` | `retainer_funded` = confirmed AND balance ≤ replenishment threshold   |
| 6        | `active`           | `retainer_agreement_signed` = confirmed AND `deposit_received` = confirmed |
| 7        | `intake`           | `conflict_check_completed` = confirmed                                |
| 8        | `prospective`      | Default — conflict check not yet confirmed                            |

When a required signal is `unconfirmed` (not yet evaluated), surface a suggestion before advancing.
Example: "conflict_check_completed is unconfirmed for Smith [L8948] — please confirm to advance
from 'prospective' to 'intake'."

## Consumer Contract

Downstream skills depend on these guarantees:

| Field           | Item kind        | Guarantee                                                          |
|-----------------|------------------|--------------------------------------------------------------------|
| `status`        | matter           | One of the eight labels above; never NULL for evaluated matters    |
| `signal_key`    | signal           | One of the five default keys; custom keys may exist if configured  |
| `state`         | signal           | Always one of: `confirmed`, `unconfirmed`, `absent`               |

**NULL status (never evaluated):** A matter whose status is NULL has never been evaluated by this
skill. Downstream skills must not silently treat NULL as `prospective` — that hides the
unevaluated condition. Surface it: "matter status has not yet been evaluated — run
matter-status-tracking to initialize."

## Anti-Patterns

**Setting status manually** instead of updating signals and re-evaluating. Status labels are
derived; practitioners confirm signals. A label set without evaluating the signals won't survive
the next evaluation cycle.

---

**Treating an absent signal artifact as `absent` state.** No deposit record in the DB may mean the
record hasn't been entered yet, not that no deposit was ever made. Auto-setting `absent` on
missing data produces false negatives. Always request practitioner confirmation before writing
`absent`.

---

**Auto-advancing `retainer_funded` without checking `sign_convention`.** If the accounting system
sign convention is unknown or missing from `probanda.json`, the `regular_trust` sign is ambiguous.
Defaulting to `negative_is_funded` is a silent assumption that will produce wrong status if the
user's system uses the opposite convention. Halt and surface.

---

**Auto-advancing `retainer_funded` on stale trust data.** A trust balance imported 3 weeks ago
reflects conditions at import time. A deposit may have cleared or a cheque bounced since. Silently
advancing status from stale data gives the practitioner false confidence. Always check
`last_trust_date` before auto-advancing; warn if it exceeds the staleness threshold.

---

**Overwriting a matter's `status` without reporting the change.** If a status overwrites silently —
especially if it downgrades a matter (e.g., `active` → `retainer_depleted`) due to stale or
incorrect data — the practitioner has no way to catch the error. Always report old → new, which
signals drove the transition, and the data source.

---

**Silently treating NULL status as `prospective`** in downstream consumers. NULL means the
skill has never evaluated this matter — not that the matter is in the `prospective` state.
Treating NULL as `prospective` hides the gap. Surface it.

---

**Defining storage in this skill.** All item storage belongs to `practice-data`. This skill
only documents what items it expects to exist.

---

**Making recommendations.** "You should request a retainer top-up" belongs to
`executive-assistant`. This skill supplies signal states; it does not advise action.

---

**Assuming signal items exist for every matter.** A matter with no signals is
`unconfirmed` on all signals — which resolves to `prospective`. Surface this explicitly;
do not treat an empty result set as an error.
