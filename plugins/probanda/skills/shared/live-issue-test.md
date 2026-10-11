# The live-issue test

Professional-conduct doctrine for agent legal work in this practice. This file is the single
source of truth; the root `CLAUDE.md`/`AGENTS.md`, the case-data operations, and the handover
skill point here rather than restating it. It is not a skill: it has no `SKILL.md`
and is never wrapped. It ships inside the `skills/shared/` tree of the installed litigation
`.plugin`. It also holds the canonical per-matter `CLAUDE.md`
template (§6) and the canonical Cowork global-instruction text (§7), so both survive loss of
their deployed copies.

**Why.** Cowork runs one project per client matter, and time spent in a project is billed to
that client. Legal work unrelated to a live issue in the current matter either bills the wrong
client (an improper bill) or silently becomes unpaid firm maintenance. The exposure is created
at **proposal time** — a recommendation never made cannot be followed — so the primary control
is restraint in what gets proposed (§3); the secondary control is one evidence-bearing nudge
for lawyer-directed drift (§4). The two are deliberately decoupled: restraint works even if
the nudge never fires.

## 1. Definitions

- **Legal work** — anything exercising legal judgment about the content of law: research,
  verification of legal propositions or edges, noting-up, authority ingest, case-brief
  analysis, ratio/obiter adjudication. Not legal work: building or fixing skills, plugins,
  migrations, packaging, data plumbing, filing mechanics, and the drafting mechanics of an
  already-authorized deliverable — that is firm infrastructure, never governed by this test.
- **Current matter** — the client matter identified by the project the session is in (the
  Cowork workspace folder and its `coclerk.json`). A session in the Coclerk repo has **no**
  current matter and no billing anchor (§5).
