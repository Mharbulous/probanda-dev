# legislation-fetcher playbook

Read by the `legislation-fetcher` agent over `skill_source__read`, path `legal-research/references/legislation-fetcher-playbook.md`. The knowledge-tree grammar, the overlay and `_hosts.json` are `shared/knowledge-tree.md`. This file is the tool sequence for one instrument and how to handle each result.

Every tool below is named without its prefix. Call it under whichever of `mcp__plugin_legal_data__<name>` and `mcp__remote-devices__plugin_legal_data__<name>` this host grants.

## 1. Rules for every run

- **One instrument per dispatch.**
- **State no law.** You retrieve and file text. Never summarize, quote, paraphrase or assess what the instrument says, and never say whether it applies. The only facts you report about it are the "current to" date its own page prints and, for a B.C. Reg. citation, how many lines of the bulletin name its number (section 10).
- **Never retype statute text.** Only `research_filing__file_fetched` writes the instrument, from the bytes `sources__fetch` already fetched.
- **The official publisher only.** Fetch only from the publisher's own host, through `sources__fetch`. Never CanLII (its API serves no text), never a search engine, never a commercial or secondary site.
- **A stop is final.** On any stop in section 6, file nothing, write no map, and never try another URL or host.
- **No matter content in a map.** A publisher map records publisher facts only: hosts, URL patterns, formats, the currency marker's wording, terms of use. Never a client, party, issue, question, section number or any text of an instrument. The runtime stamps the `matter` itself.
- **The `matter` argument.** Every `knowledge__write` carries the dispatch's `matter`. A `repo_session` refusal means you were dispatched outside a matter session: return `stopped`, reason `repo_session`.

## 2. Dispatch and return

The dispatch is one JSON object:

- `citation` (optional): the instrument's citation as the caller has it, such as `SBC 2012, c 13`, `RSC 1985, c F-7` or `SOR/98-106`.
- `title`: the instrument's title, such as `Limitation Act`.
- `kind`: `statute`, `regulation` or `bylaw`.
- `country`: `CAN`.
- `jurisdiction`: `BC`, `FED`, or another province's two-letter code.
- `locality`: for a bylaw, the municipality as a knowledge-tree folder name: letters, digits, `.`, `_` and `-` only, each space a hyphen, as `North-Vancouver`.
- `destination_dir`: the issue's existing `6. LAW\<issue>\` folder, an absolute host path.
- `matter`: the live matter's file number, such as `1234.L####`, never its style of cause or a party's name. The runtime looks it up in practice data and stamps that matter's own number (`L####`) into every map you write, never your string. When `knowledge__write` refuses with `matter_unknown`, return `stopped`, reason `matter_unknown`.
- `allow_host` (optional): a host the practitioner approved after a `host_not_allowed` refusal (section 7).

Return one JSON object and nothing else:

| `status` | Meaning | Fields |
|---|---|---|
| `filed` | You filed the instrument now. | `path` (the filed file), `currency_marker` (the date it records), and for a BC Laws instrument `companions` (section 10) |
| `on_disk` | The destination already holds a file named for this instrument (step 2). | `path` |
| `stopped` | A stop in section 6, or a dispatch you cannot run. | `reason` |
| `refused` | `sources__fetch` refused the host; the practitioner decides (section 7). | `reason: "host_not_allowed"`, `publisher_host` (the refused host) |

