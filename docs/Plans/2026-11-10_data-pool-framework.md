# Data pools: the seams for Probanda's plugins and stores

Status: planning. Agreed with the developer on 2026-11-09 and 2026-11-10, revised after an independent review. Nothing here is built.

The map of every skill by pool is `docs/diagrams/Planned/Data-Pool-Map.html`. The plugin layout that followed from it, built on 2026-11-10, is `docs/diagrams/Built/Progressive-Context-Tree.html`.

## Why pools

A law firm keeps some kinds of data apart: the law apart from a client's facts, one client apart from another, privileged advice apart from what the other side sees. Each such kind is a **data pool**. A pool is a database (most of Probanda's are SQLite), folders of files, or both. Evidence, for example, is a matter's records of who produced what and the produced documents themselves. Some pools have no files: tasks, contacts, trust balances and time entries exist only as records.

Plugins have so far been drawn from skills that seemed related. Pools give a test: which pool does a skill write?

## The pools

Each item below is a pool. A heading is only a scope (whose data it is), not a pool.

**Matter data**: one set per matter, never mixed between matters.

| Pool | Holds |
|---|---|
| Privileged communications | Client instructions, advice, what was said on calls |
| Correspondence with others | Letters to and from opposing counsel and third parties |
| Evidence | Produced documents, who produced or listed them, affidavits, transcripts, facts extracted |
| Court record | Pleadings, filings and orders, as documents |
| Work product | The lawyer's own analysis and strategy |
| Drafts | Unsigned drafts and the Job Board. Not called "work in progress", which means unbilled time |
| Events | Past events, including procedural history, and deadlines, each deadline linked to the event that answered it |

**Practice data**: across a firm's or a lawyer's matters.

| Pool | Holds |
|---|---|
| Practice records | Contacts, matters, roles, tasks, file status, conflict information |
| Billing | Time entries, invoices, accounts receivable |
| Trust accounting | Each matter's current retainer and trust balances. The regulated ledger, with its sub-ledger per client, is kept in the firm's trust accounting system, not in Probanda |
| Institutional knowledge | What is true for this firm only: its own forms and precedents in house style, the document types it declares and its overrides of shipped values, practice quirks, time-entry description patterns, each person's preferences. Client Information even when it names no client, so it stays on the User's Machine |

**The lawyer's own**: not yet sorted to a matter.

| Pool | Holds |
|---|---|
| Timekeeping records | Screen captures, call logs, TimeCamp data: evidence of how the day was spent |

**No client data**: shared across every matter.

| Pool | Holds |
|---|---|
| The law | Case law, statutes, court rules (including the firm's record of rule changes, the rule overlay), the court's sitting calendar, commentary, research memos |
| Know-how | What is true for any firm in the same venue: generic precedents, venue requirements learned from published sources, the lists of venues and document kinds, approved source websites. Transferable, so it may one day be shared |

Outside the client pools: Probanda's own records (the Suggestion Box and the troubleshooting store, which hold Account Information under the Commandments).

## Rules

1. **A pool is defined by what data is for, not where it comes from.** The calendar, call logs and the mailbox are sources. A skill that reads one sorts each item into its pool: a court hearing goes to events, a client meeting to events and timekeeping records, a personal appointment to neither.
2. **A skill belongs to the plugin that owns the pool it writes.** A skill that writes nothing belongs with the pool it mainly reads. Reading across pools is normal legal work and does not decide membership.
3. **A plugin owns one or more pools.** Billing and trust accounting share a scope but can sit in different plugins.
4. **A deadline that passes stays on record**, linked to the event that answered it, so it shows whether it was met.
5. **Pools are kept apart by stores, not by plugins.** The target is one store per pool with one gatekeeper skill. The plugin split only decides what is installed. A pool's scope and its store's scope can differ: events are per matter, while anchors and deadlines sit today in the firm-wide practice store.
6. **Files are the originals; records are derived.** Where a pool has both, a record points back to its file, and when they disagree the file wins. The file-manager skills work on every pool's folders, so they cut across pools by design.

## How Probanda's stores differ from the pools today

- The `matter-data` store is three files per matter. `main.sqlite` holds parties, facts, evidence links, relief and issues. `law.sqlite` holds the matter's stored authorities, concepts and criteria. `privileged.sqlite` holds client instructions and privileged sources. So the law and privileged material already sit in their own files, while evidence and the court record share `main.sqlite`. Procedural history is a file, `ProceduralHistory.md`, in the matter's folder.
- The `practice-data` store is one file, `practice.db`, holding practice records, billing, trust accounting, events (anchors and deadlines), court calendar days and the firm's rule overlay.
- The `matter-data` skill writes client instructions to `privileged.sqlite`. No skill writes correspondence with others: it lives only in the mailbox, which skills read as a source.
- Deadlines are written by the `docket-clerk` agent, not by a skill.

A new store is allowed if it complies with the Commandments. The Exception's list of legacy stores (matter-data, drafting-data, timetracking-data) never grows, so a new store gets no exemption.

## What the pools say about the plugins

Today's plugins already mostly follow the pools: the law is all researcher, timekeeping records all timekeeper, practice records, trust accounting and events all lawyer, drafts all litigator but `proof-read`, and the folders all file-manager but `safe-file-deletion` and `find-document`. Billing is split between lawyer and timekeeper, which the billing plan fixes. Evidence, know-how, the court record and work product are split between lawyer and litigator.

Pools do not remove most `source/layering.json` exceptions, because exceptions come from reading across pools, not writing. A skill may use any plugin its own plugin requires, so the cost falls when each pool's plugin sits above the pools its skills read. That is why merging billing and timekeeping clears rulings. One plugin per pool would raise the cost: many small plugins, each needing exceptions to reach its neighbours. Plugins should stay groups of pools at one scope, with the pool lines settling skills on a border.

## Decisions taken on this basis

- **A `billing` plugin replaces timekeeper**, taking timekeeper's skills, server and hooks plus `bill-client`, `issue-invoice`, `invoice-reviewing`, `wip-tracker`, `ar-follow-up` and `invoice-tracking`. `retainer-tracking` stays in lawyer, because `executive-assistant` and `task-prioritization` rank every to-do by its trust balances. The costs and the renamed TimeCamp tools are in the planned diagram's notes.
- **No Assistant or Time Manager plugin.** Those skills write no pool of their own. The task list that `task-prioritization` writes is also written by lawyer's `docket-clerk` agent, so it is shared core data that lawyer must own.

## Open

- The store questions (events per matter, splitting `practice.db`, a trust ledger) are in `docs/Plans/2026-11-10_data-store-restructure-phase-2.md`.
- The plugin moves are in `docs/Plans/2026-11-10_plugin-reorganization-phase-1.md`.
- Cheap cuts to matter-data's layering rulings found by the review: rename its `operations/verify-law.md` operation, which collides with the `/verify-law` skill; move the maintainer history file `references/design-decisions.md` out of the shipped tree; and reword the "never calls any `legal_commons__*` tool" lines. About 23 of the 54 rulings for matter-data, show-me and localize would go.
