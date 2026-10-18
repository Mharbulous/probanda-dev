<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Westlaw Deep Research pipeline

The full Westlaw AI Deep Research pipeline. `research-paralegal` fetches this
file at deep-research mode entry — `mcp__plugin_lawyer_data__skill_source__read`,
path `shared/research-paralegal/westlaw-deep-research.md` — and follows it
exactly, never proceeding from a remembered procedure.

## Input contract

- `query_text` — one or more finished research queries (1..N). Submit each
  VERBATIM. The caller crafts queries with `/legal-research` (`westlaw-query-optimizer`) before
  invoking you; you cannot tell an optimized query from a raw one and must
  not try.
- `client_matter_id` — the Westlaw client ID for this run, and the
  fail-closed scoping gate value: either the matter's `{client}.{matter}` ID
  (e.g. `8575.L8443`) or the literal `PERSONAL`. The caller chooses: a run
  serving a client matter uses that matter's ID, and `PERSONAL` is only for
  a run the caller states is testing or authorized unbilled firm work. Use
  the value as given; never switch between a matter ID and `PERSONAL`.
- `law_subfolder` — absolute path to an existing folder inside the matter's
  `6. LAW\` tree (e.g. `...\6. LAW\Security for costs\`). Under `PERSONAL`
  it may instead be a folder outside any matter, still under a `6. LAW`
  folder (the filing tools refuse any other path). If it does not exist, fail
  immediately naming the missing path. Never create or guess a destination.
- `jurisdiction` — e.g. `SCC, BC`.
- `report_type` — `Expanded` (default) or `Concise`.

**Version guard.** Filing runs on the `research_filing__*` tools
(`list_downloads`, `list_law_folder`, `file_download`, `append_manifest`). If
any of them is absent from your grant, your installed plugin predates this
machinery — return `status: blocked (mechanics-unavailable)` with the guidance
"check for updates in the desktop app and fully restart it, then re-invoke; if the problem persists, run /lawyer:suggestion"
before submitting any research.

## Sign-in and throttle (this mode)

- **Sign-in.** You never handle Westlaw credentials — no typing into sign-in
  forms, no OnePass or password-manager interaction (the credentials hard rule
  in the core agent). Stage 1 runs the core agent's Chrome reach ladder, then
  its Westlaw access check. If the ladder fails, return
  `status: blocked (chrome-not-connected)` with the ladder's `detail:` and
  `tried:` lines. If any research stage lands on a sign-in or session-expired page, stop all
  in-flight work, leave that tab on the sign-in page, and return
  `status: blocked (westlaw-not-signed-in)` with the one-line instruction:
  "Practitioner must sign in to nextcanada.westlaw.com, then re-invoke." Never
  continue on CanLII, another browser or a web search in its place.
- **Throttle.** Westlaw caps the **account** at 3 Deep Research jobs in
  flight, across every matter and session, including jobs left running by
  an earlier invocation. Count them from Westlaw's History and report pages
  — never from a tally of your own submissions. Count immediately before
  every submission (Stage 4) and every follow-up that starts a new job
  (Stage 6), in a **separate tab** so the home tab keeps its pasted query:
  1. Top nav **History** ("My Research - History: All History"; columns
     Event | Description | Date/Time | Client ID). It lists every client
     ID's reports, so it is account-wide. Filter by Event
     "AI Deep Research" (not the separate "AI Research").
  2. History shows no status. Open the `/DeepResearch/<GUID>` report page of
     every row dated within the last hour by the system clock; a row you
     cannot date counts as within the hour. "Preparing research… / N%
     complete" is running (marker from the 2026-07 dry run); the
     `Report | … | Sources (N)` tabs are finished. The running count is the
     number of running pages.

  Then act on the count:
  - Fewer than 3 running → back in the home tab, confirm the top nav's
    `Client ID:` value still matches `client_matter_id` under Stage 2's
    matching rule (absent or unreadable counts as different; else
    `status: blocked (matter-mismatch)`), then submit. If Westlaw refuses
    the submission as over its limit, treat it as 3 running.
  - 3 running → hold the query. Re-count about every 60 seconds and
    submit, in input order, as each slot frees. If 30 minutes pass without
    a slot freeing (the clock restarts whenever one frees), submit nothing
    more: finish the jobs already submitted (Stages 5–10), then return
    `status: blocked (throttle-full)`.
  - The count cannot be taken (History does not load, its layout differs
    from the above, or a report page shows neither marker) → fail closed:
    submit nothing more, finish the jobs already submitted, then return
    `status: blocked (throttle-unreadable)` naming what could not be read.

  After each submission, confirm the new job's row appears in History
  before counting for the next query; if it has not appeared within 2
  minutes, treat the count as unreadable. Poll each report tab
  independently.

## Research pipeline

### Stage 1 — auth check

The working logged-in domain is `nextcanada.westlaw.com`
(`1.next.westlaw.com` redirects to an auth.thomsonreuters.com sign-in page).
Run the core agent's Chrome reach ladder, then its Westlaw access check:
navigate to `https://nextcanada.westlaw.com`. If the ladder fails or a
sign-in page appears, apply the sign-in rule above.

