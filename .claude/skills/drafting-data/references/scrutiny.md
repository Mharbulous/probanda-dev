# Scrutiny returns and their review (schema v46, v47)

Read when: the research lawyer returns on a 🔬 job, the practitioner confirms, revises or drops a statement under a `Review scrutiny finding: ` job, or `/draft`'s `Link or draft the factual basis` job asks whether a submission's test is on file.

Only the research lawyer's return to a 🔬 job sets `verification` to `'verified'` or `'failed'`; a closed gate or a refusal records nothing.

## Record a verified return

Verified, when fit and ratio both hold, snapshotting the pair it judged: `UPDATE statements_of_law SET verification = 'verified', scrutinized_authority_id = authority_id, scrutinized_pinpoint = pinpoint, scrutinized_excerpt = excerpt, verified_on = '<YYYY-MM-DD>', doubt = CASE WHEN INSTR(doubt, 'Scrutiny failed') > 0 THEN NULLIF(RTRIM(SUBSTR(doubt, 1, INSTR(doubt, 'Scrutiny failed') - 1), ' ' || char(10) || char(13)), '') ELSE doubt END WHERE id = N`. Everything in `doubt` from the first finding on is removed, any text written after a finding included, and any doubt written before it stays. `verified_on` (schema v61) is the date of the return.

A verified statement needs a pinpoint (schema v61): the write is refused on a row whose `pinpoint` is empty. Record the pinpoint the research lawyer returned first, in its own write, `UPDATE statements_of_law SET pinpoint = '<p>' WHERE id = N`, then the verified write, so the snapshot takes the new pinpoint. A return that names no pinpoint is not a verified return: record nothing and say so. When the return says the excerpt is words the court quotes from another source, not its own, the verified write also sets `excerpt_speaker = '<that source, as the return names it>'`; it prints as `(quoting <source>)` on the mockup and never on a filed face.

A residual point the research lawyer raises that narrows fit or ratio makes the return a failed return: record it with the failed write instead. Any other residual point is captured word for word as a loose thread by the `jobs-run.md` §8 insert, `origin_ticket_id` the 🔬 job the recording session holds and `surfaced_by` naming the saved answer file.

## Record a failed return

Failed, for any other substantive return, a partial pass included, the finding naming what held and what failed: `UPDATE statements_of_law SET verification = 'failed', doubt = COALESCE(doubt || ' ', '') || 'Scrutiny failed <YYYY-MM-DD>: <finding>' WHERE id = N`, followed in the same session by the statement's scrutiny review job (`/drafting-data` §3d) when the statement is linked to a live Writing. `<finding>` ends with `Answer: 6. LAW\….md`, the matter-relative path of the saved research lawyer's answer, which is how `scripts/statement_for_review.py` finds that file.

## Read for review

`scripts/statement_for_review.py` reads the statement under review read-only, with its proposition, authority, stored excerpt, finding and the answer file the finding names; `drafting_forms__draft_harness` step `scrutiny_review` runs it, and it writes nothing.

## Read a statement's provenance

Where a stored statement came from, read when a session pulls its proposition into a new draft or answer (schema v61). Two `drafting_data__query` calls, `N` being the statement id:

```sql
SELECT s.id, s.law_assertion_id, a.style_of_cause_or_title, a.citation, a.kind,
       s.pinpoint, s.excerpt_speaker, s.verification, s.verified_on, s.settled_on
  FROM statements_of_law s JOIN authorities a ON a.id = s.authority_id
  WHERE s.id = N;

SELECT a.citation, pc.in_force_on FROM statements_of_law o
  JOIN authorities a ON a.id = o.authority_id
  LEFT JOIN provision_currency pc ON pc.authority_id = o.authority_id AND pc.provision = o.pinpoint
  WHERE o.law_assertion_id = <law_assertion_id> AND o.id <> N
    AND a.kind IN ('statute', 'regulation', 'rule') AND a.killed_on IS NULL
  ORDER BY o.id;
```

The second query runs only when `law_assertion_id` is set. Show the result as one line, beside the proposition:

`Provenance: <title>, <citation> (<year>) · pinpoint <pinpoint> · <speaker> · <verification> <date>[ · 🕰️ predates <provision citation>]`

- `<year>` is the first four-digit year in the citation, or `year unknown`. `<pinpoint>` is `none` when empty.
- `<speaker>` is `quoting <excerpt_speaker>` when set. Otherwise it is `speaker not recorded` on a row verified before v61 (`verified_on` empty) and `court's own words` on any other verified row. A lead or failed row reads `speaker not recorded`.
- `<date>` is `verified_on` on a verified row, `settled_on` on a settled one, and `date not recorded` when empty. A lead or failed row has no date.
- 🕰️ follows the 🕰️ marker's own test, applied to these rows: the statement's authority is a case, and some provision row's year is later than the case's year. The provision's year is the year of its `in_force_on`, or else the first four-digit year in its citation. Name that provision.

