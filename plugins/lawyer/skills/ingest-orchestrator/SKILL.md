---
name: ingest-orchestrator
description: Ingest several litigation documents into a matter's case data in one run, or any affidavit, with the extraction done by background extractors and the writes done by tools, so no extracted text and no SQL pass through this session. /ingest hands it every request covering two or more documents and any affidavit, and /matter-data's unattended ingest runs its loop. Use for "ingest these files", "ingest this affidavit", or when /ingest hands a run over.
---

<!-- lawyer v0.15.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Ingest orchestrator (v1)

This skill runs on the main thread, because only the main thread can start agents and ask the practitioner. It decides nothing an extractor or a tool decides. Its whole job: open the run, route each file, start the extractors the run lists, pass each one-line reply to the tool that writes it, ask the questions the tools return, and relay their report lines. The design is `docs/Specs/2026-10-28_ingest-orchestrator-architecture-spec.md`. Version 1 uses today's passes and models. Read `references/routing.md` once per run, at Step 2.

**Never, in this session:** read an extractor's result, a page image, a PDF page or a text layer, except a page-1 routing read (Step 2) and Path B (Step 5); write SQL for an extracted document; compare two copies of a document yourself; choose a model, an effort or a batch. The tools and the dispatch list decide those. Never load `../matter-data/operations/ingest-extract.md`, `../matter-data/shared/extraction-protocol.md` or an extractor's own file.

Every tool named below is lawyer's data server tool `matter_data__<name>`, under whichever prefix this host lists (`mcp__plugin_lawyer_data__` or `mcp__remote-devices__plugin_lawyer_data__`). Pass `matter_root` on every call.

## Input

- `matter_root`: the live host path of the matter folder (`../matter-data/shared/conventions.md` §2.2).
- `files`: the paths to ingest, or a folder whose files are to be ingested, as `/ingest` handed them.
- `mode`: `attended`, or `unattended` when `../matter-data/operations/ingest-unattended.md` hands over its files, a `run_id` and its routes. Unattended, skip Step 1 and Step 2's gate (that operation has done them), make Step 2's one `next` call with the routes it hands over, and ask nothing: each ask takes that operation's Substitutions (Step 6).

## Step 1. Open the run

Call `ingest_run` with `action: "begin"`, `mode: "attended"` and `orchestrator: true`, and relay any `report` lines it returns. A refusal (`ok: false`) ends the skill: tell the practitioner its `say`, never its code. The exceptions are `run_active` and `run_unfinished`, which name an unfinished run by its `run_id`: tell the practitioner its `say` and offer to resume that run here, saying, for `run_active`, that a session still working on it would stop. On yes, call `begin` with `resume` set to that `run_id` and `orchestrator: true`, and go on as below with what it lists. On no, end the skill after `run_active`; after `run_unfinished`, start afresh: `begin` with that `resume`, then `end` with the `run_id` it returns, then this step's `begin` again. Keep the `run_id`; every later call carries it. Any call refused `lease_lost` means another session took this run over: stop at once and relay its `say`. Any call refused `plugin_changed` means Probanda was updated mid-run: relay its `say` and stop, without calling `end`, so the run stays open to resume after the restart. After a restart, a crash or a compaction, `ingest_run` `status` (no `run_id`) names the unfinished run, and `begin` with `resume` set to it and `orchestrator: true` takes the run over and lists the results still to write (`next`), the writes waiting for an answer (`asked`) and the documents still to read for Path B (`path_b`). Then continue at Step 2: a file routed again keeps its ref. Nothing depends on what this session remembers.

## Step 2. Route each file

Follow `references/routing.md` "The interim gate" for every file, in the order given. It ends with each file either set aside (with its reason for the final report) or given a route; a file sent to Path B takes the route `kind: "path_b"`, so the run's journal holds it. Then call `ingest_run` `next` with the routes, in one call. Its `routed` list gives each route's ref (`f1`, `f2`, ... in route order; a file routed again, or a second file with the same bytes, keeps the first ref), and its `report` lines, relayed as written, name each file read once as a copy of another. Every later call names a routed file by its ref, so this session keeps no per-file state beyond the files set aside and why.

## Step 3. Dispatch

Each `next` returns `dispatch` lines `{dispatch_id, agent, model, effort, ref, contract, stage?}`. For each line, start the named agent with that `model` and `effort`, as a background agent when the Agent tool offers one, and with the one-line prompt `DISPATCH <dispatch_id>` and nothing else. Where agents run only in the foreground, start the whole list in one message. Each agent is fresh, never resumed and never forked.

In a bridged session (the data tools are listed under `mcp__remote-devices__`), call `next` with `bridged: true`. Each dispatch line then carries `stage`, a list of host paths: stage them with `device_stage_files`, then call `ingest_run` `staged` with the `dispatch_id` and the returned session paths in the same order, before starting the agent. Where staging is impossible, start nothing for that line and pass `failed <ref> unreadable` as its reply.

## Step 4. Each reply

An agent's reply is one line. Take it exactly as given:

- `ok <ref> <result_id> <bytes>` for a line whose `contract` is not null: call `ingest_result` with `run_id`, `document` `{ref: <the dispatch line's ref, as given>, store: "main"}`, the dispatch line's `contract`, and `result_ids` (that `result_id` alone). Calls run one at a time. When the dispatch line is no longer at hand, pass the reply to `status` as below instead: `next` then lists it under `write`.
- `ok ...` for a line whose `contract` is null (a boundary scan), or `failed <ref> <reason>`: call `ingest_run` `status` with `run_id` and `ack` set to the line. Never interpret the reason. If `status` refuses the ack, pass `failed <the dispatch line's ref> no_ack` to it instead.
- No reply, more than one line, or anything else: pass `failed <ref> no_ack` to `status` the same way, `ref` from the dispatch line.

