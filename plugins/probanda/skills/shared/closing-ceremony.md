# Closing ceremony — how a completed ticket hands the work forward

This file is the single source of truth for **what a session does at the moment it
finishes a ticket**. Its callers are `/wayfinder`, `/triage` and `/implement`;
those skills reference this file and do not restate it.

The point is a small one: the human should not have to pick the next ticket by
hand, and should not have to read prose to learn whether the last one closed.
Every completed ticket ends the same way — clickable chips for the next work, or
one fixed line saying there is none.

Every tracker query this file relies on — the frontier query, the claim window,
the dependents query, the brief read, blocking edges, claiming, resolving — is defined in
`docs/agents/issue-tracker.md` under "Wayfinding operations". Run them as that
doc defines them. This file never restates a query.

## When it fires

**A ticket closed, and its self-audit passed.** In all three skills, as the
closing act of the session that completed the ticket. Also after charting or
re-charting a map, which is a closing act that creates frontier tickets and is
also a moment when pending fixes are worth sweeping for.

**A planned slice of a multi-session ticket is done.** The ticket stays open, and
the session hands the next slice forward by **Planned hand-off**, below. That
section replaces the sweep and the self-audit for this trigger.

Nothing else fires it. A session that stopped for any other reason — paused for a
HITL human, hit a landing conflict, ran out of the ticket's scope — dispatches
nothing and ends with the stopped line below.

## Planned hand-off

A ticket is **multi-session** when a comment on it, or its brief, records a
decision that splits the work into sessions, such as one day per session. Such a
comment names the unit and lists the slices. A session that finishes its planned
slice has not stopped early, and it hands off with a chip, never with a printed
prompt for the human to paste:

1. Record the slice as that decision says, such as a progress comment and a ticked
   list item.
2. Release the ticket by the tracker doc's **Release** operation.
3. Claim the same ticket again by the tracker doc's **Claim** operation. A refusal
   means another session already holds it, and a `blocked` outcome means Claim
   has already released it: either way, spawn nothing and say so.
4. On success, spawn one chip by the template for the calling skill's ticket kind,
   below. Its context block also names the next slice and where the procedure
   lives. Its `title` adds the slice after the ticket title.

When no slice is left, the ticket's last session closes it, and the ceremony runs
as for any completed ticket.

## Self-audit, before the sweep

The ceremony runs only once the ticket is genuinely finished on the tracker. The
audit is the caller's own, unchanged:

- **`/wayfinder`**: resolution comment posted naming the commit where the work
  landed, issue closed, the map's Decisions-so-far re-fetched and confirmed, newly
  surfaced tickets created and wired. A re-chart session runs the shorter audit
  its own skill states.
- **`/implement` and `/triage`**: resolution comment posted, issue closed, commit
  pushed.

An audit that does not pass is not a close. Finish it, or end with the stopped
line.

## The brief to `frontier-scout`

Dispatch the `frontier-scout` agent with: the repo checkout's absolute path, the
issue just closed, the maps and tickets it touched, and the areas of the codebase
this ticket's own work edited. Tell it to sweep both queues — every open map's
children, and every open `ready-for-agent` / `ready-for-human` ticket carrying a
brief — and to return its wave, its held list and its command list.

**Carrying a brief** means the issue has a `## Agent Brief` comment, as the
**Brief read** in `docs/agents/issue-tracker.md` tests it, or a body that carries
the three parts `/implement` step 3 accepts in its place: a heading naming
the change, a scope clause, and an out-of-bounds clause. A ticket labelled ready
with neither is mislabelled, not ready: hold it and say so, never draft a chip for
it.

**The areas edited are an input to the overlap hold, not its scope.** The hold
below runs across every ripe pair, whatever this session touched. The areas are
what let the scout recognise fallout from *this* ticket in particular. A sweep with
no just-closed ticket passes no areas and still runs the hold in full.

The scout finds and drafts. It never spawns, claims, comments, edits, closes or
creates. The session makes every write.

## What comes back

- **The wave** — every ripe AFK ticket and at most three HITL tickets (see Cap),
  in rank order, each with a one-line reason, a HITL / AFK mark, and its chip's
  `spawn_task` block fully drafted from the templates at the end of this file.
- **The held list** — every other ripe ticket with one reason each: blocked,
  claimed, overlap, over cap.
- **The command list** — every command the scout ran. Read it before spawning
  anything. If a write appears in it, stop, spawn nothing, and say so.

## Cap

Every ripe AFK ticket gets a chip. HITL tickets are capped at three, the three
highest-ranked. Every other ripe HITL ticket is reported as held with the reason
"over cap".

A ticket is **AFK** when it carries `ready-for-agent`, or is a wayfinder
`research` ticket or a `task` marked `wayfinder:afk`. It is **HITL** when it
carries `ready-for-human`, or is a wayfinder `grilling` or `prototype` ticket or
a `task` marked `wayfinder:hitl`.