The line says where the statement came from, never what the law is, and it upgrades nothing. It writes nothing.

## Read a submission's legal basis

Whether a submission's test is on file, read by `/draft`'s `Link or draft the factual basis` job before it shows any fact. One `drafting_data__query`, `N` being the submission id in the job's `factual-basis:submissions:N` key:

```sql
SELECT s.id, s.verification FROM statements_of_law s
  JOIN submission_law l ON l.law_assertion_id = s.law_assertion_id
  JOIN authorities a ON a.id = s.authority_id
  WHERE l.submission_id = N AND a.killed_on IS NULL
  ORDER BY s.id;
```

The test is on file when any row reads `'verified'` or `'settled'`. No row, or only `'lead'` and `'failed'` rows, is a test not on file. A killed authority's statements are left out because they support nothing on any filed face. It writes nothing.

## Close a review (change or keep)

The confirmation write closes that review (schema v47), only on the practitioner's confirmation shown by `/draft`, and is one `UPDATE`: `UPDATE statements_of_law SET verification = 'settled', settled_on = '<YYYY-MM-DD>', settled_note = '<the practitioner''s decision, verbatim>', authority_id = <a>, pinpoint = '<p>', excerpt = '<e>', scrutinized_authority_id = <a>, scrutinized_pinpoint = '<p>', scrutinized_excerpt = '<e>' WHERE id = N`, the pair repeated unchanged when counsel keeps the statement as it is over the finding. A reword is a separate `UPDATE law_assertions SET proposition = '<new wording>' WHERE id = M` in the same script, and resets nothing.

## Close a review (drop)

A drop writes nothing to the statement: it stays `'failed'` and supports nothing; killing its authority (`killed_on`) is the drop where nothing else relies on that authority. Either way the review job then completes by `/drafting-data` §9. Never delete the row.

## Repair a verified statement that kept a finding

A verified statement whose `doubt` still holds a finding is listed read-only: `SELECT id, doubt FROM statements_of_law WHERE verification = 'verified' AND doubt LIKE '%Scrutiny failed%' ORDER BY id`. Show each row's whole `doubt` to the practitioner. Only on their confirmation, write `UPDATE statements_of_law SET doubt = <their wording, or NULL> WHERE id = N`. If what remains narrows fit or ratio, the practitioner may instead have it re-recorded with the failed write. Never apply the verified write's strip to these rows unattended: on the known rows the finding sits before its label, so the strip would keep the wrong part.

## Invariants

The finding stays in `doubt` on a failed and on a settled row: a table CHECK refuses either with no `doubt`, so it refuses recording a failure without a finding and clearing `doubt` on a failed or settled row, and a second CHECK refuses a settled row without its `settled_on`, `settled_note` and snapshot. A failed row is never reset by an edit: rewording its proposition, re-pointing it or re-capturing its excerpt leaves it `'failed'` until the confirmation write. One trigger reopens scrutiny: a `'verified'` or `'settled'` row whose `authority_id`, `pinpoint` or `excerpt` moves off its snapshot returns to `'lead'`, keeping `doubt`, so 🔬 derives once for the new pair; any change counts, a whitespace edit included. The confirmation write moves the pair and the snapshot together, so it does not trip that trigger, and a proposition's wording resets nothing. `Scrutiny failed` is a fixed marker, written by the failed write and searched for by the verified write and the v47 backfill, so it is never reworded.

## How failed and settled statements print

A failed statement counts toward nothing read across statements (the proposition's 📖 🔬 🥉 🥈 🏅 and an order's 🏛️), as an overruled authority's statements do not, and rides the brief-only cap: it prints with 👃 and a `(scrutiny failed: <finding>)` tag in the Counsel Brief only, and the proposition line and an implied clause citing it carry the same tag on the mockup, withheld from every filed and sent face. While a statement of a proposition is failed, the proposition's 📖 prints and counts for the completion criteria but proposes no job. A settled statement counts as support like a verified one on every read across statements, and prints on the filed face. That is deliberate, not unverified material reaching the forum: counsel has read the finding and the source and confirmed the statement over it, which is counsel's call to make, so never withhold a settled row from a filed face. It never reads as verified by the research lawyer: its own line prints a `(settled by counsel <settled_on> over scrutiny finding)` tag on every mockup line it prints on, stripped from the filed face, and carries no 🔬 and no 👃 for its finding.