Then call `next` again. It lists new dispatches for the freed slots, `write` entries (acknowledged results still to write: call `ingest_result` with `document` `{ref: <the entry's ref>, store: "main"}` and the entry's `contract` and `result_ids`), `close` entries (an item whose extraction failed twice: the same call with its `contract` and `result_ids: []`, which records its honest status), and `asked` entries (writes waiting for the practitioner's answer: never call them again until Step 6 has that answer; after a compaction, one call with no `answers` returns the question again). Between replies, wait. The run's extraction is done when `next` lists no dispatch, no `write` and no `close` and `running` is 0: whatever `asked` still lists waits only for an answer (Step 6), and unattended it stays as it is. What `path_b` lists is Step 5's.

### What `ingest_result` returns

- `report`: relay each line to the practitioner, as written. Relay nothing else from any tool.
- `ask`: keep each item for Step 6. When the answer comes, call `ingest_result` again for that document with the same `contract` and `result_ids` and `answers`: `participants` maps the asked name to the party the practitioner chose (`0` for a filing party that is none of them); `category`; `proceeding_id`; for a `privileged_informant` item, `informants` maps its `ref` (a locator) to the privileged document the practitioner names, its id found with `matter_data__query` on `privileged.privileged_sources` by title, or to `0` when the information came from no document on file (a call or a meeting): the name then stays out of the record. An id that names no privileged document is asked again. An exhibit's `privilege` item is answered through `../matter-data/operations/resolve-privilege.md` after the run: the exhibit is already held back as pending. `dropped` means more items or report lines wait: call again once these are answered, or at once when every item shown is an exhibit's `privilege` item, which needs no answer here. When the reply shows no `ask` item and the call had two or more `result_ids`, instead call once for each of them alone, with the same `document` and `contract`, and relay each reply's `report`. A call of one result that still shows `dropped` is not repeated: its `report` is all that can be shown.
- `outcome` `refused`: with `waiting`, do nothing; `next` lists it again when it can be written. With `path_b`, the document may be privileged: take it through Step 5 with its `privilege` ask as its question. With `set_aside` (an authority), `race` or `store_change`, add the file to the set-aside list for `/ingest`, whose gate looks the file up again. Any other refusal is handled by `next` (a re-dispatch, a close, or nothing more, with its report line). Never show the code.
- `post`: Step 7's passes for the document.

## Step 5. Path B, last

After every other write of the run, take each entry the last `next` lists under `path_b` (a file routed `path_b`, or a routed file refused `path_b`), each `{ref, file_path}` with `file_path` relative to `matter_root`. The run keeps no rendering for it, so render a `.docx`, `.eml` or `.msg` again as `references/routing.md` check 5 says before reading it. Read it inline as `references/routing.md` "Path B" says, ask its privilege question with the run's other questions (Step 6), stage the object it describes with `stage_result`, and write it with `ingest_result` (`contract: "privileged"`, `document` `{ref: <the entry's ref>, store}` with `store` `privileged` for a Yes and `main` otherwise, `answers.privilege`). The entry leaves the list once that write lands. Write no SQL. A definite outcome removes the staged object, so a repeat after one stages it again; after an error, repeat the same call. When the run's Path B documents total more than 40 pages, write and end the rest of the run first and offer the Path B set as a run of its own. Unattended, leave those over 40 pages out and report them for the next attended run.

## Step 6. Questions

Collect every `ask` item and Path B's privilege questions, and ask them together when no extractor slot is free and nothing waits to be written, or at the end of the run: one plain-text question per item, through `/show-me` when it is about a specific document. Never guess an answer. Unattended, ask nothing: a Path B document's privilege question takes Yes (`ingest-unattended.md` Substitution 1b); an exhibit held back pending and a privileged informant left out of the record stay as they are, and each goes in the file's `notes` for the attended run that settles it; any other ask stops that document with its question for the caller (Substitution 1k).

## Step 7. After-completion passes

Run each `post` entry for its source (`ref` is the source's id; for `other_copy` it is `<new id>:<other id>`), in this order, at the next Step 6 pause, one document at a time, through `/matter-data`:

1. `linkage`: `../matter-data/operations/proceedings-profile.md` §6.
2. `order_effects`: `../matter-data/operations/order-effects.md`, after linkage.
3. `other_copy`: `../matter-data/operations/supersede-draft.md` with `mode` `attended` and `pair` the two ids. A document that ends superseded takes no delivery check and no name check: its file has moved.
4. `delivery_check`: dispatch `lawyer:delivery-checker` for the letter as `references/routing.md` "Delivery check" says, and relay its report lines.
5. `name_check`: collect. At the end of the run, for each file run `/file-naming`'s test mode on its name (`../matter-data/operations/ingest-extract.md` "Name check" step 1). For a name that does not conform, read the written row's `date`, `title`, `description` and `category`, and its filing party's name, with one `matter_data__query` by its `source_id`, and build the proposal from them by proposal mode (step 2); a date or code that cannot be pinned down leaves the name alone. Make the offers as one list through `/show-me`. A rename goes through `/file-apply`; without it, rename nothing and say so.

Unattended, Step 7 runs no pass: the tools wrote the pending markers, the delivery check is skipped and reported as not checked, and the name check runs steps 1 and 2 only, its result going in the file's `notes`, renaming nothing (Substitution 1a). The tools already wrote the procedural history entries.

## Step 8. End

Call `ingest_run` `end`. Report once: each file with its outcome in one short line, the files set aside and why, and what still waits for an answer. Attended, then take each file set aside for `/ingest` through `/matter-data`'s single-document gate (`../matter-data/operations/ingest.md`), one at a time, now that this run has ended. Then `/ingest`'s step 8 contact check runs as usual.