## Ranking

Tiers, then issue number ascending within a tier:

1. Work that unblocks verification — red CI, a broken build, flaky tests.
2. Correctness bugs (`bug`), and wayfinder grilling tickets.
3. Everything else.

Blast radius is a reason line and may promote a ticket one tier. It is not a sort
key. There is no momentum tier: a ticket is not ranked up for being near the work
just finished.

## Overlap hold

**Hold the map child, not the fix.** When an unclaimed ripe `bug` would plausibly
edit the same area as a map child, hold the map child and dispatch the bug. Fallout
from the last ticket is not a separate track running alongside the map; it is work
the map child has to wait for.

The exception is a live claim: hold the bug instead when the map child already
carries a live claim, because a session is in that code now.

The hold is restricted to `bug`. An `enhancement` is not fallout and never holds a
map child.

**Wire the edge when the hold fires.** A held map child means the bug was never
wired as its blocker. Add the blocking edge now, as the tracker doc defines it, so
the next sweep sees a native blocked ticket and has nothing to judge.

**A hold stated only in a comment is not a hold.** A ticket whose comments say it
waits on another ticket, with no native edge carrying it, is unblocked as far as
every query here is concerned, and the sweep will draft its chip. The scout never
softens a query to honour prose: it reports the comment beside the ticket. The
session then wires the edge before spawning, which is the fix, and the next sweep
needs no prose at all.

## Dedupe

**Claim before the spawn.** For each ticket in the wave, in rank order, run the
tracker doc's **Claim** operation *before* spawning its chip. Spawn only on
success. A `blocked` outcome means Claim's gate found an open blocker and has
already released the ticket: spawn nothing for it, and report it held with reason
`blocked`, whatever the scout reported. A refusal — at its read step or at its confirm step — means another
session holds the ticket: spawn nothing for it, and report it held with reason
`claimed`, whatever the scout reported. A refusal at the confirm step first
withdraws this ceremony's own claim comment, as that step says, so it cannot
refuse the winner's chip. The scout's claim data is advisory,
because its sweep takes minutes and the only read that can be fresh is this
session's own, immediately before its own write. A blocked ticket or a refused
claim shrinks the wave; it never pulls in a held HITL ticket in its place.

A successful claim posts a live claim comment, so the next sweep skips the ticket
for the claim window. The ceremony does no cleanup: an unclicked chip holds its
ticket for the claim window, after which it is takeable and re-spawnable again.
The chip prompt carries the claim id this ceremony recorded, and the chip's own
Claim accepts that id as the one claim ahead of its own, never in place of it. A
chip that releases the ticket deletes that id along with its own, by the tracker
doc's **Release**, so the ticket is takeable at once.

The cost is intended: a bare `/implement` or `/wayfinder` also skips a
spawned-but-unclicked ticket while the window holds.

## Signal contract

The turn that ends the ticket ends with the chips, then any open questions in full
as a numbered list, then exactly one of these as its **last line**. Nothing follows
it. A question above a closed line is filed or answered next turn; it never gates
the ticket, because the line says the ticket is already closed.

| Situation | Last line |
|---|---|
| Closed, work to hand forward | `Closed #<n> <title>. <k> chips created.` |
| Closed, nothing ripe | `Closed #<n> <title>. Nothing to hand forward.` |
| Closed, sweep failed | `Closed #<n> <title>. Dispatch skipped: <error>.` |
| Planned slice done, chip spawned | `Handed off #<n> <title>: <slice> done. 1 chip created.` |
| Planned slice done, no chip | `Handed off #<n> <title>: <slice> done. Claim released, no chip: <reason>.` |
| Session ends without closing | `Stopped without closing #<n> <title>: <reason>. Claim kept.` |

Charting and re-charting use the same lines with `Charted <map title>` in place of
`Closed #<n> <title>`.

A session whose own **Claim** returned `blocked` has released its claim, not kept
it: it spawns nothing and ends with `Released #<n> <title>, blocked by #<k>.`

A HITL pause mid-ticket is not a stop. That turn may end with the gating question,
the ticket is not closed, and no line is printed. This is how the human tells a
gating question from a tangent: a question that ends a turn before the close gates
the ticket; a question listed above a `Closed` line does not; anything else is
filed.

The two `/wayfinder` triggers that spawn chips without closing a ticket keep their
chips and end with their own distinct lines, so a chip alone never reads as a
close:

- `Released #<n> <title>, blocked by #<k>.`
- `Fan-out: <k> chips.`

## Tangent rule

