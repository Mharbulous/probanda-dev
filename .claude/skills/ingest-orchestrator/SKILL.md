---
name: ingest-orchestrator
description: Ingest several litigation documents into a matter's case data in one run, or any affidavit, with the extraction done by background extractors and the writes done by tools, so no extracted text and no SQL pass through this session. /ingest hands it every request covering two or more documents and any affidavit, and /matter-data's unattended ingest runs its loop. Use for "ingest these files", "ingest this affidavit", or when /ingest hands a run over.
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Ingest orchestrator (v1)

This skill runs on the main thread, because only the main thread can start agents and ask the practitioner. It decides nothing an extractor or a tool decides. Its whole job: open the run, route each file, start the extractors the run lists, pass each one-line reply to the tool that writes it, ask the questions the tools return, and relay their report lines. The design is `docs/Specs/2026-10-28_ingest-orchestrator-architecture-spec.md`. Version 1 uses today's passes and models. Read `references/routing.md` once per run, at Step 2.

**Never, in this session:** read an extractor's result, a page image, a PDF page or a text layer, except a page-1 routing read (Step 2) and Path B (Step 5); write SQL for an extracted document; compare two copies of a document yourself; choose a model, an effort or a batch. The tools and the dispatch list decide those. Never load `/matter-data`'s `operations/ingest-extract.md`, `shared/extraction-protocol.md` or an extractor's own file.

Every tool named below is lawyer's data server tool `matter_data__<name>`, under whichever prefix this host lists (`mcp__plugin_lawyer_data__` or `mcp__remote-devices__plugin_lawyer_data__`). Pass `matter_root` on every call.

## Input

