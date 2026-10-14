# CanLII download mechanics

Canonical, verified mechanics for downloading a CanLII decision by neutral
citation via a Claude-in-Chrome session and filing it. The `research-paralegal`
agent fetches this file before its first CanLII download —
`mcp__plugin_practice_data__skill_source__read`, path
`shared/canlii-download-mechanics.md` — and follows it exactly. Never proceed
from remembered mechanics; if the fetch failed, apply your agent's
fetch-failure rule.

## CanLII is free and public — no login, one at a time

CanLII requires no login: no authentication step and no out-of-plan concerns
apply here. It is a public service — retrieve one citation at a time and never
attempt to defeat a block.

CanLII returns 403 to agent user-agents on WebFetch and curl, but **serves a
Chrome session driven by these tools normally** — verified 2026-07-16 against
`2021 BCSC 963`, no challenge page. Still, if CanLII ever shows a 403 or a
challenge page, record `canlii: "blocked"`, report it, and move on — do not
work around it.

### Reading BC judgment text without a Chrome session

A session with no Chrome tools — a local repo session, or any agent limited to
`WebFetch`/`curl` — cannot reach CanLII at all because of that 403. The BC
courts publish their own full text, and it answers a plain `curl`:

```
https://www.bccourts.ca/jdb-txt/{sc|ca}/{YY}/{NN}/{YYYY}{COURT}{NNNN}.htm
```

`sc` for BCSC, `ca` for BCCA; `{YY}` is the two-digit year; `{NN}` is the
decision number's hundreds group, zero-padded (963 → `09`, 100 → `01`). So
`2021 BCSC 963` is `.../jdb-txt/sc/21/09/2021BCSC0963.htm` — verified live
2026-07-28, returning *Bonner v. Axion Ventures Inc.*

**Paragraph numbers there are the court's own**, because this is the court's own
publication — so they are safe to pin-cite directly, with no need to reconcile
them against another source.

This is a **reading** route only. It is HTML, not the filed PDF, so it does not
substitute for a download when the task is to file the decision into a matter —
use the Chrome path above for that. This is a different site, not a way around
CanLII's block: if bccourts also refuses, stop and report, same as above.

## Click and navigation

Download the PDF with a **synthetic `javascript_tool` click** on a
`download`-attribute anchor (step 3 below) — a synthetic click is sufficient on
CanLII. (This differs from Westlaw, whose delivery flow needs a real click; do
not carry that rule onto this path.) Navigation can be driven with
`javascript_tool` or deep-links.

## 1. Deep URL from a neutral citation (fastest path)

`https://www.canlii.org/en/{jurisdiction}/{courtDb}/doc/{year}/{slug}/{slug}.html`
where `{slug}` is the neutral citation lowercased with spaces removed —
`2021 BCSC 963` → jurisdiction `bc`, courtDb `bcsc`, slug `2021bcsc963`.
SCC decisions live under `/en/ca/scc/`. Verified for `bcsc`, `bcca`, and
`scc`. Reporter-only citations (SCR, WWR, BCLR) have no slug — use the search
box instead.

## 2. Search fallback — UNVERIFIED

This step has never been exercised; treat it as a sketch, not a procedure: if
it does not behave as described, believe what you observe and report the
citation `unavailable` rather than forcing the steps below to work. Use
CanLII's own on-site search box: citation first, then party name. Confirm the
result is the right case by matching the citation string in the result list or
page title — a UI-state check under the read boundary, exactly as on any result
page.

## 3. PDF retrieval — do NOT click the PDF link

The decision page's PDF link (`#pdf-link`) points at the decision URL with
`.pdf` swapped for `.html`, and CanLII serves it `Content-Disposition:
inline`. Clicking it therefore opens Chrome's built-in PDF viewer instead of
downloading, and that viewer's download button does **not** produce a file when
driven (verified: correct coordinates, hover confirmed, no file, no error).

Instead, force the download with a `download`-attribute anchor via
`javascript_tool` — a synthetic click is sufficient here:

```js
const a = document.createElement('a');
a.href = location.href.replace(/\.html$/, '.pdf');
a.download = '<citation>.pdf';   // the citation verbatim: "2021 BCSC 963.pdf"
document.body.appendChild(a);
a.click();
```

Name the file with the **citation as written**, spaces and capitals intact —
`2021 BCSC 963.pdf`, not the lowercased slug `2021bcsc963.pdf`.

Run this from the decision's `.html` page — the anchor must be same-origin for
`download` to bind. The file lands in Downloads under the `download` name you
set, so confirm it by that name per step 4 — no snapshot diff.

## 4. File identification and move

Chrome saves to the OS Downloads folder, not the destination folder. Filing is
host-side through the `research_filing__*` tools — no Downloads folder
resolution, no folder request, no shell, no Downloads path of your own.

The `download` attribute sets the name, so you already know it before you
click: call `research_filing__list_downloads(filename: "<citation>.pdf")` after
the click to confirm it arrived (an entry with `in_progress: false`). No
snapshot diff.

Watch for Chrome's ` (1)`, ` (2)` collision suffixes on repeat downloads of
similarly-named files: make the same `list_downloads(filename: …)` call
*before* the click — if it already returns a hit, the new file arrives suffixed
(`<citation> (1).pdf`) and that is the one to move.

Move it with `research_filing__file_download(destination_dir, source_filename)`
— pass `destination_filename` only to strip a Chrome collision suffix. A
`dest_exists` refusal means a file of that name already exists at the
destination: do not overwrite and do not rename around it — mark that citation
`status: failed`, `reason: "destination filename collision"`, and move on.
