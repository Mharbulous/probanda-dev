# CanLII legislation-currency lookup

Leg 1 of `shared/statute-currency.md`: whether a cited statute, regulation or
rule of court exists in CanLII's legislation databases and is unrepealed.
This file is the rule set. The canlii server's `legislation_currency` tool
applies it in code (`plugins/litigation/canlii-mcp/src/legislation-currency.ts`),
so a caller makes one tool call and runs no procedure itself; a change to a rule
here is a change to that module and its tests. (Until 2026-10-06 `research-paralegal`
ran this as its legislation-currency mode; that mode is retired.) The tool is
API-only: no browser, no downloads, no filing, no manifest. It needs
`CANLII_API_KEY`.

The tool reports metadata about each instrument's own record. It never states
what an instrument says or whether it applies, and it never checks quoted text
(legs 2 and 3 of the doctrine are done elsewhere).

## Input contract

- `instruments` — 1..N objects, each:
  - `citation` — the citation of the instrument as consolidated, as the caller
    stores it, unconverted (e.g. `SBC 2012, c 13`). Never an amending
    regulation (`shared/statute-currency.md`).
  - `title` — the instrument's title as the caller has it.
  - `jurisdiction` — the CanLII jurisdiction code (e.g. `bc`).

## Procedure

1. Call `get_legislation_databases` once. Keep the databases whose
   `jurisdiction` equals an instrument's `jurisdiction`.
2. For each instrument, call `browse_legislation` on each kept database with
   `titleContains` set to the caller's `citation`, periods removed. If that
   matches nothing, repeat with the caller's `title`.
3. An item **matches** when its `citation` equals the caller's `citation`,
   ignoring only periods and case, with runs of whitespace collapsed. A title hit
   whose citation does not match is not a match: report it under `near_items`
   and give the instrument `not-found`.
4. For each match, call `get_legislation_regulation_metadata` with its
   `databaseId` and `legislationId`.
5. Set `currency` by this rule and no other:
   - `repealed` — the metadata's `repealed` field is present, non-empty and not
     "NO" (case-insensitive), or its `endDate` is present and non-empty.
   - `archived` — the database's `name` contains "archive" or "historical"
     (case-insensitive) and no match was found in any other kept database.
   - `current` — a match was found, and neither rule above applies.
   - `not-found` — no match in any kept database.
   - `validation_unavailable` — a tool is absent, unconfigured, or still errors
     after one retry. Never infer another value.

Report every field exactly as CanLII returned it. The metadata's `url` is a
raw field: never open it. Supersession has no field of its own in CanLII's
metadata, so it surfaces only as `repealed` or `endDate`.

## Key-failure handling

With no key configured the tool makes no request and returns
`status: blocked (no-api-key)` with a `detail` naming both key paths verbatim:

1. the `CANLII_API_KEY` user environment variable, or
2. the canlii `configure_credential` tool.

A caller relays that and never falls back to canlii.org's site, bclaws, or any
browser.

## Output contract

`status` is `complete` or `blocked (no-api-key)`. With `complete` the result
also carries:

- `instruments`: `[{key, inputs, citation, title, jurisdiction, currency,
  databaseId, database_name, legislationId, returned_title, returned_citation,
  repealed, startDate, endDate, dateScheme, url, near_items, error}]`

**One check per instrument.** Inputs that share a `key` are checked once and
return one entry. `key` is the jurisdiction, lower-cased, then `|`, then the
citation with periods removed, lower-cased and whitespace runs collapsed: the
matcher's own comparison form. `inputs` lists the input positions (from 0) the
entry answers. Each database's listing is read once per call, whatever the
number of instruments.

Fields CanLII did not return are `null`. `error` is `null` unless `currency`
is `validation_unavailable`, when it holds the failing tool and its message.
The word "pass" never appears: `currency` is a report, and the caller decides
what to do with it.