- `matter_root`: the live host path of the matter folder (`/matter-data`'s `shared/conventions.md` §2.2).
- `files`: the paths to ingest, or a folder whose files are to be ingested, as `/ingest` handed them.
- `mode`: `attended`, or `unattended` when `/matter-data`'s `operations/ingest-unattended.md` hands over its files, a `run_id` and its routes. Unattended, skip Step 1 and Step 2's gate (that operation has done them), make Step 2's one `next` call with the routes it hands over, and ask nothing: each ask takes that operation's Substitutions (Step 6).

## Step 1. Open the run

Call `ingest_run` with `action: "begin"` and `mode: "attended"`. A refusal (`ok: false`) ends the skill: tell the practitioner its `say`, never its code. Keep the `run_id`; every later call carries it. Any call refused `lease_lost` means another session took this run over: stop at once and relay its `say`. Any call refused `plugin_changed` means Probanda was updated mid-run: call `ingest_run` `end`, relay its `say`, and stop. After a crash or a compaction, `ingest_run` `status` (no `run_id`) names the unfinished run, and `begin` with `resume` set to it takes the run over and lists the results still to write. Nothing depends on what this session remembers.

## Step 2. Route each file

Follow `references/routing.md` "The interim gate" for every file, in the order given. It ends with each file either set aside (with its reason for the final report), sent to Path B, or given a route. Then call `ingest_run` `next` with the routes, in one call. Its `routed` list gives each route's ref (`f1`, `f2`, ... in route order; a file routed again keeps its first ref). Every later call names a routed file by its ref, so this session keeps no per-file state beyond the files set aside and why.

## Step 3. Dispatch

Each `next` returns `dispatch` lines `{dispatch_id, agent, model, effort, ref, contract, stage?}`. For each line, start the named agent with that `model` and `effort`, as a background agent when the Agent tool offers one, and with the one-line prompt `DISPATCH <dispatch_id>` and nothing else. Where agents run only in the foreground, start the whole list in one message. Each agent is fresh, never resumed and never forked.

In a bridged session (the data tools are listed under `mcp__remote-devices__`), call `next` with `bridged: true`. Each dispatch line then carries `stage`, a list of host paths: stage them with `device_stage_files`, then call `ingest_run` `staged` with the `dispatch_id` and the returned session paths in the same order, before starting the agent. Where staging is impossible, start nothing for that line and pass `failed <ref> unreadable` as its reply.

## Step 4. Each reply

An agent's reply is one line. Take it exactly as given:

- `ok <ref> <result_id> <bytes>` for a line whose `contract` is not null: call `ingest_result` with `run_id`, `document` `{ref: <the file's ref, the line's ref up to its first colon>, store: "main"}`, the dispatch line's `contract`, and `result_ids` (that `result_id`). Calls run one at a time. When the dispatch line is no longer at hand, pass the reply to `status` as below instead: `next` then lists it under `write`.
- `ok ...` for a line whose `contract` is null (a boundary scan), or `failed <ref> <reason>`: call `ingest_run` `status` with `run_id` and `ack` set to the line. Never interpret the reason.
- No reply, more than one line, or anything else: pass `failed <ref> no_ack` to `status` the same way, `ref` from the dispatch line.

Then call `next` again. It lists new dispatches for the freed slots, `write` entries (acknowledged results still to write: call `ingest_result` with `document` `{ref: <the entry's ref up to its first colon>, store: "main"}` and the entry's `contract` and `result_ids`), and `close` entries (an item whose extraction failed twice: the same call with its `contract` and `result_ids: []`, which records its honest status). Between replies, wait. The run is done when `next` lists nothing and nothing is running.

### What `ingest_result` returns

- `report`: relay each line to the practitioner, as written. Relay nothing else from any tool.
- `ask`: keep each item for Step 6. When the answer comes, call `ingest_result` again for that document with the same `contract` and `result_ids` and `answers`: `participants` maps the asked name to the party the practitioner chose (`0` for a filing party that is none of them); `category`; `proceeding_id`; for a `privileged_informant` item, `informants` maps its `ref` (a locator) to the privileged document the practitioner names, its id found with `matter_data__query` on `privileged.privileged_sources` by title. An exhibit's `privilege` item is answered through `/matter-data`'s `operations/resolve-privilege.md` after the run: the exhibit is already held back as pending. `dropped` means more items wait: call again once these are answered.
- `outcome` `refused`: with `waiting`, do nothing; `next` lists it again when it can be written. With `path_b`, the document may be privileged: take it through Step 5 with its `privilege` ask as its question. With `set_aside`, add the file to the set-aside list for `/ingest` (an authority). Any other refusal is handled by `next` (a re-dispatch, a close, or nothing more, with its report line). Never show the code.
- `post`: Step 7's passes for the document.

## Step 5. Path B, last

After every other write of the run, read each internal document inline as `references/routing.md` "Path B" says, ask its privilege question with the run's other questions (Step 6), stage the object it describes with `stage_result`, and write it with `ingest_result` (`contract: "privileged"`, `store` `privileged` for a Yes and `main` otherwise, `answers.privilege`). Write no SQL. When the run's Path B documents total more than 40 pages, write and end the rest of the run first and offer the Path B set as a run of its own. Unattended, leave those over 40 pages out and report them for the next attended run.

## Step 6. Questions

Collect every `ask` item and Path B's privilege questions, and ask them together when no extractor slot is free and nothing waits to be written, or at the end of the run: one plain-text question per item, through `/show-me` when it is about a specific document. Never guess an answer. Unattended, ask nothing: a Path B document's privilege question takes Yes (`ingest-unattended.md` Substitution 1b); an exhibit held back pending and a privileged informant left out of the record stay as they are, and each goes in the file's `notes` for the attended run that settles it; any other ask stops that document with its question for the caller (Substitution 1k).

## Step 7. After-completion passes

Run each `post` entry for its source (`ref` is the source's id; for `other_copy` it is `<new id>:<other id>`), in this order, at the next Step 6 pause, one document at a time, through `/matter-data`:

1. `linkage`: `operations/proceedings-profile.md` §6.
2. `order_effects`: `operations/order-effects.md`, after linkage.
3. `other_copy`: `operations/supersede-draft.md` with `mode` `attended` and `pair` the two ids. A document that ends superseded takes no delivery check and no name check: its file has moved.
4. `delivery_check`: dispatch `lawyer:delivery-checker` for the letter as `references/routing.md` "Delivery check" says, and relay its report lines.
5. `name_check`: collect. At the end of the run, for each file run `/file-naming`'s test mode on its name (`operations/ingest-extract.md` "Name check" step 1). For a name that does not conform, read the written row's `date`, `title`, `description` and `category`, and its filing party's name, with one `matter_data__query` by its `source_id`, and build the proposal from them by proposal mode (step 2); a date or code that cannot be pinned down leaves the name alone. Make the offers as one list through `/show-me`. A rename goes through `/file-apply`; without it, rename nothing and say so.

Unattended, Step 7 runs no pass: the tools wrote the pending markers, the delivery check is skipped and reported as not checked, and the name check runs steps 1 and 2 only, its result going in the file's `notes`, renaming nothing (Substitution 1a). The tools already wrote the procedural history entries.

## Step 8. End

Call `ingest_run` `end`. Report once: each file with its outcome in one short line, the files set aside and why, and what still waits for an answer. Attended, then take each file set aside for `/ingest` through `/matter-data`'s single-document gate (`operations/ingest.md`), one at a time, now that this run has ended. Then `/ingest`'s step 8 contact check runs as usual.