Anything noticed mid-ticket that is not needed to close the ticket is **proposed as an
issue**, not narrated: `needs-triage`, one paragraph, linked to the ticket it came
from. Before anything is filed, dispatch the `sentinel` agent with every proposal at
once, each with `Kind: tangent`, `Source: #<this ticket>` and this ticket's scope. It
applies the filing bar (#1664) and returns a verdict per proposal with the exact text
to post. Carry out each verdict as its **Output** section in
`.claude/agents/sentinel.md` defines it. A `fix-in-place` proposal is fixed within
this ticket.

Fallout from this ticket's own work that would collide with a map child skips the
sentinel: file it, and the same act adds a native blocking edge against that map
child. A rejected issue is closed, so it could not hold the edge.

The closing narration lists the tickets filed, rejected and sighted. It does not
carry the observations behind them.

## Failure rules

- **A failed sweep never reopens or stalls the closed ticket.** Say the dispatch
  was skipped and why, in the third line above, then stop. The tracker self-heals:
  a later bare run works the same frontier.
- **No `frontier-scout` in this environment** (Codex): the session runs the sweep
  itself, by this doc.
- **No `sentinel` in this environment** (Codex): the session applies the bar and
  the prior-rejection match in `.claude/agents/sentinel.md` itself, and posts the
  same verdict text.
- **No `spawn_task`**: print each chip prompt in its own fenced block, in rank
  order, then the last line. `/wayfinder`'s numeric-map successor rule stays in
  that skill and overrides this fallback for an opted-in map.

## Chip title prefix

Every chip `title` begins with a prefix naming the kind of session it opens, so
the human can tell them apart in the session list:

- `GRILL: ` — a wayfinder `grilling` ticket;
- `CHART: ` — a chip that charts or re-charts a map;
- `HITL: ` — any other HITL ticket;
- `AFK: ` — an AFK ticket.

The prefix counts toward the tool's title cap. Trim the ticket title, never the
prefix.

## Chip prompt — a wayfinder ticket

`title` the prefix, then the ticket's title (over the tool's cap, trim it and say so). `cwd` the
target checkout — never omit it, the tool will not catch it. `prompt` begins
`/wayfinder <ticket URL>`, then a context block naming:

- the checkout's absolute path, to work in on `main` even if the app opens a
  worktree;
- the tracker doc, and the traps this session learned;
- the claim id this ceremony recorded for this ticket, which the chip's own
  **Claim** accepts as the one claim ahead of its own, and that if Claim refuses,
  the chip stops, after withdrawing its own claim comment if it stamped one, and
  does not unassign; a `blocked` Claim means Claim has already released the
  ticket, that id included if the chip confirmed behind it, and the chip stops; a chip that releases the ticket deletes that id along with
  its own, by the tracker doc's **Release**;
- one model line naming what this ticket calls for — Opus 5.5 at medium effort, or
  Fable 5.1 at low effort for a plan-only ticket — which the chip, itself an
  orchestrator session, checks against its own running model as its first act and
  then proceeds either way, so a spawn is never delayed for a model change;
- this ticket only, plus which sibling chips this ceremony created;
- landing: on `main`, no branch or PR; update first with `git pull --ff-only`,
  or, if `main` has diverged, the merge script CLAUDE.md "The shared worktree"
  names (never a plain or `--no-rebase` pull, a non-fast-forward merge, or a
  stash); stage only your files; push `main` when the ticket closes — the map
  owner's standing authorization;
- completion: resolution comment naming the commit, close, Decisions-so-far
  re-fetched to confirm, then run this ceremony in turn.

The chip commits and lands its own ticket, and every subagent brief it writes says
"do not commit". On a ratification-discipline map — one whose Notes make findings
hypotheses until the human ratifies them — the brief also states the presentation
requirement: ratification means putting the pages in front of the human, one
hypothesis at a time, never summarizing them and asking for trust in the summary.
When one wave spans more than one map, name each ticket's map next to its title,
in both the sibling-chips list and the closing narration.

## Chip prompt — an implement ticket

`title` the prefix, then the issue title (over the tool's cap, trim it). `cwd` the repo checkout
root — never omit it. `prompt` begins `/pocock-skills:implement #<n>`, then a
context block stating:

- the checkout's absolute path and the issue URL;
- claim first, before any other work, by the tracker doc's **Claim** operation,
  accepting the claim id given here — the one this ceremony recorded — as the one
  claim ahead of your own;
  if Claim refuses, stop, after withdrawing your own claim comment if you
  stamped one, and do not unassign; a `blocked` Claim means Claim has already
  released the ticket, that id included if you confirmed behind it, so stop; if you release the ticket, delete that id
  along with your own, by the tracker doc's **Release**;
- the most recent `## Agent Brief` comment, or failing that the body under
  `/implement` step 3, is the contract;
- the repo's own branch, commit and push policy;
- the sibling chips this wave created, by title, and that they may be editing
  nearby.

For a `ready-for-human` ticket the context block also says why it needs the human,
and to resolve the open decisions before implementing by `/wayfinder`'s "Resolving
a grilling ticket" protocol (its map-only steps do not apply), so the human is
asked only what their grilling profile keeps for them, in one list at the end.
