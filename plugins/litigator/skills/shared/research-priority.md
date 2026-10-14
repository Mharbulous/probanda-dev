<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Research priority — the order every legal lookup runs in

This file is the single source of truth for **where an answer about the law may
come from, and in what order**. Every component that looks up law follows it:
`legal-research`, the law-audit agents (via `shared/legal-audit-protocol.md`),
the application pipelines' research seams, the `westlaw-query-optimizer` subskill of
`/legal-research`, and the
authority-ingest skills. No consumer restates the order — each references this file.

It governs *answering*. It does not govern *verification*: good-law checks
(note-up, citator, treatment chain) run wherever they are available, at any tier.
Judicial consideration of legislation is answering (`statute-currency.md`).

## The four tiers, and CanLII note-up

| Tier | Layer | Access path | Cost |
|---|---|---|---|
| 1 | Matter case data — ingested authorities, concepts, criteria, the legal spine | invoke `/case-data` (query) | local, free |
| 2 | **The shared pooled layer** — matter-free principles, their public authorities, criteria and treatment edges | see "Reaching tier 2" below | cloud read, permission-prompted |
| 3 | The matter's `6. LAW\` folder — memos and downloaded decisions not yet ingested | file reads → `/ingest` on anything load-bearing | local, free |
| 4 | Westlaw: retrieval of decision text and Deep Research memos | the `/legal-research` caller, before the audit agent starts: `westlaw-query-optimizer` → `research-paralegal` (deep-research mode, and citation mode `westlaw-first`) | subscription, in-plan content only |

| Row | Source | Use | Cost |
|---|---|---|---|
| Note-up (citator) only | CanLII | CanLII's API returns no decision text. It cannot tell you what a case says. Never use it to find, read or summarize a decision. Its citator (citing and cited cases) notes up an authority whose text was read at tiers 1–4. | free, needs a key |

**Westlaw unreachable is a hard stop, never a descent to CanLII.** When Chrome is
not connected or Westlaw is not signed in, research stops and the practitioner is
told (`shared/legal-research.md`). Nothing continues on CanLII in its place.

## Escalation rule

Stop at the first tier that yields an authority sufficient to answer **with a
pinpoint citation**. Lower tiers still run when the question needs currency
confirmation (note-up), when the practitioner asks for exhaustive research, or
when a higher tier answered only part of a compound question — split it and run
each issue down the ladder separately.

Tier 2 sits above tier 3 deliberately: a pooled principle carries its authorities
and criteria and has already been through a severance and adjudication pipeline,
whereas an un-ingested file in `6. LAW\` has not yet been read into any layer.

CanLII is never an answering source, and it is the note-up tool at every tier.
A tier-1 or tier-2 hit that has never been noted up is still an answer whose
reliability is capped — say so rather than descending the ladder for its own sake.

## Tier 3 is a discovery layer, not an answer layer

A hit at tier 3 is not the end of the lookup. Anything load-bearing found there
goes through `/ingest`, which promotes it into tier 1 for every later lookup in
the matter. Answering straight off an un-ingested file leaves the next lookup to
rediscover it.

**Document formats.** `.docx` and `.doc` memos in `6. LAW\` cannot be opened by a
read-only tool grant. A component that cannot open one records it as **UNREAD**
with its path and says so — it never treats an unopened memo as an absent one.
The orchestrating caller extracts the text (`shared/legal-research.md`,
duty 2) and supplies it, or re-invokes with the extracted
text in the prompt.

## Reaching tier 2

How tier 2 is audited depends on what the running component holds:

- **A component whose tool grant includes the pooled-layer read tools** audits it
  directly: `legal_commons__find_candidates` (several rephrasings, so paraphrases
  are caught), `legal_commons__lookup_by_citation` where a citation is already
  known, `legal_commons__browse` for keyword substring, `legal_commons__resolve_by_id`
  and `legal_commons__treatment_chain` for note-up. Reads only — never a write tool.
- **A session whose own tool list carries them** (a project with the pooled-layer
  expansion installed) runs the same reads itself and passes the results into any
  agent it spawns.
- **A component holding neither** does not fake the tier. It either spawns
  `research-agent`, which audits tier 2 directly, or records tier 2 as
  **NOT AUDITED** and says so.

Where the expansion is not installed at all, tier 2 does not exist for that
session: record it as **not installed**, skip to tier 3, and never treat its
absence as "searched, nothing found".

**The permission prompt is not friction.** Every pooled-layer call fires one, and
that is the boundary between routine local case work and a deliberate cloud touch.
Reads are cheap and safe and are meant to be routine; the prompt is never
allowlisted, suppressed, or "fixed" to make them so.

## Pool-unreachable protocol

Learned from the 2026-08-05 outage (free-tier auto-pause → `fetch failed` /
Cloudflare 521). Applies wherever tier 2 runs.

1. **Never conflate "unreachable" with "searched, nothing found."** They look
   identical in a summary and mean opposite things. A `data_error` from any
   pooled-layer read is reported as *pool unreachable*, distinctly.
2. **Diagnose from the error body, do not guess.** `fetch failed` or a 521 →
   most likely a paused project; tell the practitioner to check the pool's
   dashboard and resume it. A credential error → route to
   `legal_commons__configure_status`, which reports whether this machine holds a
   key without exposing it. A tool absent from the grant is a grant problem, not
   an outage — say which.
3. **Continue down the ladder.** A down pool never blocks research. Proceed to
   tier 3 and record `pool: unavailable` in the confidence summary so the
   practitioner knows the layer went unaudited and the answer's coverage is capped.
4. **One retry per session, maximum. Never silently degrade.** Do not loop, do
   not quietly drop tier 2 out of the coverage report.

## Truncated retrieval returns (research-paralegal dispatches)

Every research-paralegal mode's final report begins with a `status:` line
(`complete` or `blocked (…)`). A return that does not begin `status:` is a
mid-run message: the run was cut off (turn budget) or interrupted, and its
completion state is unknown (learned 2026-08-06: a 58-minute deep-research run
returned one narration line and was nearly read as a report).

1. Never treat it as completion or as failure.
2. Send one follow-up message to the same agent instance — “resume and return
   the mode's output contract” — never a fresh dispatch, which would violate
   the singleton retrieval lane and abandon the in-flight Chrome and Downloads
   state.
3. If the follow-up cannot run or the agent is gone,
   `<destination>/case-download-manifest.json` is the ground truth of what
   landed; report the run as `truncated` alongside what the manifest shows.

## Per-tier coverage reporting

Any component that answers a legal question states, alongside its answer, what
each tier yielded — one line, no omissions:

```
case data: audited | commons: audited / unavailable / not installed / NOT AUDITED |
6. LAW: audited / n memos UNREAD | Westlaw: run (n decisions, memo Y/N) / not run: <reason> |
CanLII: noted up / no key | Legislation: retrieved n, on disk n / not run: <reason>
```

The Westlaw reason is mandatory: `not run` with no reason is an incomplete
coverage line. So is the Legislation reason. The line ends with the Legislation segment, exactly `Legislation: retrieved n, on disk n` or `Legislation: not run: <reason>`, with nothing after it. Anything more about the instruments, such as their currency, goes in the notes below the line. Any tier you could not examine, the Legislation tier included, reads `NOT AUDITED` or `NOT AUDITED: <reason>` in place of its listed forms. No segment carries a parenthetical: counts and other detail go in the notes below the line. A tier that was skipped is reported as skipped. Silence about a tier reads as
coverage that did not happen.
