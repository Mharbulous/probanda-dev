Read when: a job will write or revise a passage that rests on a procedural step, or such a passage comes up while writing substance (`references/procedure.md` sections 9 and 12, `work/references/job-session.md` Plan).
Assumes SKILL.md is loaded. Rules are not restated here.

# The posture check

Before a passage that rests on a procedural step is written or revised, the session lists every direction and order of the forum on record for the Writing's proceeding, and any later one still only in the matter's mail, newest first, and flags each one dated after the premise. The practitioner sees them before the passage goes further. The check reports what each direction says, never what it means: whether one overtakes, varies or contradicts another is the practitioner's call, and what the law makes of it is `/legal-research`'s.

It is not the procedural history's currency check (`shared/procedural-history.md`). That check asks once whether anything has happened since the log's newest entry. This one lists the forum's directions word for word against the passage's premise. Neither stands in for the other.

## 1. What triggers it

A passage rests on a procedural step when it asserts or depends on any of these:

- a deadline or time limit set by a rule, an order or a direction, or whether it was met;
- a direction or order of the forum, and what it requires;
- a waiver, a default, or a step not taken in time;
- the stage the proceeding is at: a step closed, pending, scheduled, or heard separately from another;
- the effect of an order.

The session judges this from the practitioner's instruction and the job's intent and steps. A passage on the merits, the facts or the law alone does not trigger it. When unsure, run it, because an unflagged check costs one line.

## 2. When it runs

It runs once per job for each proceeding, and again only after something was ingested since it last ran. A check is flagged when any direction is flagged (section 4). An unflagged check is reported in one line: the number of directions listed, and any files not yet ingested or mail not read. It adds no pause of its own. It rides the pauses `/draft` already has:

- **A job of two or more steps.** When its intent or steps will write such a passage, the check runs after the job is assigned and before the plan read-back. Its block (section 4) joins the read-back, inside the single plan-approval gate.
- **A one-step job.** The check runs with the pre-claim check (`work/references/job-session.md`). Unflagged: its one line, then assign and dispatch as before. A flagged direction fails the pre-claim check: assign nothing, show the block, and ask in plain text, per `/show-me`, whether to run the job as worded or change it.
- **A passage met while the work runs, or a revision (`references/procedure.md` section 12).** The check runs before the passage is written. Unflagged: its one line, then write. A flagged direction is an obstacle the plan did not anticipate (`references/job-session.md`, "An obstacle on any assigned job"): show the block and write nothing to that passage until the practitioner answers.
- **An unattended run** (`references/unattended-run.md`). Nothing is shown and nothing waits. An unflagged check goes in the run's report and the run continues. A flagged one goes in the report with its block, and the run stops. A mail step that would have to ask the practitioner (`shared/matter-mail.md`) reads no mail, and the report says so.

## 3. What it reads

1. **The directions on record.** Ask `/matter-data` for the directions and orders the forum has made in the Writing's proceeding, newest first, naming the proceeding by its file number. Never read a `/matter-data` file or the database for it. A `/matter-data` error is quoted in one line and the passage waits: never say there are no directions when the check could not run.
2. **Files in the matter folder not yet ingested.** Ask `/matter-data` for the ingest coverage of `3. CORRESPONDENCE*` and `5. COURT*`, the first counting as correspondence. A clean input check already run in this session for the job stands in for this read (`work/references/job-session.md`, "The input check"). Each file to ingest is one the directions list cannot include. Name them and offer `/ingest` on every one, in the block or in the unflagged check's one line. An unflagged check never waits for the answer. Run `/ingest` only on a yes, and then run the check again. Declining leaves them named.
3. **Mail from the forum newer than the record.** A direction can sit in the matter's mail and nowhere else. Read the matter's mail folder by `shared/matter-mail.md`: its route, its folder finding and its never-a-browser rule govern, and this is the one place this skill reads mail. Take the messages from the forum (a judge, registrar, tribunal member, arbitrator or case manager, read from the sender or signature block) dated after the newest direction on the list, or after the premise when the list is empty. With neither date, read nothing and say so in the check's report. Read each such message and quote its operative sentences as section 4's mail rows, the same test the facts extractor uses: a sentence by which the forum directs, orders, schedules, grants, refuses or declines something. A message is not a file, so it is never offered to `/ingest` here: name it, and say that it is ingested once it is saved into the matter folder as a file. When the mail cannot be read, `shared/matter-mail.md` says so in one line, and the check reports that the mail was not read. That flags nothing, and the check never claims there is no later direction.

## 4. The block

One block, in a fenced code block in the visible reply. It reports the record, not the Writing, so it is one of the exceptions to "Chat is not the review surface" (SKILL.md section 3). It quotes before it says anything else, as `shared/report-what-a-source-said.md` requires:

```
Posture check: <file number>. <N> directions and orders on record, newest first, as case data stores them.
Premise: <the direction, order or rule step the passage relies on>, <its date, or "no date on record">.
1. <date> | <author> | "<operative sentence>" | <file path>#<locator> | after the premise
2. <date> | <author> | "<operative sentence>" | <file path>#<locator>
Mail only, not ingested: <N> messages from the forum after <date>.
3. <date> | <author> | "<operative sentence>" | <mail folder>, "<subject>" | after the premise
Not yet ingested: <N> files in <folder>.
```

- **Each record row** is one direction as `/matter-data` returns it: its date, its author, its operative sentence character for character as the extractor stored it, and its citation. A row linked to no proceeding adds `(no proceeding linked)`. A row not yet verified against its source adds `(not yet verified)`. Before the practitioner relies on a flagged row, read the source at its locator, as `shared/report-what-a-source-said.md` rule 5 says.
- **Mail rows** follow the record's rows, newest first, numbered on from them, each cited by its mail folder and subject (`shared/matter-mail.md`, "Where the content goes"). The line above them says how many forum messages were read and from what date, or that the mail was not read and why.
- **The premise** is the dated step the passage relies on, as the practitioner's instruction or the record names it. When it is a direction on the list, its date is that direction's date.
- **The flag is by date alone.** A direction dated after the premise ends `after the premise`. One dated the same day ends `same date as the premise`. With no premise date on record, no row is flagged, and the premise line says so.
- **Never interpret.** Never say what a direction means, whether it overtakes the premise, whether an earlier deadline still binds, or whether any date has passed. Never compute anything from a date. Comparing two dates as earlier or later is the whole of the date work here (`shared/deadline-isolation.md`).
- **Propose nothing.** No rewording, no argument, and no answer to a direction (`shared/paralegal-posture.md`).

## 5. A flag becomes an open question on the Writing

When the passage is written while any direction stands flagged, record through `/drafting-data` an open question (🕵️) on that passage. Its ask names each flagged direction by date, author and citation, never by its operative sentence, which may set a date: `Later direction on record: <date>, <author>, <citation>. Does this passage still stand?`, the citation being the row's own, a file and locator or a mail folder and subject. It renders on the mockup for the practitioner and is withheld from the forum, like every work marker. Only the practitioner clears it, by saying the passage stands or by changing it. The session never clears it on its own reading.

A direction's operative sentence is never copied into a job's title, intent, plan or steps, a captured idea, or a handover, because it may set a deadline (`shared/deadline-isolation.md`, "Never persist it").
