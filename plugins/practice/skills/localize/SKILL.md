---
name: localize
user-invocable: false
description: Internal writer of every skill's knowledge tree. Learns a venue's or audience's requirements for one or two document kinds from official published sources and records them in the calling skill's tree, or confirms, corrects, refreshes or retires a learned file. Invoked by name by a tree-owning skill (draft, publish, or the docket-clerk agent's caller), never by the user.
---

<!-- practice v0.3.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| 1. Invocation | A caller invokes the skill, to read its arguments |
| 2. Write targets | Before spawning, to decide repo, matter or refuse |
| 3. What a run writes | To know which files a run may write |
| 4. Spawning the helper | Spawning the helper |
| 5. Returns | The helper returns a status |
| 6. Operations | Running create, confirm, correct, refresh or retire |
| 7. Notice | After a created return, or on loading a learned file |
| 8. Live issue | Checking the live-matter rule for an overlay or repo run |

# localize

The only writer of every knowledge tree. A caller invokes it by name. This skill decides the write target, spawns the `localize-helper` agent, and relays what the helper returns. It never writes a tree itself, apart from the repo-session move in "Write targets".

Grammar, index files, resolve, overlay layout, merge, record contract and the confirmation sidecar are `shared/knowledge-tree.md` §3 to §8 and §10. This file does not restate them. The helper's tool sequences are its playbook, `references/playbook.md`.

## 1. Invocation

The caller passes:

- `operation`: `create` | `confirm` | `correct` | `refresh` | `retire`.
- The calling skill, country, jurisdiction, venue as named (or `_NoVenue`), document kind as named, and recipient.
- The live matter's file number, such as `1234.L####` (never its style of cause or a party's name), or in a repo session the explicit-instruction marker `repo-run`.
- Optional re-call arguments: `alias_of: "<code>"` (or `"_NoVenue"` for a borderline body), `new_venue: true` or `new_kind: true`, `allow_host: "<hostname>"` (only once the practitioner has said yes to a `host_not_allowed` refusal, which the helper records in `_hosts.json` through `knowledge__write` before it fetches), `saved_copy: {path, page_url, accessed}` (after a `fetch_failed`, the practitioner saves the page into `_practice\knowledge\_inbox\`, as a PDF where possible).
- `practitioner_layout: {title, folder_code, parts}`, on `create` only, from `/draft`'s conversion job (`Make <title> a Structured Writing`): the layout of a Writing the practitioner has sent, recorded as a new general type at the named venue instead of a layout learned from the venue's sources. `title` is the new type's title and its kind's name, `folder_code` its draft-folder code, and `parts` its parts in the shape `shared/declared-layout.md` section 3 gives: fixed wording as `literal` parts, and every client-specific span as a `slot:` or a projection. It carries no client text. The kind as named is the `title`.
- `saved_copy: {path, page_url, accessed}` on that `create` too, when the Writing copies a form the venue publishes: `path` is where the practitioner saved the form in the matter folder, and `page_url` the page the venue publishes it on. Before spawning, this skill copies that file into the firm's `_practice\knowledge\_inbox\` folder under its own name, leaving the matter's copy where it is, and hands the helper the copy's `_inbox` path. Where this host cannot write that folder, ask the practitioner to save a copy there, as after a `fetch_failed`, and spawn once it is there.

The caller never names the helper, the `knowledge__write` or `knowledge__retire` tools, or either root.

## 2. Write targets

Decide the target before spawning:

- **Repo session.** The working folder is the Coclerk checkout and the practitioner explicitly instructed this run. Pass `repo-run`. Before spawning a repo-run `create`, this session checks the checkout's skills tree for an existing file or kinds row for that venue and kind, and returns `exists` itself if one is there. The helper writes nothing: it returns each candidate's skills-tree-relative path and full text. This session writes each candidate to its own scratchpad, has the practitioner review it, and moves it into the checkout's skills tree, at the returned path, in the same step as the commit. The helper never commits and never writes the scratchpad. A `create` is validated inside the helper by matched fetches, because `sources__check` sees the installed plugin until the next repackage. Run `sources__check` on a promoted file only after that repackage.
- **Matter session.** Pass the live matter. The helper writes the firm overlay (`_practice\knowledge\`) and returns relative paths and status only.
- **Neither.** Refuse. Spawn nothing.

`confirm`, `correct` and `retire` run only in a matter session, and so does a `create` with `practitioner_layout`. Refuse them in a repo session without spawning.

Promotion of an overlay file into the shipped tree is an ordinary commit under `shared/knowledge-tree.md` §9. A promotion reaches install users only at the next packaged version, so it is a repackage trigger.

## 3. What a run writes

- The calling skill's tree only, for the one or two documents requested. A venue-level file only for material those documents cite, recording the run that created it.
- Every period set by a rule those documents cite goes to `docket-clerk`'s tree. Its path is returned nowhere and its writing is not signalled. In a repo run the helper writes nothing, so it produces no period file. That is not signalled either.
- A `/draft` run also writes the layout block (`shared/declared-layout.md`), each layout item carrying its `rule_ref`, and `venue.md` for a new venue. A venue part that matches no projection is declared as a `slot:`, never guessed. With `practitioner_layout` the parts are written as given, and only a `literal` part checked against a saved form carries a `rule_ref`.
- A `/publish` run writes `/publish`'s tree only.
- After every file of a run is written, the run adds the venues-index row for a new venue and its kinds-index row, so a run that fails earlier leaves nothing that resolves (`references/playbook.md` §3). A repo run also records near-miss aliases (`source: agent`, `ref` naming the rule) and any new jurisdiction-index entry, in the same candidate set. An overlay run never records an alias on its own. It records one only on a re-call carrying the practitioner's answer in `alias_of`.
- No `/assemble` or `/legal-research` file until that tree has a reader.

This supersedes `venue-knowledge`'s "Adding a venue" and its update procedure.

## 4. Spawning the helper

Spawn `localize-helper` by an explicit fresh-context Agent-tool Task spawn. Never run it inline or with `context: fork`. Hand it, as one JSON object, every argument of section 1 plus `run: "repo" | "matter"`. It reads its own playbook.

## 5. Returns

The helper returns, per requested document, one status:

- `created`, `exists`, `ambiguous` (with `candidates: [{code, name, rule}]` and no path), `refused` (with a reason), or `no_official_source`.
- `confirm`, `correct`, `refresh` and `retire` return `confirmed`, `corrected`, `refreshed` and `retired`, or `refused`. A `retire` also relays the runtime's `skipped` and `fetched_deleted`.
- `refused` reasons include `host_not_allowed` (`host`, `page_url`, `category`, optional `redirect_from`), `fetch_failed` (`host`, `page_url`, `detail` bounded to a status code, `empty_text` or an error class) and `stale_body`. `excerpt_mismatch` and `memo_expired` are retried once inside the run and surface only on a second failure, naming the `rule_ref`s or the URLs. On a `create` with `practitioner_layout`, `invalid_layout` names a part whose source is outside the vocabulary, and `excerpt_mismatch` names each `literal` part the saved form does not hold word for word. Neither is retried.
- At most one relative path per requested document, in the caller's tree only.
- **Matter run:** never file content.
- **Repo run:** the candidate's full text beside its path, any index rows to add, and the `saved_path` of any PDF a fetch saved. A saved PDF lands in the firm overlay's `_fetched\`, never in the scratchpad or git. The practitioner decides what happens to it.

Relay `ambiguous` candidates and every `refused` reason to the caller as returned. Never pick a candidate for the practitioner.

## 6. Operations

Each is a tool sequence the playbook spells out.

- `create`: resolve, fetch, then write (matter run) or return the candidate (repo run). With `practitioner_layout`: resolve, check each `literal` part against the saved form, then write, with no fetch.
- `confirm`: check the file's sources, then add a sidecar row. Called by the skill whose tree holds the file: `/draft` at mockup review, the docket-clerk agent's caller for periods.
- `correct`: read, fetch, then add a `corrected` sidecar row.
- `refresh`: check, fetch the changed source, then rewrite the source record and each changed item's passage. Never writes status. Runs only on the practitioner's yes, which the caller offers on a changed report, or, from `/draft`, when a research return reports an amendment in force to a rule or form an overlay file names. A shipped file seen from a matter session is fixed by a repo-session refresh, then repackage and reinstall.
- `retire`: from a matter session, one overlay file, or the `shadowed_only: true` sweep over overlay files the shipped tree now holds identically. Sidecars move with their files.

## 7. Notice

The calling skill shows this notice in its first message after a `created` return, then once per session on each load of a learned file. It fills it from header fields only:

```text
Note: the {venue} requirements for {document kind} used here were learned by an agent on {accessed} from the venue's published sources and have not been reviewed by a practitioner; unverified items are tagged on the mockup.
```

The notice stops when every item reads confirmed or corrected in the firm's sidecar, or the file is vetted. Promotion alone does not stop it, because a promoted file ships unconfirmed.

## 8. Live issue

An overlay run needs the calling skill's live matter and records it. A repo run is unbilled firm infrastructure on explicit instruction. This deliberately takes `venue-knowledge`'s rule over `shared/live-issue-test.md` §1's "filing mechanics are not legal work". Recording where law is published is not legal research. A run never states law and never assesses what a rule means.
