# Time-Entry-Drafting — Vision & Design Philosophy

**Date:** 2026-04-14

## 1. Platform & Scope

Time-entry-drafting is a skill within CoClerk, a Claude Cowork plugin. It sits downstream of time-sorting in the billing pipeline: time-sorting classifies raw activity into matter-attributed time blocks; this skill interprets those blocks to generate professional time entry descriptions with UTBMS litigation codes.

This is the most advanced skill in the plugin — deliberately last in the build order. Its effectiveness depends on signal richness, which will improve in two phases:

- **Phase 1 (current):** Works with TimeCamp window-title-level signals. Produces coarser descriptions that require more practitioner correction.
- **Phase 2 (future):** Works with SyncoPaid screenshot-level signals. Produces specific, accurate descriptions with significantly lower correction rates.

The skill's architecture — pattern database, description engine, UTBMS classification — is signal-source-agnostic. SyncoPaid gives it better inputs; the pipeline stays the same.

### Platform Constraints

- **Input:** Classified time blocks from time-sorting (read from the time-pipeline store, `timesort` namespace, `day:{date}`)
- **Output:** Draft time entries with UTBMS codes and narrative descriptions, written to the `time_entries` table in the shared SQLite database
- **UTBMS coverage:** All litigation codes (L-series task codes, A-series activity codes)
- **No external API calls:** This skill reads pre-classified data from the local database only

## 2. Purpose

### Audience

A sole BC litigation practitioner — the same audience as the parent plugin.

### Pain Points

**Description drafting overhead.** Even after time-sorting classifies *which matter* was worked on, the practitioner still has to describe *what was done* — converting raw activity signals into professional narrative descriptions like "Research law regarding quantum of non-pecuniary damages for sprained ankle." This is a daily cognitive load that gets deferred, leading to vague entries reconstructed from memory at end of week.

**UTBMS classification burden.** Each time entry needs a task code (L-series) and activity code (A-series) from the UTBMS litigation code set. Manually assigning codes to every entry is tedious, and inconsistent classification makes billing analytics unreliable.

**Signal interpretation gap.** Window titles and app names tell you *where* the practitioner was, not *what they were doing*. "CanLII - Google Chrome" could be research on limitation periods, quantum of damages, or procedural rules. Bridging that gap requires contextual interpretation that neither TimeCamp nor time-sorting attempts.

### Value Proposition

The practitioner gets a full day of draft time entries — each with a UTBMS code and a one-sentence professional description — generated automatically from behavioral signals. Review and correction replaces reconstruction from scratch.

### Killer Use Case

End of day. The practitioner runs the skill. It presents a list of draft time entries: "Research law regarding limitation period for personal injury claim (L120/A102) — 0.5 hrs", "Telephone call with client regarding formal offer to settle (L120/A107) — 0.2 hrs", and so on for the full day. The practitioner scans the list, corrects one or two descriptions, approves the rest, and is done in two minutes instead of thirty.

## 3. Theme & Design Philosophy

### Design Principles

#### 3.1 Never Fabricate from Insufficient Signals

ALWAYS surface raw signals and ask the practitioner to describe what they were doing when the pattern database doesn't have a confident match for an activity block. NEVER guess a description to produce a complete-looking output.
**Why:** A fabricated description on a client invoice is a professional conduct issue. An honest gap that prompts a quick practitioner input is a minor inconvenience. The asymmetry is extreme.
**Violation example:** The skill sees 45 minutes in Microsoft Word with no matching pattern, so it generates "Drafting correspondence" because Word is most commonly used for correspondence. The practitioner was actually revising a statement of claim — the invoice now misrepresents the work performed.

#### 3.2 Learn from Every Correction

ALWAYS store practitioner corrections as new entries in the pattern database, linking the activity signals to the description the practitioner provided. NEVER discard correction context.
**Why:** Each correction is a labeled training example. The skill's value proposition — decreasing correction rate over time — depends entirely on accumulating these examples. A correction that isn't stored is a correction the practitioner will have to make again.
**Violation example:** The practitioner corrects "Drafting correspondence" to "Drafting statement of claim" for a block where Word and CanLII were both open. The skill accepts the correction for this entry but doesn't record the signal pattern, so it makes the same mistake next time.

#### 3.3 Description First, Code Second

ALWAYS generate the narrative description before assigning the UTBMS code. NEVER pick a UTBMS code and then generate a description to fit it.
**Why:** The description captures the specific meaning of the work; the UTBMS code is a standardized categorization of that meaning. Starting with the code constrains the description to fit a predetermined category, which inverts the interpretation pipeline and produces generic descriptions.
**Violation example:** The skill classifies a block as L140 (Documents) based on heavy Word usage, then generates "Review and revise documents" — a description so generic it adds no value. If it had interpreted the signals first, it would have produced "Drafting reply to application to dismiss" and then correctly coded it L510/A103 (Motions Practice / Draft-Revise).

#### 3.4 Structured Descriptions Follow Legal Billing Conventions

ALWAYS produce descriptions using the standard legal billing pattern: verb phrase + subject + context. Descriptions should read as a lawyer would naturally write them on a docket entry.
**Why:** These descriptions may appear on client invoices. Non-standard or casual phrasing looks unprofessional and may trigger client pushback on fees.
**Violation example:** The skill generates "Looked at cases about damages for ankle injuries" instead of "Research law regarding quantum of non-pecuniary damages for ankle injury."

### Litmus Test

**"Does this require interpreting *what the work was* from behavioral signals?"**

- "Determine which client matter this activity belongs to" — **No**, that's time-sorting
- "Generate a description of the legal work performed during this block" — **Yes**, time-entry-drafting
- "Calculate how much to bill for this entry" — **No**, that's invoice-tracking
- "Round the duration to billing increments" — **No**, that's time-sorting
- "Map the description to a UTBMS litigation code" — **Yes**, time-entry-drafting

## 4. Non-Goals

- **Matter classification** — determining which client matter a time block belongs to is time-sorting's responsibility
- **Billing rate decisions** — what hourly rate to apply is a business decision outside this skill's scope
- **Direct LEAP integration** — this skill drafts entries into the shared database; exporting to LEAP is a separate concern
- **Real-time activity monitoring** — this skill operates on already-sorted historical blocks, not live activity streams
- **Signal capture** — capturing screenshots, window titles, or other raw signals is the responsibility of TimeCamp (phase 1) or SyncoPaid (phase 2), not this skill

## 5. North Star

**Decreasing practitioner correction rate over time.** The core metric is: of the draft entries presented for review, what percentage does the practitioner accept without modification? Early on (phase 1, limited signals), this rate may be low — the skill asks for descriptions more than it proposes them. As the pattern database grows and signal richness improves (phase 2, SyncoPaid), the acceptance rate should climb toward the point where end-of-day review is a two-minute scan rather than a thirty-minute reconstruction.

## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*
