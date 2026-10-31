# Does the PC's environment, rather than Probanda's code, cost session time?

Date: 2026-10-31. Counts, sizes and timings only: no client or matter content was read. Companion to `docs/Specs/2026-10-29_open-session-server-time-spec.md` §12 and ADR 0016 (the tool-call timing log).

## Where the work runs

The brief assumed the helper scripts run in the Cowork VM. Most of them do not.

- **The data server runs on the Windows PC**, reached over the desktop bridge (`submission/publish-host.ts:4-6`, `case/stage-result.ts:1-4`). So does almost all of its Python.
  - Drafting-data reads go to one long-lived Python sidecar per server process.
  - Every drafting-data write, and every case-data (`/matter-data`), practice, kv and timecamping call, starts a new host Python (`python-spawn.ts`, `spawnSync`).
- **Each such call stages its databases through a temp folder.**
  - A drafting-data write copies `submission.sqlite` out of the synced `0. CASE DATA` folder into the OS temp folder, writes the copy, then copies it back beside the live file and renames it over (`staged-store.ts`).
  - A case-data query copies all three case databases to temp before it reads (`case/backend.ts` `stage_copies`).
- **The Cowork VM runs only the hooks and a few skill scripts**: `show-me/scripts/highlight_pages.py` and `draft/scripts/extract_review_pages.py`.
- **Generated pages land in the synced tree.** The Milestone pages, view pages, Litigation Strategy and Loose Threads are written into the matter's synced `0. DRAFT` folder, and the practitioner opens them there.

## What was measured, and where

**PC.** No session can reach the PC: it runs Windows and offers no folders to cloud sessions. The PC numbers below are the ones recorded in the 2026-10-29 specs. From the next session on, the PC's own figures are in its call log (`%LOCALAPPDATA%\Coclerk\call-log`, read with `node source/lawyer/mcp/scripts/call-log-summary.mjs`). The table at the end lists what to read from it.

**Container.** A Linux container on local disk, used as a stand-in for the Cowork VM. The same data server runs on a synthetic matter: one proceeding, six Milestones, made-up names, 8 pages written at entry and 32 after the background job, 0.88 MB of HTML.

## 1. Is writing Probanda's pages and working files into the synced folder materially slower than a local folder?

**Answer: the page writes are not where the time goes.**

**Page writes are a small share of the call.** In the container, timing every write, rename and fsync of a warm `open_session` gives 4.8-6.6 ms out of a 239-655 ms call (1-3%). The rest of the page phase was database reads: before the 2026-10-31 change, 85% of the server's main-thread time was spent waiting on the drafting-data sidecar. A warm open made 166 queries, many of them the same list asked up to 18 times.

**On the PC, the synced-folder cost sits in the databases, not the pages.** The PC's `matter_pages` took 1764 ms for about 38 pages, about 46 ms a page. In the container, the same build took about 45 ms a page before the change, nearly all of it queries. Two costs touch the synced tree per query or per write:
- each sidecar query opens a fresh SQLite connection on the live `submission.sqlite` in the synced folder;
- each write or case-data call copies whole databases out of the synced folder and back.

Neither can be timed apart from the rest without the PC. The call log's `open: matter_pages` and `matter_data__query` durations will show them.

**Worth acting on?**
- **Pages: no.** They are a few percent of the call, and they must stay where the practitioner opens them.
- **Duplicated queries: yes, and done.** Within one call each distinct query now runs once: a warm open went from 166 to 56 queries and from 543 to 239 ms. The job's settle went from 240 to 99 queries and from 737 to 319 ms.
- **Moving the databases or `Drafting records\` out of the synced tree: no, not now.** It would be a data move: a minor version, with an old copy and a new copy disagreeing about where the data is. It would reverse ADR 0013, and its value is unmeasured. Revisit if the call log shows `open: matter_pages` still over 500 ms, or case-data reads over 300 ms, on the PC.

## 2. How long does a Python helper take to start, and how many starts does a typical workflow make?

**VM side (container stand-in).**

| What | Time |
|---|---|
| `python3 -c pass` | 17 ms |
| `import pdfplumber` + reportlab (`highlight_pages.py`) | about 230 ms |
| `import fitz` (PyMuPDF, `extract_review_pages.py`) | 766 ms |

Hooks per tool call, each a Python start, each timed with a sample payload:

| Tool call | Hook starts | Each (ms) | Slowest |
|---|---|---|---|
| a data-server read | 1 | 110 | TokenEconomizer `te-hook` |
| `open_session` | 2 | 43, 104 | `te-hook` |
| `Read` | 3 | 32, 32, 95 | `te-hook` |
| `Skill` | 3 | 54, 34, 91 | `te-hook` |
| `Bash` | 4 | 54, 32, 31, 92 | `te-hook` |

- Matching hooks run side by side, so a call waits for its slowest hook: about 100 ms, the TokenEconomizer hook on every call.
- A `/work` opening is four to five model turns and about 8-10 tool calls, or about 1 s of hook time. The opening takes about 40 s (opening-order spec), so hooks are about 2.5% of it.
- `highlight_pages.py` starts once per show-me, twice if the verbatim check fails.
- `extract_review_pages.py` starts once per counsel review.

**PC side (from the 2026-10-29 specs).**
- A host Python start plus one small read costs 243-275 ms: the three `parties_drift` phases.
- The data server's own comment puts a Windows Python start at 150-500 ms (`submission/backend.ts`, issue #517).
- The schema-version spawn cost 2-3.7 s before it was cached (#580).

| Session entry on the PC | Python starts | Snapshots |
|---|---|---|
| Before 18c311a | 3 (parties) | 3 |
| Now | 1 per proceeding, plus the sidecar once per server process | 1 on both the `matter_root` and `project_id` paths |

Before 18c311a the three parties starts were about 780 ms, 20% of the 3.8 s.

**Worth acting on?**
- **Host starts at entry: done.** 18c311a removed two, and 2026-10-31 removed the second snapshot on the `project_id` path. No other start is on the entry path.
- **VM hooks: no.** About 2.5% of an opening. The slowest is TokenEconomizer's, whose code the fork owns (CLAUDE.md, TokenEconomizer).
- **Skill scripts: no.** One start per show-me or counsel review.

## Not measured, assumed

- The PC's per-query SQLite open on a synced file, and its staging copies. They are inferred to be the PC's remaining environment cost; the call log will confirm or refute it.
- The Cowork VM's own Python start. Taken as the container's (17 ms); the VM may be slower.
- The fixture's page count and query count stand in for a typical matter. A real matter's Writings hold content, so its view pages are larger.

## To read from the call log once the PC has used this build

| Question | Field |
|---|---|
| Session entry under 2 s? | `drafting_forms__open_session` duration, median over a week |
| The page write after the read memo | phase `open: matter_pages` |
| Case-data read cost, synced staging included | `matter_data__query` duration |
| Model time against server time | gaps between calls (`call-log-summary.mjs`) |
