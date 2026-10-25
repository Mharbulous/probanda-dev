<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Citation download machinery

The unified download-and-file machinery for court decisions by citation,
Westlaw-first or CanLII-only. `research-paralegal` fetches this file at
citation mode entry, and the deep-research playbook fetches it too (Stages 7
and 9), via `skill_source__read` (under whichever of `mcp__plugin_lawyer_data__skill_source__read` and `mcp__remote-devices__plugin_lawyer_data__skill_source__read` this host grants), path
`shared/research-paralegal/citation-download.md` — follow it exactly, never
proceeding from a remembered procedure. The filing tools, collision handling,
and the unified manifest live in the core agent; this file carries the
source-specific retrieval and identification.

**Version guard.** Filing runs on the `research_filing__*` tools
(`list_downloads`, `list_law_folder`, `file_download`, `append_manifest`). If
any of them is absent from your grant, your installed plugin predates this
machinery — return `status: blocked (mechanics-unavailable)` with the guidance
"check for updates in the desktop app and fully restart it, then re-invoke; if the problem persists, run /lawyer:suggestion",
and do not download anything.

## Input contract (citation mode)

- `source` — **required, caller-supplied**: `westlaw-first` (Westlaw
  NextCanada; a per-citation CanLII fallback only while Westlaw is signed in and
  reachable, per the source selection policy below) or `canlii-only` (never touch
  Westlaw). No default — the caller owns
  the cost/source decision.
- Up to **5 citations** per invocation (batch further citations across
  multiple invocations — do not exceed this).
- An **existing** destination folder (absolute path). If it does not exist,
  fail immediately naming the missing path. Never create or guess a
  destination.
- Format preference (`PDF` or `RTF`, default PDF) — meaningful only under
  `westlaw-first`. CanLII serves PDF only; a CanLII-served citation under an
  RTF request delivers PDF rather than failing.

## Source selection policy (applies under `westlaw-first`)

Westlaw first. Two triggers move a single citation to CanLII, and only while
Westlaw is signed in and reachable. Each is a gap in Westlaw's coverage, not an
access failure:

| Trigger | Scope |
|---|---|
| Citation out of plan on Westlaw | **Per-citation** |
| Citation not found on Westlaw | **Per-citation** (after the availability check below) |

**Westlaw unreachable stops the run. It never moves the batch to CanLII.** Run
the core agent's Chrome reach ladder, then its Westlaw access check, before the
first citation. If the ladder fails, return `status: blocked (chrome-not-connected)`
with the ladder's `detail:` and `tried:` lines. If a sign-in or
session-expired page appears, at batch start or mid-batch, leave that tab on the
sign-in page and return `status: blocked (westlaw-not-signed-in)`. Citations
already resolved stay in the manifest. Retrieve nothing else, from any source.
Plan coverage varies case by case, so out-of-plan and not-found do not switch
the batch.

Never fall back the other way. If CanLII also lacks the case, record it
unavailable — do not return to Westlaw.

Under `source: canlii-only` you never touch Westlaw at all — go straight to the
CanLII retrieval section for every citation. The core agent's Chrome reach
ladder still runs before the first CanLII download, and a failed ladder stops
the run the same way; only the Westlaw navigate and sign-in check are skipped.

## Westlaw file identification

Westlaw's delivery flow needs a **real `computer` click** — a synthetic click
yields no file. CanLII's click and identification specifics differ and are
covered by the fetched CanLII mechanics (§ CanLII retrieval below); do not
carry Westlaw's real-click rule onto the CanLII path. Navigation on both
sources can be driven with `javascript_tool` or deep-links.

Westlaw names the file, so identify it by snapshot diff with
`research_filing__list_downloads`:

1. Immediately before the real download click, call
   `list_downloads(filename: "<an impossible name>")` and record the returned
   `now` as `t0`. (The filter keeps other clients' filenames out of your
   context; the call exists for its clock.)
2. Click, wait for the download to complete, then call
   `list_downloads(since_mtime: t0)`.
3. **Ignore every entry with `in_progress: true`.** The single remaining new
   file is the download. If only in-progress entries appear, the download has
   not finished — wait and re-list before concluding anything.

(CanLII instead sets the name via the `download` attribute, so it is
identified by exact filename without a snapshot diff — per the fetched CanLII
mechanics.) Then file it with `research_filing__file_download` and
handle a `dest_exists` collision per the core agent's Filing section.

## Westlaw specifics

### Authentication (Westlaw only)

