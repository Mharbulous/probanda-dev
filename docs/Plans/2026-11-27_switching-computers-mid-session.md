# Switching computers mid-session in Cowork

Status 2026-11-27: design note. Nothing here is built, and nothing is to be built until the practitioner has read it. It builds on `2026-11-11_bill-multi-device.md` (approved, unbuilt) and `../Specs/2026-11-17_drafting-records-sync-safety-spec.md` (built), and does not restate them.

## Context

The practitioner works on two Windows PCs. Matter folders sync between them through SharePoint by Microsoft's file sync app. A Cowork session is linked to one PC. Opened from the other, the app shows "This session is linked to <computer>" with "Not now" and "Use this computer instead". Until that button is clicked, every tool that runs on the PC fails with "The device this session is bound to is not connected to the bridge", and the session's deferred tool list drops, then returns on reconnect.

On 2026-11-27 a `/researcher:legal-research` run passed its preflight, the practitioner approved the wording of two research jobs, and the next call on the PC failed. The session could only say the computer was disconnected.

The popup and the session-to-computer link belong to the Claude app and are out of scope. This note covers what the plugins can do around them. Paths below are under `source/` unless they start with `docs/`; `src/` means `source/lawyer/mcp/src/`.

## Facts that shape the design

- **No hook can detect the computer.** In Cowork every hook runs in the sandbox, not on the PC (`lawyer/hooks/inject-preferences.py:11-12`). Detection is a call on the PC that fails or succeeds.
- **Nothing handles this today.** No skill, agent, hook or server mentions the bridge error, the button or a computer name. No store carries a device identity. The one per-machine stamp is the drafting records' random writer id (`src/submission/write-record.ts`).
- **The session keeps its chat.** The session runs in the cloud. After "Use this computer instead" the same session still holds the approved wording, its job token and its claim number. The approvals of 2026-11-27 were not destroyed by the switch. They were stranded because no rule told the session to wait and then retry the same call.
- **The first call cannot close the gap.** The PC was reachable at preflight and dropped afterwards. Making the first call on the PC before the first question narrows the window. The continue path is the main fix.

## Findings, ranked by harm

1. **Silent loss of practice records.** `practice.db`, `time_pipeline.db` and `loose_threads.db` are opened and written in place in the synced folder (`src/kv/backend.ts:33-40`). They have no conflict-copy check and no lost-write check, and every write creates a `-journal` file inside the synced tree. `timecamping.db` has staged writes but no conflict-copy check. `2026-11-11_bill-multi-device.md` already records rows lost between the PCs. Matter-data refuses only the `name-<computer>` copy pattern (`src/case/locate.ts:84-85`). The drafting records also catch `name (1)` and `name - Copy` (`src/submission/backend.ts:82`).
2. **A database that has not finished syncing.** No store can tell that the other PC's last writes have not arrived. The drafting lost-write check sees only this PC's own missing writes. A write on a stale copy becomes a conflict copy, which drafting and matter-data refuse afterwards, or a silent overwrite (finding 1). No database open checks for a cloud-only placeholder, though `skills/matter-data/references/scripts/resolve_authority_source.py:62-63` already holds the file-attribute test.
3. **No message and no continue path.** This is the incident. `skills/legal-research/SKILL.md:63-65` says a failed preflight call is "never a stop", so a dead PC at Step 0 would be reported as one capped row and the skill would go on to ask for approval. `skills/shared/present-files.md:7` says never to suggest reconnecting, which is right for its own failure and wrong for this one.
4. **A Westlaw deep-research run cannot be picked up on the other PC.** It runs 10 to 58 minutes as a background agent that drives one PC's Chrome and Downloads folder. The report's identity in Westlaw's History is recorded nowhere. "Message the same agent to resume" works only while that PC is reachable.
5. **Work held on one PC only.** Ingest runs and staged extractor results (device-local on purpose, `src/case/ingest-run.ts:2-4`), quick-edit preview tokens, held suggestions and their cards, a fetched page not yet filed (server memory), unfiled files in Downloads, and every served page link (signed with a per-device secret).
6. **Stored paths that differ per PC.** See the path table below.
7. **Job locks.** Low harm. Locks are rows in the synced `submission.sqlite`. They lapse after 60 idle minutes, a waiting step extends that, and a take-over already needs the practitioner's yes. The same session keeps its token across a switch. The holder shows as 8 characters of a token, with no computer name.
8. **Per-device set-up.** Expected, and needs only a message after a switch. See the next table.

## Per-device and synced state