Every return also carries `citation` (as dispatched, or `null`), `publisher_host` (the host fetched or to be fetched, or `null`), `official` (the map's value, or `false` with no map) and `map_path` (the knowledge path of the map read or written, or `null`).

## 3. Publisher maps

A publisher map records where one official publisher puts its text. Maps live only in the firm's overlay of `/legal-research`'s knowledge tree, in a `Sources\` folder:

- BC: `legal-research\CAN\BC\_NoVenue\Sources\bclaws.md`
- Federal: `legal-research\CAN\FED\_NoVenue\Sources\laws-lois-justice.md`
- Another province: `legal-research\CAN\<code>\_NoVenue\Sources\<host>.md`, `<host>` being the publisher's host without a leading `www.`
- A municipality: `legal-research\CAN\BC\<locality>\Sources\<host>.md`

**Format.** YAML front matter, then a line of prose. Put every value in single quotes, doubling an apostrophe inside one (`'King''s Printer'`): the runtime's front matter reader refuses flow collections (`[...]`) and inline comments, and a regular expression often looks like one. A list is a block list, one `- 'value'` per line. The keys:

- `publisher`, `official` (`'true'` only when a page of the publisher you fetched states that its text is the official version, otherwise `'false'`), `page_url` (the publisher's landing page), `accessed` and `checked` (the date of the run that wrote the map, from `file_fetched`'s `fetched_at`), `formats` (a list: `'html'`, `'pdf'`).
- One URL pattern per kind the map covers: `statute_url_pattern`, `regulation_url_pattern`, `bylaw_url_pattern`, each with a `..._id` key saying how a citation becomes the `<id>` in it. A kind the map does not cover has no pattern.
- `currency_marker_words` (the literal words to `match` on) and `currency_marker_pattern` (the regular expression whose first group is the date).
- `fetch_note` and `terms_of_use`.

Never put an `items:` list or a `currency_marker` in a map.

**Writing.** `knowledge__write` with `operation: "create"`, the map's knowledge path, `matter` and `content`. An `exists` error means a map is already there: read it and use it. To correct a map, write the whole corrected text with `overwrite: true`.

## 4. Seed maps

Use these when the overlay holds no map for BC or for federal instruments, and write the map from them after filing (step 9). URL shapes and markers were confirmed against the live sites on 2026-10-05.

BC Laws, for `legal-research\CAN\BC\_NoVenue\Sources\bclaws.md`:

```text
---
publisher: 'BC Laws, King''s Printer for British Columbia'
official: 'false'
page_url: 'https://www.bclaws.gov.bc.ca/'
accessed: '<date of this run>'
checked: '<date of this run>'
formats:
  - 'html'
statute_url_pattern: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/<id>'
statute_id: 'RSBC 1996, c N: 96, then N in three digits, then _01 (RSBC 1996, c 238 gives 96238_01). SBC YYYY, c N: the last two digits of YYYY, then N in three digits, then _01 (SBC 2012, c 13 gives 12013_01); on a 404, the same id without _01 (SBC 2020, c 2 gives 20002).'
regulation_url_pattern: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/<id>'
regulation_id: 'B.C. Reg. N/YYYY gives N_YYYY (B.C. Reg. 120/2022 gives 120_2022). A regulation published in parts shows no current-to date at its bare id.'
currency_marker_words: 'current to'
currency_marker_pattern: 'current to ([A-Z][a-z]+ \d{1,2}, \d{4})'
fetch_note: 'HTML consolidation. An act prints This Act is current to <date>; a regulation prints This consolidation is current to <date>.'
terms_of_use: 'King''s Printer Licence of British Columbia.'
---
Where BC Laws publishes consolidated BC statutes and regulations. Publisher facts only.
```

Justice Laws, for `legal-research\CAN\FED\_NoVenue\Sources\laws-lois-justice.md`:

```text
---
publisher: 'Justice Laws Website, Department of Justice Canada'
official: 'false'
page_url: 'https://laws-lois.justice.gc.ca/eng/'
accessed: '<date of this run>'
checked: '<date of this run>'
formats:
  - 'html'
statute_url_pattern: 'https://laws-lois.justice.gc.ca/eng/acts/<id>/FullText.html'
statute_id: 'The consolidated chapter code: RSC 1985, c F-7 gives F-7. An act cited only by an annual chapter (SC YYYY, c N) has a consolidated code that citation does not give.'
regulation_url_pattern: 'https://laws-lois.justice.gc.ca/eng/regulations/<id>/FullText.html'
regulation_id: 'SOR/YY-N or SOR/YYYY-N with each slash a hyphen: SOR/98-106 gives SOR-98-106, SOR/2002-227 gives SOR-2002-227.'
currency_marker_words: 'current to'
currency_marker_pattern: 'current to (\d{4}-\d{2}-\d{2})'
fetch_note: 'One-page consolidation. An act prints Act current to <YYYY-MM-DD>; a regulation prints Regulations are current to <YYYY-MM-DD>.'
terms_of_use: 'See the publisher''s Terms and Conditions page.'
---
Where the Justice Laws Website publishes consolidated federal acts and regulations. Publisher facts only.
```

## 5. File names

Name the filed file `<title>, <citation>`, or `<title>` with no citation, then `.md` for an HTML page or `.pdf` for a PDF. Replace each `\`, `/`, `:`, `*`, `?`, `"`, `<`, `>` and `|` with a hyphen: `SOR/98-106` becomes `SOR-98-106`. The runtime adds ` v2`, ` v3` and so on when the name is taken.

## 6. Stops

| Result | Return |
|---|---|
| `sources__fetch` error `no_match` | `stopped`, `login_or_gate_suspected` |
| The matched text has no line containing the title | `stopped`, `login_or_gate_suspected` |
| The matched text has the title but no line matching `currency_marker_pattern` | `stopped`, `no_currency_marker` |
| `{refused: "fetch_failed", status: 401, 402 or 403}` | `stopped`, `access_refused` |
| `{refused: "fetch_failed", status: 404}` | The BC `_01` form only: fetch the bare form once (step 4). Otherwise `stopped`, `not_located` |
| Any other `{refused: "fetch_failed", ...}` | `stopped`, `fetch_failed: <detail>`. A 5xx or a dropped connection was already retried once by `sources__fetch` (`retried: true`), so never fetch it again yourself |
| `sources__fetch` error that `match` applies only to an HTML page (the URL served a PDF) | `stopped`, `no_currency_marker` |
| No URL can be built (step 4) | `stopped`, `not_located` |
| A second `host_not_allowed` after `allow_host` | `stopped`, `host_not_allowed` |
| Any other tool error | `stopped`, the tool's code and message |

## 7. A host the shipped list does not hold

`sources__fetch` returns `{refused: "host_not_allowed", host, url, redirect_from?, hosts_fetched}` as a result, not an error. Return `refused`, reason `host_not_allowed`, with `publisher_host` the refused host. The gate asks the practitioner once.

On a re-dispatch whose `allow_host` equals the host you are about to fetch or were refused on, write the entry first: `knowledge__write` with `operation: "create"`, `path: "_hosts.json"`, `matter`, and `row: {host, category: "statute", page_url}`, `page_url` being the URL you are about to fetch. `status: "exists"` counts as written. The runtime re-reads the file on the next fetch. Then fetch once more. An `allow_host` naming any other host writes nothing. A second refusal is final (section 6).

## 8. Procedure

1. **Check the dispatch.** `title`, `kind`, `country`, `jurisdiction`, `destination_dir` and `matter` must be present, and `locality` for a bylaw. Otherwise, or when `matter` contains a space, return `stopped`, reason `invalid_dispatch`.
2. **Already on disk?** `research_filing__list_law_folder` with `destination_dir`. A file named as section 5 names this instrument, with or without a ` vN` before its extension, means it is filed: return `on_disk` with its path. A page section 10 filed beside it does not count. An error (`not_found`, `not_law_folder`, `protected`) is a stop with that code.
3. **Find the map.** `knowledge__list` with `dir` the map's `Sources` folder (section 3), then `knowledge__read` the map there: for BC or federal the file section 3 names, otherwise the one whose pattern covers the dispatch's `kind`. A `not_found` error from either means no map: use section 4's seed for BC or federal, and otherwise go on with no map.
4. **Build the URL.**
   - From a map: take the pattern for the dispatch's `kind` and turn the citation into its `<id>` as the matching `..._id` key says. With no pattern for the kind, or no `citation` (a title alone), or a citation the key does not cover, return `stopped`, reason `not_located`. Never guess an id. For a BC act whose `_01` form returns `404`, fetch the same id without `_01` once.
   - With no map: one URL on the host of that jurisdiction's or municipality's own official publisher, built from that publisher's URL scheme as you know it. Never a host that is not the government's or the municipality's own. If you cannot name one, return `stopped`, reason `not_located`.
5. **Host approval.** With `allow_host`, run section 7's write before the fetch.
6. **Fetch and verify.** `sources__fetch` with `url` and `match: [<title>, <currency_marker_words>]` (with no map, `"current to"`). Then check the returned text: a line containing the title, and a line matching `currency_marker_pattern`. Any miss is a stop (section 6). If the result is `truncated: true`, the title matched widely: fetch again with `match` the currency marker words alone, and take the title as present. Take `currency_marker` as the pattern's first group, copied as the page prints it.
7. **File.** `research_filing__file_fetched` with `url` exactly as you passed it to `sources__fetch`, `destination_dir`, `filename` per section 5, and `record: {citation, title, kind, jurisdiction, official, currency_marker}`. Leave `citation` out when the dispatch has none. `jurisdiction` is the dispatch's, with `/<locality>` added for a bylaw (`BC/North-Vancouver`). `official` is the map's value as `true` or `false`, and `false` with no map. The runtime adds every other manifest field. An error is a stop with its code.
8. **BC Laws pages.** When `publisher_host` is `www.bclaws.gov.bc.ca` or `bclaws.gov.bc.ca`, file the pages section 10 lists. What happens to them never changes `filed`.
9. **Write or correct the map.** With no map in the overlay, write one now (section 3): section 4's seed for BC or federal, otherwise a map recording the host, the URL pattern you used with the `<id>` part generalized only as far as this one URL shows, the marker words and pattern that matched, and `official: 'false'`. With a map, overwrite it only to correct a field this run proved wrong, such as an id rule that needed the bare BC form or a marker pattern the page no longer matches. Never overwrite only to move `checked`. A failed map write does not undo the filing: return `filed` with the map error in `reason`.
10. **Return** (section 2).

## 9. A PDF

A map whose `formats` holds only `'pdf'` for a kind also records, for that kind, an HTML page on the same host that shows the instrument's title and currency marker (`<kind>_landing_url_pattern`). Fetch and verify that page as step 6 does, then fetch the PDF without `match` and file it with the landing page's `currency_marker`, `filename` ending `.pdf`. With no such landing page, a PDF has no readable date: `stopped`, `no_currency_marker`.

## 10. BC Laws pages beside the consolidation

Step 8 files, beside a BC Laws consolidation, the pages a reader needs to check its currency: the Point in Time page the consolidation links, and for a B.C. Reg. citation the current year's Cumulative B.C. Regulations Bulletin. The URL shapes were confirmed against the live site on 2026-10-05. Both are on `www.bclaws.gov.bc.ca`, a shipped host, so no `_hosts.json` entry is needed.

Fetch each page with `sources__fetch` and check the returned text as step 6 does. File it with `research_filing__file_fetched` as step 7 does, with:

- `filename`: section 5's name for the instrument without its extension, then ` - Point in Time` or ` - Cumulative B.C. Regulations Bulletin <YYYY>`, then `.md`.
- `record`: step 7's record, with `kind` `point-in-time` or `regulations-bulletin` and `currency_marker` the consolidation's.

A page you cannot file is not a stop: section 6 does not apply to it. Record it in `companions` as `{status: "not_filed", reason}`, the reason being the one section 6 gives for that result or the tool's code, and go on. Never request a page twice and never try another URL. A second `sources__fetch` of a URL already fetched reads the memo and requests nothing.

1. **Point in Time.** `sources__fetch` the consolidation URL again with `match: "Link to Point in Time"`. A `no_match` error means it links no Point in Time page (an act's consolidation links its Tables of Legislative Changes instead): `pit: {status: "not_linked"}`. Otherwise build the page's URL, because `sources__fetch` returns text without links: `https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/<id>_pit`, `<id>` being the last segment of the consolidation URL with a final `_01` removed (`120_2022` gives `120_2022_pit`, `168_2009_01` gives `168_2009_pit`). Fetch it with `match: [<title>, "Point in Time"]`. The text must hold a line containing the title and a line containing `Point in Time`. File it: `pit: {status: "filed", path}`.
2. **Bulletin.** Only for a B.C. Reg. citation. For any other, `bulletin: {status: "not_applicable"}`. The regulation's number is the `N/YYYY` or `N/YY` that follows "Reg" in the citation, as written (`B.C. Reg. 168/2009` gives `168/2009`). `<YYYY>` is the year of step 7's `fetched_at`. Fetch `https://www.bclaws.gov.bc.ca/civix/document/id/regulationbulletin/regulationbulletin/<YYYY>cumulati` with `match: ["Cumulative B.C. Regulations Bulletin", <currency_marker_words>, <number>]`. The text must hold a line containing `Cumulative B.C. Regulations Bulletin <YYYY>` and a line matching `currency_marker_pattern`. Then count `lines_naming`: the returned lines that hold the number with no digit immediately before or after it. `match` is a plain substring, so `68/2009` also returns the lines naming `168/2009`, and those never count. File it: `bulletin: {status: "filed", path, lines_naming}`.

Not filed, by design:

- **Amending regulations.** Each bulletin row links its amending regulation's B.C. Gazette Part II page, `https://www.bclaws.gov.bc.ca/civix/document/id/lc/bcgaz2/v<volume>n<issue>_<N>-<YYYY>`. The volume and issue appear only in that link, and `sources__fetch` returns no links, so the page cannot be reached. Never build its address from a row's numbers or dates.
- **"Amendments Not in Force"**: no consolidation page links one.
- **Order-in-council PDFs**, and any earlier year's bulletin.
- **A consolidation part.** Never guess a part id (step 4): a regulation published in parts stops at step 6.

`companions` in the return is `{pit, bulletin}`, each as above.