### Stage 2 — client-matter gate (fail closed)

This stage implements the core agent's fail-closed client-matter scoping rule.
No match, no research. Navigate fresh to the Deep Research home:

```
https://nextcanada.westlaw.com/Search/Home.html?transitionType=Default&contextData=(sc.Default)&firstPage=true&bhcp=1
```

The page shows a "Select a client ID" combobox **pre-filled with the
last-used client ID**, a "Select a previous Client ID" dropdown, and a red
"Start new session" button.

**Matching.** Compare `client_matter_id` with the ID token only: the
combobox value, a dropdown option's text before any ` - ` description, or
the top-nav text after `Client ID:`. Trim surrounding whitespace and ignore
letter case (Westlaw shows `PERSONAL` in uppercase). Anything else is a
mismatch.

**Session already started.** Only the first session after sign-in shows
that page. Later, the Deep Research home has no combobox and no "Start new
session" button, only a top-nav client-ID button showing the active ID.
Then read the top nav's `Client ID:` value; if it matches, scoping is
verified. Otherwise switch, at most 3 attempts: open the top-nav client-ID
button (the first click after a page load may show only a "Client ID"
tooltip; click again), and in the "Select a client ID" dialog click the
target in its "Recent Clients" links or its "Select a previous Client ID"
list. A selection applies at once and reloads the page. After each attempt,
re-read the top nav's `Client ID:` value; after 3 attempts without a match,
return `status: blocked (matter-mismatch)`.

On the start-session page:

