<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Note-up playbook

`citation-checker` fetches this file at the start of every invocation with
`skill_source__read` (under whichever of `mcp__plugin_lawyer_data__skill_source__read` and `mcp__remote-devices__plugin_lawyer_data__skill_source__read` this host grants), path `shared/citation-checker/note-up.md`,
and follows it exactly. The agent definition holds the hard rules. This file holds the
order of work, the record and the manifest line.

## The citators, in order

| Order | Citator | Guide (skill_source path) | Runs when |
|---|---|---|---|
| 1 | Westlaw KeyCite Canada | `shared/citation-checker/keycite-canada.md` | always first |
| 2 | CanLII citator | `shared/citation-checker/canlii-citator.md` | after KeyCite, when CanLII's `configure_status` reports `configured: true` |

Fetch each guide before its first use. A guide fetch that fails leaves that citator
not run for every citation, with the reason `guide unavailable`. A citator added later
gets a row here and a guide of its own.

KeyCite runs first for every citation. A Westlaw stop (`chrome-not-connected`,
`westlaw-not-signed-in`, `matter-mismatch`, `client-id-not-on-westlaw`) ends the run
there: no CanLII call in its place. CanLII's no key is not a stop: record the CanLII
citator as not run with the reason `no key`, and carry on.

## Per citation

1. **Already filed.** Call `research_filing__list_law_folder` on `destination_dir` once
   per run. The records already there are context only: every citation named is noted
   up again, because a note-up is as of the day it runs.
2. **Pool record.** `legal_commons__lookup_by_citation`, then
   `legal_commons__treatment_chain` on the authority id it returns. Copy what the pool
   records as it records it. A pool error, or a tool absent from your grant, is
   recorded as `pool: not audited: <reason>`, never as "not in pool".
3. **KeyCite.** Run the KeyCite guide.
4. **CanLII citator.** Run the CanLII guide, when its row above says it runs.
5. **File the record.** Save it (below), then append its manifest line. Do both before
   the next citation, so a cut-off run still leaves a record of each finished citation.

Continue past a single citation's failure: record it in that citation's record and
manifest line, and move on. Only a Westlaw stop or a playbook fetch failure ends the
run.

## The record

One Markdown file per citation, saved with `research_filing__save_answer` (`text`, no
`from_scratch`) in `destination_dir`, named `YYYY-MM-DD note-up <citation>.md`, the
date from the host clock. On a held job, pass the caller's `db_path`, `ticket_id` and
`session_token`. A `job.recorded: false` result means the job is no longer the
caller's: stop and report it on the status line's next line. The tool never
overwrites: a second note-up the same day takes the next ` vN`.

```
# Note-up record: <citation>

Retrieved: <YYYY-MM-DD HH:MM, host clock>
Since: <YYYY-MM-DD> / none
Client ID: <the verified Westlaw client ID> / not used

## Pool
<authority id, and each treatment_chain edge as the pool records it> / not in pool / not audited: <reason>

## KeyCite Canada
Status: run / not run: <reason>
Flag: <the flag tooltip, word for word> / no flag shown
Tabs: <each tab's label and count, word for word>
History:
- <each History entry's fields, word for word> / none listed
Citing References:
- <Treatment> | <Title> | <Date> | <Type> | <Depth> | <Abridgment Classifications>[ | Out of Plan][ | after since]
Export: <the filed export's path> / none

## CanLII citator
Status: run / not run: <reason>
Citing cases:
- <citation> | <title> | <date>[ | after since]

Note-up only — no statement of law and no treatment classification. A citing decision
here is a lead; classifying it requires reading that decision.
```

Write each field as the citator shows it. An empty cell stays empty, never filled from
another column or another citator. Put no word of your own about treatment anywhere in
the record. Mark a row `after since` only when its date is after the `Since:` date.

## The manifest line

After each record is saved, append one line to `destination_dir`'s
`case-download-manifest.json` with `research_filing__append_manifest`:

```json
{"citation": "...", "status": "noted-up", "source": "citation-checker", "filename": "...", "path": "...", "keycite": "run", "canlii": "no key"}
{"citation": "...", "status": "failed", "source": "citation-checker", "reason": "..."}
```

`keycite` and `canlii` each read `run`, or the reason that citator was not run.