| Per device | Synced |
|---|---|
| The device `probanda.json` in `%APPDATA%\Probanda\` (`case_data_root`, `person`, `signature`, page port) | Every database: matter-data's three stores, `submission.sqlite`, `loose_threads.db`, `practice.db`, `time_pipeline.db`, `timecamping.db` |
| Every stored key: mail, TimeCamp and CanLII (DPAPI files under `%LOCALAPPDATA%`), Probanda's key (Windows Credential Manager) | The matter pointer `probanda.json` in each matter folder |
| Chrome and Westlaw sign-in, the Downloads folder | Firm profile, letterhead, signatures, folder maps, preferences, quirks, knowledge |
| Write locks, the drafting write record, matter-data migration backups | Housekeeping runs, `case-download-manifest.json`, render manifests, the research scratchpad |
| Ingest runs, staged extractor results, preview tokens | Job locks, steps, sources to get, review-date claims |
| Suggestion store and cards, page links and the page secret | |

## Stored paths

Most paths in the databases are relative to the matter root and survive a different local root: every `file_path` column written since 2026-09-24, board attachments, housekeeping rows, render manifests and folder-map entries. These do not:

| Path | Where | Effect on the other PC |
|---|---|---|
| Pointer `matter_root` | `src/case/backend.ts:124-135` | Readers ignore it, but every matter-data query and write rewrites the synced pointer with this PC's path, so the two PCs keep rewriting one file |
| Pointer `case_data_dir` of a matter not yet relocated | `src/case/backend.ts:53-62` | Absolute. Matter-data's resolver falls back and heals it. The drafting resolver refuses (`src/files/matter-root.ts:116-123`) |
| Manifest `path` from `file_fetched` | `src/files/research-filing.ts` | Absolute. Code reads only `filename`, so nothing breaks unless a model reads `path` |
| Housekeeping `proposal.json` `matter_root` | `src/housekeeping/proposal.ts` | A run proposed on one PC is invalid on the other. It fails closed |
| `file_path` rows from before 2026-09-24, an absolute precedents folder | databases, folder map | Stale on the other PC |

## Cheap and safe now

Text and small guards. Each is a patch.

| # | Change | Files |
|---|---|---|
| N1 | One shared doctrine file for the unreachable computer. It holds the error text that triggers it, the plain words to say, the "Use this computer instead" button, the asleep, offline and app-closed causes, and the continue path: one cheap read on the PC, reload the tool list, then retry the same call with the inputs already approved. Never re-ask an approval, never retry in a loop, never say something was saved before the retry succeeds. After a switch, say what is per device (keys, sign-ins, Downloads). A subagent returns `status: blocked (device-unreachable)`. | New `skills/shared/device-unreachable.md`. One sentence in `lawyer/hooks/hidden-skills-note.py`, the hook that speaks in every session, so no skill needs its own pointer. Pointers where a run is long or holds approvals: `skills/legal-research/SKILL.md` (Step 0 carve-out), `skills/shared/research-priority.md`, `skills/work/references/procedure.md`, `skills/shared/present-files.md`, `researcher/agents/law-getter.md`, `researcher/agents/citation-checker.md` |
| N2 | A rule in the same file: a skill's first read on the PC comes before its first question, and the write follows an approval as the very next call. | The same file. Known cases that ask first: the Westlaw-query route of `legal-research` and Step 0 of `route-accounting` |
| N3 | Conflict-copy refusal for the kv stores and `timecamping.db`, reusing `syncSplitCopies`, and the wider name pattern for matter-data. Writes refuse and name the copies, as matter-data does today. | `src/kv/backend.ts`, `src/timecamping/backend.ts`, `src/case/locate.ts`. Tests beside `lawyer/mcp/test/case-sync-split.db.test.mjs` |
| N4 | Refuse to open a database that is a cloud-only placeholder, with a plain "not downloaded yet" message. | The same backends and `src/staged-store.ts` |
| N5 | Do not rewrite the matter pointer when only `matter_root` differs. Write the manifest `path` relative to the matter root. | `src/case/backend.ts`, `src/files/research-filing.ts` |
| N6 | The law-getter records a submitted report's Westlaw identity in the manifest as soon as it submits. A resume line reads it back on either PC and downloads the finished report from History. | `skills/shared/law-getter/westlaw-deep-research.md`, `researcher/agents/law-getter.md` |

The practitioner's own step, with no admin rights: set "Always keep on this device" on the `0. CASE DATA` folder on both PCs.

## Needs the practitioner's decision

- **D1. Device identity.** Build decision 1 of `2026-11-11_bill-multi-device.md` on its own: `device_id` and `device_name` in each PC's `probanda.json`, returned by `config_status` and the research preflight. It lets a session say "this is a different computer than before", names a job's holder, and makes D3 and D4 possible. Recommended: yes.
- **D2. The kv stores' structure.** Either one file per device merged on read (the 2026-11-11 design, extended to `practice.db` and `loose_threads.db`), or staged writes with the drafting lost-write record. Both are minor bumps. Recommended: the 2026-11-11 design for `time_pipeline`, staged writes for the other two.
- **D3. A sync-settled guard.** Each device keeps its write count in a small synced file of its own, which no other device writes. A session compares that count with the count inside the database and knows when the other PC's writes have not arrived. Refuse or warn is the decision. Whether the file sync exposes its own pending state without admin rights is not known and needs a spike first.
- **D4. Device-only work (finding 5).** Move ingest runs and staged results into the synced folder, or keep them local and say "this was started on <computer>, finish it there". Recommended: keep them local and say so, which needs D1.
- **D5. Matters not yet relocated.** Relocate each with the existing `matter_data__relocate`, or give the drafting resolver matter-data's fallback. Recommended: relocate.
- **D6. Housekeeping proposals across PCs.** Low harm, and it fails closed. Recommended: leave it.

## Not verified

- What `get_device_info` returns, a computer name or not, and how it fails while the bridge is down. This needs one live check in Cowork. Behaviour in Claude Code is not evidence.
- Each skill's full step order. Only `legal-research` and a sample were walked, so N2's list of skills that ask first may be short.
- Whether any existing file in a store's folder matches the wider conflict-copy pattern by accident.
- Whether `research_filing__append_manifest` accepts a new record kind for N6.
- Whether either PC's Downloads folder is redirected into the synced tree.