1. READ the pre-filled combobox value. If it matches, go to step 3.
2. Set the target, at most 3 attempts. An attempt selects the target's
   option in the "Select a previous Client ID" dropdown (clicking at the
   option's measured coordinates is allowed). After each attempt, let the
   page settle, then re-read the combobox; go to step 3 only once it
   matches. After 3 attempts without a match, return
   `status: blocked (matter-mismatch)`.
3. Click "Start new session", then read the top nav's `Client ID:` value.
   If it matches, scoping is verified. If it is absent, unreadable, or
   different, submit nothing and return `status: blocked (matter-mismatch)`.

**Target not listed.** Never type into the client-ID box: focusing it can
raise a password manager's panel, which the credentials rule forbids you to
touch. If the target is in neither the "Recent Clients" links nor the
"Select a previous Client ID" list, submit nothing and return
`status: blocked (client-id-not-on-westlaw)` with the one-line instruction:
"Select `<client_matter_id>` on Westlaw once by hand, then re-invoke."

The browser tab title is not a scoping signal: in a live run under
`PERSONAL` it carried no matter prefix. Never proceed under a wrong or
ambiguous client ID.

### Stage 3 — Deep Research entry

Click the **"AI Deep Research"** tab. Paste one query VERBATIM into the
query textarea (`form_input`), set the Concise/Expanded toggle per
`report_type` and the jurisdiction selector per `jurisdiction`. Leave "Email
me when report is ready" ON — a human-visible backstop; you never read
email.

### Stage 4 — submit and throttle

Typing enables the submit arrow. Clicking it opens the report in a **NEW
browser tab** while the home tab resets for the next query. Apply the throttle
rule above before each submission.

### Stage 5 — poll

Report tabs live at `https://nextcanada.westlaw.com/DeepResearch/<GUID>?...`.
A running report shows "Preparing research… / N% complete" plus a metadata
line. Poll each report tab's "% complete" roughly every 60 seconds until
100%. If a job shows no progress for 30 minutes, record that query
`failed (timeout)` and move on; if every job times out, return
`status: blocked (timeout)`.

### Stage 6 — responsiveness review and follow-ups

A completed report shows tabs across the top:
`Report | Follow-ups | Sources (N) | Research steps`.

Read the Report tab text (`get_page_text`) and judge it against the query
exactly as submitted: did it answer each aspect of the question, or did it
miss a subtlety, get distracted by a red herring, or otherwise miss the
mark? This is the sole purpose of reading the report — you form no view on
the law and carry no legal conclusions into your output. This is the first of
the two sanctioned research-mode reads named in the core agent's read boundary.

- Responsive on all aspects → Stage 7.
- Otherwise: for each missed aspect, compose **one narrow, singular
  follow-up question** targeting exactly that aspect — one question per
  aspect, never bundled, never a new research direction. Submit each via
  the report's Follow-ups tab and read its answer when it arrives.
- **Two-strike rule.** If a follow-up answer misses the same aspect again,
  stop — never a second follow-up on the same aspect. Record it in the
  output as `missed-twice` ("Westlaw's response appears to have missed the
  point on X") and leave the judgment call to the caller.

**Follow-ups mechanics — UNVERIFIED.** The Follow-ups tab has never been
exercised; treat its submission steps as a sketch, not a procedure. If the
tab does not accept questions the way you expect, believe what you observe:
skip follow-ups, record the missed aspects as flags, and continue — do not
force it. If a follow-up spawns a full new research job, it counts against
the 3-in-flight throttle.

### Stage 7 — download the memo

After follow-ups (if any) resolve, use the report's top-right **Download**
control to export the memo as Word (.docx) — the format the practice's memo
tooling expects. Fall back to PDF only if the Word export fails. Fetch
`shared/research-paralegal/citation-download.md` and feed the memo
file-identification through it (source policy: westlaw-first), then file it
per Stage 10.

### Stage 8 — parse the Sources tab

Open `Sources (N)` and read its structured metadata. This is the second of the
two sanctioned research-mode reads. Two machine-readable signals:

1. **"Out of plan" tag** — the source is outside the subscription and cannot
   be downloaded from Westlaw. In practice these are secondary authority
   (texts, annotations, digests). Record each in `not_downloaded` with
   reason `out-of-plan`. If an out-of-plan entry is a court decision,
   retrieve it from CanLII instead per the source selection policy in the
   citation-download playbook.
2. **"Additional sources" divider** ("These Westlaw sources are not cited in
   your report, but can provide context") — everything BELOW it is not cited
   in the report and is EXCLUDED. This section can contain cases too: the
   filter is **cited vs. not-cited**, not case vs. text. Record only the
   excluded count.

**Download list** = sources ABOVE the divider that are court decisions —
identifiable by court name + date + reporter/neutral citation (e.g.
"2014 BCSC 1815") — minus out-of-plan secondary authority, minus legislation
(statutes/rules/regulations: skip, but record titles in
`legislation_skipped`).

Dedupe before downloading: (a) across queries by neutral citation — each
decision downloads once, noting which queries cited it; (b) against the
destination — call `research_filing__list_law_folder(destination_dir:
law_subfolder)` and look for a filename containing the citation; on a hit
record `already-on-file` and do not re-download.

If follow-up answers changed the Sources tab, re-parse it after Stage 6 and
apply the same filters.

### Stage 9 — download the decisions

Fetch `shared/research-paralegal/citation-download.md` and feed the
deduplicated citation list through it (source policy: westlaw-first). Process
sequentially; the manifest is appended per citation, so a turn-budget cutoff
still leaves a usable record. The 5-citation cap applies to citation-mode
invocations, not to this internal list.

### Stage 10 — file and report

Move the memo and each decision into `law_subfolder` with
`research_filing__file_download` per the citation-download mechanics, then
return the research output contract.

## Output contract — research mode

Your first line is one of `status: complete`,
`status: blocked (chrome-not-connected)`, `status: blocked (westlaw-not-signed-in)`,
`status: blocked (matter-mismatch)`,
`status: blocked (client-id-not-on-westlaw)`, `status: blocked (timeout)`,
`status: blocked (throttle-full)`, or `status: blocked (throttle-unreadable)`.
Under a `blocked (chrome-not-connected)` status line, the Chrome reach
ladder's `detail:` and `tried:` lines come before anything else.
Then return exactly these remaining fields and nothing else — no case
excerpts, no legal analysis, no summary of what the memo concludes:

- `not_submitted`: query numbers never submitted (empty on
  `status: complete`)
- `memo_paths`: filed memo path(s)
- `cases`: `[{citation, file_path, cited_by: [query numbers]}]`
- `not_downloaded`: `[{citation or title, reason: out-of-plan | already-on-file | not-found | error}]`
- `responsiveness`: per query — `responsive`, or a list of
  `{aspect, follow_up_asked, outcome: resolved | missed-twice}`
- `excluded_not_cited_count`; `legislation_skipped`: `[titles]`
