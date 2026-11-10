<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Note-up playbook

`citation-checker` fetches this file at the start of every invocation with
`skill_source__read` (under whichever of `mcp__plugin_lawyer_data__skill_source__read` and `mcp__remote-devices__plugin_lawyer_data__skill_source__read` this host grants), path `shared/citation-checker/note-up.md`,
and follows it exactly. The agent definition holds the hard rules. This file holds the
order of work, the return and the manifest line.

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
there: no CanLII call in its place. CanLII's no key is not a stop: return the CanLII
citator as not run with the reason `no key`, and carry on.

## Per citation

1. **KeyCite.** Run the KeyCite guide.
2. **CanLII citator.** Run the CanLII guide, when its row above says it runs.
3. **Append the manifest line** (below) before the next citation, so a cut-off run still
   leaves a dated line for each finished citation.

Continue past a single citation's failure: give it in that citation's return lines and
manifest line, and move on. Only a Westlaw stop or a playbook fetch failure ends the
run.

## The return

Each citation's lines go in the final message only, below its `<citation>:` line. They
are never saved: no file, no note-up record and no pool write holds them.

```
Retrieved: <YYYY-MM-DD HH:MM, host clock>
Since: <YYYY-MM-DD> / none

KeyCite Canada
Status: run / not run: <reason>
Flag: <the flag's label, word for word> / no flag shown
Banner: <the KeyCite treatment banner, word for word> / no banner shown
Tabs: <each tab's label and count, word for word>
History:
- <each History entry's fields, word for word> / none listed
Content types: <each label and count, word for word> / not recorded: <reason>
Treatment Type: <each label and count, word for word> / not recorded: <reason>
Citing References (Cases and Decisions, Date sort, newest first):
- <Treatment> | <Title> | <Date> | <Type> | <Depth> | <Abridgment Classifications>[ | Out of Plan][ | after since] / not recorded: <reason>
Rows of the banner's label: <label>, newest first:
- <the same six fields> / no banner shown / not recorded: <reason>
Not recorded: cap 5, newest first: every other citing reference

CanLII citator
Status: run / not run: <reason>
Citing cases: <total>
- <citation> | <title>
Not recorded: cap 5, newest by neutral citation, year then number: every other citing case
```

Write each field as the citator shows it. An empty cell stays empty, never filled from
another column or another citator. Put no word of your own about treatment anywhere in
the return. Mark a row `after since` only when its date is after the `Since:` date. A
`Not recorded:` line stays even when the count shows nothing was left out, and it never
reads as none: a citing reference it covers was not looked at.

## The manifest line

After each citation's citators have run, append one line to `destination_dir`'s
`case-download-manifest.json` with `research_filing__append_manifest`:

```json
{"citation": "...", "status": "noted-up", "source": "citation-checker", "retrieved": "YYYY-MM-DD", "keycite": "run", "canlii": "no key"}
{"citation": "...", "status": "failed", "source": "citation-checker", "reason": "..."}
```

`retrieved` is the host clock's date. This line is the dated record that the citators ran;
what they showed is in the return alone. `keycite` and `canlii` each read `run`, or the
reason that citator was not run. On a held job, pass the caller's `db_path`, `ticket_id`,
`session_token` and `claim_no`, so the job's last activity moves. A `stale_claim` or
`not_held` refusal means the job is no longer the caller's: stop and report it on the
status line's next line.