If Westlaw shows a login page or a session-expired prompt, never enter or guess
credentials and never proceed via CanLII. Stop with
`status: blocked (westlaw-not-signed-in)`, the tab left on the sign-in page, per
the core agent's Westlaw access check. Research mode stops the same way.

### Out-of-plan content: never download (hard rule)

Westlaw charges prohibitive per-document fees for content outside the
subscription plan. **Never download an out-of-plan document — no exceptions,
and do not ask whether to proceed.** Before the download click sequence,
check the document page for out-of-plan indicators (an "out of plan" badge, a
pay-per-view/additional-charges notice, or any prompt warning that viewing or
delivery will incur a charge). If any appears, abort the Westlaw download for
that document and dismiss the prompt without accepting charges — then retrieve
that citation from CanLII, where it is free.

### Citation deep-link (fastest path)

If the citation is known, skip the search box entirely:

```
https://nextcanada.westlaw.com/Link/Document/FullText?findType=Y&cite=<url-encoded citation>&transitionType=Default&contextData=(sc.Default)
```

Verified with BCSC, BCCA, ABCA, ONCA, SCR, WWR, and BCLR neutral and reporter
citations. URL-encode the citation before substituting it in. This resolves
directly to the document page — no search UI involved.

If no citation is known, search by party name instead (see the availability
note below before assuming a case is missing).

### Search box gotcha

Clear the search box with `triple_click`, never `ctrl+a` + `Delete` — the
latter intermittently leaves a stray leading character, silently degrading
a citation search into a plain-language search with no error.

### Download click sequence

The button that hands the file to Chrome's download manager
(`#coid_deliveryWaitMessage_downloadButton`) requires a **real `computer`
click** — a synthetic click silently produces no file, even though the page
shows no error. This is a constraint of Westlaw's delivery flow, not a
general Chrome rule (CanLII downloads fine from a synthetic click), so do not
generalize it.

1. Click the toolbar download icon.
2. Click "Download This Document" in the modal.
3. Wait for the "Ready For Download" toast, then click the download button
   for real — not via `javascript_tool`.

### Silent-stall quirk

If downloads stop producing files while Westlaw's UI still reports success
and Chrome shows no blocked-download indicator, **refresh the Westlaw page
and retry** before any deeper diagnosis. A transient delivery-service
session state has caused exactly this, defeated repeated diagnosis
attempts, and was cured instantly by a page refresh.

### Availability note

Pre-1900s English nominate reports are generally absent from Westlaw
NextCanada. Before concluding Westlaw lacks a citation, do a party-name
search and use `find` on the results — then fall back to CanLII rather than
retrying the same search indefinitely.

## CanLII retrieval (fetched mechanics)

CanLII's download mechanics — deep-URL construction, the PDF-link trap, the
`download`-attribute anchor, citation-as-written naming, no-snapshot-diff
identification, and the 403 record-and-move-on rule — live in one canonical
file, `shared/canlii-download-mechanics.md`. **Before the first CanLII
download**, fetch it via `skill_source__read` (under whichever of `mcp__plugin_lawyer_data__skill_source__read` and `mcp__remote-devices__plugin_lawyer_data__skill_source__read` this host grants)
(path `shared/canlii-download-mechanics.md`) and follow it exactly. Never
proceed from remembered CanLII mechanics. CanLII serves **PDF only**; there is
no format choice on this path.

**Fetch-failure severity is policy-dependent.** A failed
`shared/canlii-download-mechanics.md` fetch:

- **Hard-fails the invocation when CanLII is the primary path** — `source:
  canlii-only`. Return
  `status: blocked (mechanics-unavailable)` with the guidance: check for updates in the desktop app and fully restart it, then re-invoke; if the problem persists, run /lawyer:suggestion.
- **Records-and-continues per citation when Westlaw remains the operative
  primary** — a `westlaw-first` batch still signed in, where CanLII is reached
  only for per-citation out-of-plan / not-found fallbacks. Record each affected
  citation in the manifest as `status: not_downloaded`, `reason:
  "canlii-mechanics-unavailable (skill_source fetch failed)"`, and finish the
  batch.

(A failed **playbook** fetch, and a missing `research_filing__*` tool, always
hard-fail/stop — those are the core agent's rules, not this graduated one.)

## The final message (citation mode)

Your final message is one `status:` line — `complete`, or the applicable
`blocked (…)` value — followed by the manifest and nothing else: no excerpts,
no summaries, no commentary on what the decisions say. Under a
`blocked (chrome-not-connected)` status line, the Chrome reach ladder's
`detail:` and `tried:` lines come before anything else. The manifest schema,
append-per-citation discipline, and continue-past-single-failure rule are in
the core agent's download manifest section.
