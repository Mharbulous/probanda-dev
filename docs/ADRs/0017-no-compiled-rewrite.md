---
status: accepted
date: 2026-10-31
---

# No part of Probanda is rewritten in Rust

The question was whether any part of Probanda is CPU-heavy enough that a compiled rewrite, in Rust or any other compiled language, would shorten session time. The timing data says no. Session time goes to model turns, Python process starts and SQLite round trips, not to computation a faster language would speed up. No Rust code is written.

## The data

**Sources.**
- The PC's own timings, recorded in `docs/Specs/2026-10-29_open-session-server-time-spec.md` and `2026-10-29_milestone-card-first-opening-order-spec.md`.
- Container measurements on a synthetic matter, in that spec's §12 and in `docs/Research/2026-10-31_environment-costs.md`.
- A CPU profile of the data server, taken in the container after the 2026-10-31 change, over ten openings and the background jobs after them.

**Where an opening's time goes.**
- **The whole opening.** On the PC a `/work` opening took about 40 s to the Milestone card. Session entry's server time was 3.8 s of that, and the rest was four or five model turns.
- **Server time inside session entry** (container profile after the change):

| Share | What |
|---|---|
| 73% | waiting on the drafting-data sidecar: Python's SQLite, a fresh connection per query, and the JSON round trip |
| 15% | waiting on a Python process start (`spawnSync`) |
| 7% | JavaScript CPU: building the pages, ranking the filings, rendering |
| 5% | file system |

- **The background job's settle** writes every page once: 91% waiting on the sidecar, 4% JavaScript CPU, 5% file system.

| Candidate | Where it runs | Bound by | Measured share | Compiled rewrite? |
|---|---|---|---|---|
| Page HTML building, ranking, rendering (`matter-pages-build.ts` and friends) | data server, Node | CPU | 7% of session-entry server time, so under 1% of an opening: about 0.25 s of 3.8 s on the PC, scaled from the container share | No. Even a tenfold speed-up saves about 0.2 s of a 40 s opening. |
| Drafting-data reads (sidecar) | host Python + SQLite | Process boundary and file opens | 73% of server time | No. SQLite is already C. The cost is the number of round trips and a connection per query. Removing duplicate queries (2026-10-31) cut warm entry from 166 queries to 56 and from 543 to 239 ms. If it is needed again, the next step is fewer queries or an in-process SQLite (`node:sqlite`, Node 22.5 and later), not a new language. |
| Case-data, practice and other per-call Python helpers | host Python | Process start (150-500 ms on Windows) and database staging copies | Before 18c311a, three parties starts were about 20% of 3.8 s; now one per proceeding | No. The cost is starting a process and copying files, which a Rust helper would also do. A Rust binary starts faster than Python (single-digit ms), but most of these helpers run `/matter-data`'s own Python and SQL, which would all have to be ported. |
| Folder hashing (ingest coverage, housekeeping candidates, relocate) | host Python `hashlib` | Disk and OneDrive reads | Not on the entry path since 18c311a. The bridge's 60 s limit applies. | No. `hashlib` is C. The time is reading the files, often hydrating them from the cloud. |
| PDF rasterising and comparison | data server, PDFium as WebAssembly | CPU | Not timed. Not on the entry path. | No. Already compiled code. |
| Publish, assemble and highlight (PyMuPDF, pdfplumber, reportlab) | host Python, or the VM for `highlight_pages.py` | Library import, then C code | Import 0.2-0.8 s, once per publish, show-me or counsel review | No. The heavy parts are already compiled libraries. |
| Quick-edit diffs | data server, Node | CPU on short texts | Not timed. No complaint or phase points at it. | No |
| Plugin hooks | Cowork VM, Python | Process start | About 100 ms per tool call (they run side by side), about 2.5% of an opening | No. The slowest is TokenEconomizer's, whose code the fork owns. |

## What a compiled part would cost

- **Two targets.** Every compiled part would need a Windows x64 binary for the data server and a Linux binary for the Cowork VM, maybe on two architectures, with a build for each in CI.
- **A locked-down PC.** The practitioner has no admin rights. An unsigned executable can be stopped by SmartScreen or an application-control policy, and tech support will not add exceptions. Signing needs a code-signing certificate and a signing step in every release.
- **Shipping.** Plugins are synced from claude.ai with no install step. MCP servers ship as self-contained bundles, scripts must be executable, and a plugin may not have a top-level `bin/` (CLAUDE.md, Cowork constraints). Native files would ride in the bundle, need their executable bit kept through Windows checkouts, and would make every bundle platform-specific.
- **A second language to maintain.** The skills' Python and SQL are the single source the data server pastes in or spawns. A port would split that source in two.

Against a saving of at most about 0.25 s per opening, none of this is justified.

## When to look again

Reopen this decision only when the call log (ADR 0016) shows a phase that is CPU-bound in its own code and above 20% of a tool call's time over a working week, and only after the cheaper fixes for that phase (fewer queries, fewer process starts, caching inside the call) are spent. A Python helper's start time alone does not qualify: moving that helper into the Node server removes the start without a new language.

## Considered options

- **Rewrite the page build in Rust (WASM inside the Node bundle).** WASM ships cross-platform with no signing, the way PDFium already does. Rejected: the page build is 7% of server time.
- **A Rust SQLite sidecar in place of the Python one.** Rejected: one binary per platform plus signing, for a saving that removing duplicate queries already took, and `node:sqlite` would remove the process boundary with no binary at all.
- **Nothing compiled, streamline instead.** Chosen. The 2026-10-29 and 2026-10-31 changes removed duplicate process starts, snapshots and queries.