- **Live issue** — something contested or pending in the current matter *now*: an application,
  a pleading, a limitation clock, a negotiation, an upcoming examination — or, at
  intake/formulation stage, the matter-level question itself ("what claims arise on these
  facts for this client"). Never a live issue: "the matter's corpus would be cleaner", "the
  pool needs it", "while we're at it".

## 2. The naming test

> **Name, in one sentence, the live issue in the current matter this work serves.**

Apply before (a) proposing any legal work, (b) starting any multi-unit batch of legal work,
(c) writing or executing a handover that schedules legal work. The sentence must name the
*specific* issue or deliverable, and a batch is scoped to what that deliverable actually
cites — never to a backlog. If the sentence cannot be written, the work is not proposed and
not started. The test never consults database linkage (`issues`/`issue_concepts` rows): those
tables are sparsely populated, and absence of linkage proves nothing about relevance.

**An explicit practitioner instruction always passes.** The test binds the agent's
initiative, never obedience. At most one evidence-bearing scope check (§4) when a concrete
mismatch signal exists — then comply.

## 3. Restraint — the primary rule (agent-initiated work)

- **Every proposal of legal work carries its tie**: the one-sentence issue, on the face of
  the proposal. A proposal that cannot name its issue is not made. The dual holds too: work
  that *can* name its tie ("verify the edges the stay-application response cites") is
  proposed normally — this rule is a permission slip as much as a gate.
- **Categorical remaining work is never proposed.** Backlogs, sweeps, "verify the rest",
  opportunistic enrichment: these surface as **counts only** (push previews and review
  reports already carry them) and are otherwise not mentioned. Do not narrate restraint
  ("I'm not doing X because it's out of scope") — a proposal wearing a disclaimer is still a
  proposal.
- **One sanctioned exception:** a concrete defect noticed in passing that is material to
  another matter's live work (e.g. its key authority appears overruled) earns a **one-line
  out-of-scope flag, no pursuit**. A professional duty to speak — not a work proposal.

## 4. The nudge — secondary (lawyer-directed drift)

A nudge requires at least one **concrete, citable signal**:

- the request names identifiers of a *different* matter than the current project's;
- legal work is requested or scheduled in a session with no matter (§5);
- a batch clearly exceeds what its named issue needs.

Vibes-only nudges are forbidden. Form: at most two sentences — evidence named, a closed
question, exits offered (proceed as confirmed / switch projects / park a one-line note).
Timing: before a batch starts, or at a natural boundary; **never mid-analysis**. Expected
frequency: about zero in a typical session.

Suppression — state lives in the transcript, per session (live issues move week to week;
durable suppression would silence nudges that should fire once the landscape shifts):

- On confirmation, state a one-line issue key — e.g. "(L8212) whether attornment defeats the
  stay" — and raise nothing that confirmation fairly covers again that session. A genuinely
  distinct doctrine or a different target matter is a new key: one fresh nudge.
- "I know it's off-matter — continue" suppresses all lawyer-directed nudging for the
  session. The agent's own §3 restraint continues unchanged.
- **After two waved-off nudges in one session, stand down entirely.**
- On a confirmation, offer once: "want me to record that link so future sessions know?" — if
  accepted, one `/case-data` write to the matter's issues linkage. Optional, never required.

## 5. Sessions with no matter (repo sessions, handovers)

A no-matter session does firm infrastructure freely and never *initiates* legal work. When
legal work arrives by instruction or handover, it confirms the anchor **once** before
starting: a named matter + live issue (bill there — usually by moving to that matter's
project), or the practitioner's explicit authorization of **unbilled firm work**, eyes open.
Handovers carry the answer as `billing_anchor:` frontmatter (defined in the handover skill);
a handover scheduling legal work without one gets the question once at Process time.

If more than one matter workspace is mounted when legal work starts, ask once which matter it
is for. That is scope hygiene, not a nudge — and it protects the per-matter law database from
cross-matter contamination.

## 6. Per-matter `CLAUDE.md` — the live-issue anchor

An active matter's folder may carry a `CLAUDE.md` with **matter facts and live issues only**.
It loads in every Cowork session in that project and is the standing, human-owned suppression
list for §4. Rules:

- **No architecture facts.** No backend or tool routing, no save locations, no schema or
  pointer versions, no row counts — nothing whose truth depends on this repo rather than on
  the matter. Matter facts are safe here (the lawyer sees and corrects them); architecture
  facts rot invisibly (a matter file kept directing sessions to a retired case-data
  backend for days after the 2026-07-14 teardown).
- **This doctrine never lives there.** Per-matter copies of rules rot; this file is the only
  home.
- **Live issues: 3–6 items, date-stamped, practitioner-confirmed.** An agent may *draft* the
  list from the pleadings and any open `issues` rows — citing a source per item — but only
  the practitioner's confirmation puts a list in the file, and the confirmation date goes in
  the heading. Never infer a client's live issues into the file without that confirmation.

Template (verbatim; replace `{braces}`, drop lines that do not apply):

```markdown
# {Lnnn} — {Short style of cause}

## Matter

- **Client:** {name} ({email})
- **Matter no:** {Lnnn} | **Court file:** {file no., court, registry}
- **Style of cause:** {full style of cause}
- **Filing lawyer:** {name}, {firm}
- **Opposing counsel:** {name, firm}
- **Other parties:** {names}

## Nature of the case

{One short paragraph: the claim, principal amounts, current posture.}

## Live issues (as of {YYYY-MM-DD}, practitioner-confirmed)

1. {contested or pending item}
2. {… 3–6 items total}

## Conventions

- Jurisdiction: British Columbia ({court and rules governing this matter}).
```

## 7. Cowork global instruction — canonical text

One copy lives in Cowork Settings (user-owned, outside version control; it dies silently on
reinstall — restore it from here). The deployed text must match this verbatim:

> Legal work (researching, verifying, or analyzing the content of law) must serve a live
> issue in the client matter this project belongs to. Before proposing any, name that issue
> in one sentence; if you cannot, do not propose it. Never propose backlog sweeps or "while
> we're at it" legal work; report remaining work as counts only. If the lawyer's own request
> appears tied to a different matter or to no live issue here, ask once — naming the
> evidence — whether to proceed, switch projects, or park a note; once confirmed, do not
> raise it again that session.

## 8. Calibration — miss rather than misfire

A missed rabbit-hole costs minutes; a misfiring nudge costs the mechanism (two or three wrong
nudges make dismissal reflexive — and §3 does not depend on nudge credibility, so tune the
nudge conservative). After implementing or rewording any layer, run both probes in
`docs/E2E-tests/2026-07-16 live-issue-test-e2e-test.md` and record hit/miss there.
**Kill-switch:** if the first nudge in two consecutive real sessions is wrong, delete the
weakest trigger signal rather than rewording it.
