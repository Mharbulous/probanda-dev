Read when: before any job read or write, and before any other file of the job checklist.
Any §N not in this file: find it in SKILL.md, "Job and scrutiny operations".

# Job checklist

Owned by `/drafting-data` (schema/SQL live here, never in a consuming skill's own files — Database Access Encapsulation). Consulted by `/draft` when it constructs `drafting_data__execute` scripts for a job-driven session (design doc `Engineering/1. Design/2026-09-02_draft-submission-ticket-sessions-design.md`; schema hop v14→v15, ADR 0009). Cites `references/schema.sql` as the DDL source of truth; nothing here duplicates a `CREATE TABLE` statement.

**Every table below is EXEMPT from §8's revision bump** (`filing-checklists.md` §8) — the job tables (`tickets`, `ticket_steps`, `ticket_scope`, `ticket_blocks`, `ticket_conflicts`, `seeds`, `ticket_proposals`, `proposal_rejections` and `ticket_answers`) carry no revision triggers, so job, step, scope, block, conflict, loose thread, lock, conversion, shelving and saved-answer writes never move `db_meta.revision`, and neither does the on-the-fly revision audit table `paragraph_revisions` (schema v57, `paragraph-revision.md`). Moving it would archive the mockups on every assigning write or step tick. A script that *also* writes a substance or filing table (parties, facts, submissions, ...) moves the revision for those rows — the exemption covers only the job tables themselves.

**No bind parameters, same rule as `filing-checklists.md` §7:** `drafting_data__execute` takes a `sql_script` string only — every value in the `jobs-*.md` files is a literal composed into the script text at write time, never a bound parameter. The SQL blocks in the `jobs-*.md` files show real literal values (an example job id, an example title) so the shape is unambiguous; substitute your own values, but never leave a bare placeholder in a script you actually run. A literal left unbound is not a hypothetical: an `UPDATE ... WHERE id = <missing value>` doesn't error, it silently matches zero rows and returns `ok` true with `changes` 0 — the confirm-read after assigning (§4), the confirm-read after an outline afresh (§3a), the confirm-read after plan approval (§5), the confirm-read after a completion (§9), the confirm-read after a retirement (§9a), the confirm-read after a close as superseded (§9b), the confirm-read after a release (§10), the confirm-read after a shelving or restore (§10a) and the confirm-read after a stale gate job's supersession (§14) are what catch that case; nothing else in these files does, so get every id right before running a write.

## 0. Timestamps

Every `created` / `locked_at` / `plan_approved_at` / `done_at` / `completed_at` / `rejected_at` value is computed in SQL, never typed by the model:

```sql
strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
```

`'localtime'` matters: `drafting_data__execute` runs host-side Python, so this is the same host wall-clock `drafting_forms__render` stamps every mockup's `Rendered:` line with (#383) — a Cowork sandbox clock is UTC and would disagree with the Job Board. Never infer a timestamp from the conversation; if a write needs "now," compute it this way, in the same statement.

## 1. Session identity (`locked_by`)

**Your identity is the `session_token` `drafting_forms__open_session` (or `drafting_forms__bootstrap`) returns on success.** It is minted fresh for your session on that call, and it is the only identity a session can offer the database for "who holds this job." Pass it back as the `session_token` argument of every later `drafting_forms__render`, which echoes it unchanged — that is how one session keeps one identity from bootstrap to last render. Render never mints one: call it without the argument and no `session_token` comes back.

**Carry it verbatim.** The server hands it to you once and holds no copy to ask for again. Never state it in chat. If you find you have lost it or are unsure you have it exactly right, **do not mint a replacement and do not silently continue** — a re-mint orphans the locks you already placed, so you would then be taking work over from yourself. Stop before any job write, tell the practitioner you have lost your session identity, name the jobs you believe are yours and when each was locked, and ask. A memory lapse is not a reason to strand the session; the practitioner, not a timeout, is the liveness check here.

**Bootstrap also returns `bootstrapped_at`** — your session's own start, `YYYY-MM-DD HH:mm` on the host wall clock. `tickets.locked_at` is written on that same clock in the same minute granularity, differing only by a `T` where this has a space, so normalize one and the two compare directly.

**A lock placed before you started is never yours.** Whatever `locked_by` says, treat a `wip` job whose `locked_at` precedes your `bootstrapped_at` as another session's and offer the take-over decision rather than reading it as your own re-entry. This holds on every host, so there is one behaviour to reason about. It costs an occasional take-over prompt for a lock that was in fact yours; that trade is accepted deliberately, because the alternative is silently swallowing a foreign lock. What it cannot resolve: two assigning writes inside the same clock minute look simultaneous, so when `locked_at` equals `bootstrapped_at` you have no evidence either way — say so and ask.

Fallback, only when calling an older bundle whose `bootstrap` returns no `session_token`: mint one via sandbox `date "+%Y-%m-%dT%H:%M"` plus a random suffix. Such a bundle also returns no `bootstrapped_at`, so use your first render's `rendered_at` as the session-start anchor instead.

## 2. Reads

Six shapes — everything else a session needs for orientation comes from the short `board_summary` that session entry's `opened` carries and `drafting_forms__render` returns when `Work_board` is named in its `documents`, and from the lanes and cards `drafting_forms__board_card` prints (ADR 0005: orient from the mockup, not a query battery; never from the Job Board page, `shared/html-pages.md`). Counted here are the reads a session runs on their own account; the reads that belong to a write idiom — §3's priority read and its id recovery, §9a's `wip` check before a retirement, §14's open-job check — sit with their own writes and are not among these four.

That orientation includes each job's stored `ticket_proposals.item`: on a Writing's card (`drafting_forms__board_card` with `jobs`), every live job's `keys:` line prints each of its keys as `<key> = "<stored item>"`, then `(now: <glyph> "<current item>")` while a Proposal in any lane still carries the key, or `(now: dead)` once none does, each item a JSON-quoted string without any count, so the changed-item comparison needs no fourth read.

**Confirm-read after assigning** (§4) — the read that makes an assigning write trustworthy (run by `drafting_data__assign_job`; its result carries these columns):

```sql
SELECT locked_by, locked_at FROM tickets WHERE id = 42;
```

**Scope read**, before every script that writes a substance table — the job's `scope:` line on its card (`drafting_forms__board_card` with `jobs`) is for orientation only; it is stale the instant it renders, so a write-time gate reads live. One read per `execute` script that writes a substance table, not one per job: the earlier wording said "once after claim and again after every scope expansion," which is a per-job cadence, and then called the same read a write-time gate, which is a per-write one. The per-write cadence is the settled one.

```sql
SELECT t.locked_by, t.status, t.rejected_at, s.entity, s.entity_id
  FROM tickets t LEFT JOIN ticket_scope s ON s.ticket_id = t.id
  WHERE t.id = 42;
```

**The `LEFT JOIN` runs from `tickets`, never an inner join from `ticket_scope`.** A job with no scope rows must still return its holder, and an inner join returns nothing at all for one (verified) — which reads exactly like a wrong id. One row comes back per scope row, each carrying the same holder columns; a job with no scope rows returns a single row with `entity` and `entity_id` NULL.

**The interpretation, per write.** `locked_by` equal to your own `session_token` (§1): proceed, and check the `entity`/`entity_id` pair on the rows against the row this script is about to write. Anything else: stop and report, reading the cause off the same row — another session's token is a take-over (§4), NULL with `rejected_at` stamped is §10a's in-progress shelving, NULL with `status = 'completed'` is a successor's completion after a take-over (§9), NULL with `status = 'queued'` and `rejected_at` NULL is a release or a shelve-and-restore in another session (§10). Those are §5's and §10's readings, and this row answers them without a second read.

The holder check belongs in the scope gate: the substance tables carry no holder column, so no other read can catch a write under a job this session no longer holds.

No rows at all means no such job — a wrong id, which is a composition bug in this session's own script, the same reading §4 gives.

**Foreign-scope read**, before every on-the-fly revision of one reviewed paragraph (`paragraph-revision.md` §3), in every session, holding a job or not: it asks whether a `wip` job of another session has claimed the row about to be edited, and any row back refuses the revision, naming the job. It leaves the holder's own scope read above unchanged: a session holding a job runs both. A fact move reads `filing_facts`, `facts` and `filings` scope, as `paragraph-revision.md` §6 sets out.

**Lock read before a dispatch** — immediately before every `research-paralegal` dispatch and every law-audit agent spawn or re-invocation (`research-agent`, or whichever audit agent `/legal-research` dispatches) made while this session holds a job. A dispatch writes nothing to this database, so no guard refuses it: after a take-over, the old holder's later writes are refused, but its research would still run and be paid for. One read per dispatch, never one per batch, because a take-over can land between two dispatches:

```sql
SELECT locked_by, status, rejected_at FROM tickets WHERE id = 42;
```

`locked_by` equal to your own `session_token` (§1): dispatch. Anything else: dispatch nothing, stop and report, reading the cause off the row as the scope read does, and naming any answer already saved under the job. This read guards no write and changes no guard: every write still carries its own.

**Confirm-read after an outline afresh** (§3a) — every statement in that script carries the same `status = 'queued' AND rejected_at IS NULL` guard, and `changes` is one total across every statement, so it cannot say which statement's guard missed, and this read stays the proof that the script landed:

```sql
SELECT id, title, status, rejected_at, locked_by, priority FROM tickets WHERE id = 42;
```

`title` must read as the practitioner confirmed it at the read-back, `status` still `queued`, `rejected_at` and `locked_by` NULL. Any other combination means the guard matched nothing and every other statement in that script wrote nothing either — the job was assigned or shelved between the render the outline was built on and the write. Stop, say so, and re-render; never re-run the script against a guess about what changed.

**Confirm-read after a release** (§10) — the release is one `UPDATE` on `tickets`, keyed on the primary key, with no trigger and no cascade, so its `changes` can only be 0 or 1. `changes` 1 means the release landed: skip this read and re-render. `changes` 0 means its guard matched nothing because the lock is no longer this session's: run this read, and the row says why. `drafting_data__release_job` runs this read itself and returns the row, so the session reads its `outcome` and never runs the read by hand. A §3f spin-off's release shares its script with the edges, so its `changes` reads differently and this read always runs there (§3f):

```sql
SELECT status, locked_by, locked_at, rejected_at, plan_approved_at FROM tickets WHERE id = 42;
```

The readings are §10's.
