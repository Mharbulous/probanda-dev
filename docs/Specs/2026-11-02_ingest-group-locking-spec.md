# Ingest group locking: specification

**Date:** 2026-11-02
**Status:** Accepted, with the decisions in section 13 and the differences in section 14
**Replaces:** the rule that a matter may have only one ingest at a time (G1 and section 2.4 of `2026-10-28_ingest-orchestrator-architecture-spec.md`)

---

## 1. The problem

Today a matter can have only one ingest at a time. If one session is ingesting the CORRESPONDENCE folder, a second session cannot ingest the LAWYER BRIEF folder until the first one finishes, even though the two sets of files have nothing to do with each other. The second session either waits or takes over the first run, which stops the first session's work.

The rule exists for good reasons: it stops two sessions from reading the same file twice, and from writing over each other's records. But it is much broader than it needs to be. Most of an ingest's time goes into reading documents, and reading one document never depends on another.

## 2. The goal

Several sessions can ingest documents into the same matter at once. None of them:

- reads a file that another session is already reading or has already written;
- creates a duplicate of a party, person or document that another session creates at the same time;
- writes over, or builds on a stale copy of, a record that another session has just changed;
- holds up another session for longer than one write takes.

## 3. Terms

| Term | Meaning |
|---|---|
| **Run** | One session's ingest of a set of files into one matter. |
| **Reading stage** | Everything from routing a file to having its extracted results ready to write. Slow: minutes per document. |
| **Writing stage** | Saving one document's results into the matter's case data, plus updating any matter-wide records that depend on them. Fast: usually seconds. |
| **File claim** | A lock on one file's hash within one matter (section 5). |
| **Write lock** | A short lock on the whole matter, held during one write (section 6). |
| **Exclusive lock** | A lock on the whole matter that shuts out every claim and write, for the few operations that need it (section 9). |
| **Matter revision** | A number that goes up by one with every write to the matter (section 7.1). |

## 4. Design overview

Two kinds of lock replace the one lock per matter:

1. **A file claim for each file hash, for the reading stage.** Two runs can read different files at the same time. Only one run can read a given file.
2. **A write lock on the whole matter, held only during one write.** Writes take turns, but each turn lasts seconds. Inside the lock, the writer checks again that nothing it relies on has changed since it read the document.

A third, **exclusive lock**, is kept for operations that change the whole matter at once (section 9).

The run itself stays as it is: each run still has its own record of progress, so a crashed or compacted session can resume. What changes is that several runs may be live on one matter at once.

## 5. File claims (reading stage)

### 5.1 What is claimed

A claim is keyed on **(matter, file hash)**. The hash is the SHA-256 of the file's raw bytes, as today.

- **Same bytes, two paths.** Two copies of the same file in different folders have the same hash, so they share one claim. The second copy is reported as a copy, as today.
- **An email and its attachments.** An email and the attachment files that belong to it are claimed together, all or none, so that two sessions cannot record the same attachment once as a file and once as part of the email.
- **A compound book** (a book split by its bookmarks) is claimed as one file.

### 5.2 When a claim is taken

A run takes the claim when it routes the file, before it starts any reading for it. Taking claims for several files at once is all-or-nothing per file: each file either gets its claim or is reported as taken. Taking one file's claim never waits on another file's.

### 5.3 When a file is already claimed

When another live run holds the claim, the file is **left out of this run, not treated as an error**. The run carries on with its other files. The final report names the file and says it is being ingested in another session.

When the file has already been written (the hash is already in the matter's case data), today's checks for files already held apply unchanged.

### 5.4 How long a claim lasts

A claim lasts until the file's results are written, or the file is closed as failed, or it is set aside, whichever comes first. It does **not** end when reading ends. Otherwise another session could start reading the same file again while the first one waits to write it.

A claim also lasts while a write for that file waits for the practitioner's answer to a question, subject to 5.5.

### 5.5 Stale claims

A claim belongs to its run, and lives only as long as that run's heartbeat. When a run's heartbeat goes stale (no call from that run for 60 minutes), all of its claims become free:

- another run may claim those files afresh; or
- a session that resumes the stale run takes back its claims, unless another run has already claimed a file in the meantime. That file is then reported as taken.

A claim never outlives its run, and no claim is ever broken while its run's heartbeat is fresh.

### 5.6 Reading capacity

At most 10 readers work at once **across all runs on the same computer**, whichever matters they belong to.

## 6. The write lock (writing stage)

### 6.1 Scope and length

The write lock covers the whole matter. A run holds it for **one document's write**, from start to finish, and no longer:

1. take the write lock;
2. re-check (section 7);
3. write the document's results;
4. update the matter-wide records that depend on the write (the matter's evidence dump and procedural history);
5. release the lock.

Each document takes the lock afresh. A run never holds the lock between writes, while reading, while starting readers, or while waiting for an answer from the practitioner.

### 6.2 How it is released

- **Normally:** when the write finishes or fails, at the end of step 5.
- **On a crash:** a lock whose recorded process has died is free at once.
- **Backstop:** the lock carries a holder and a start time, and **expires 5 minutes after it was taken**. That is longer than the slowest holder (2 minutes). Only an expired lock may be broken. The lock is **not** refreshed after each write, and **not** renewed by the run's heartbeat. A session that hangs while alive must not be able to keep the lock.

### 6.3 Waiting for the lock

A run that finds the write lock taken retries after 1 second, then 2, then 4, then 8. If it still cannot get the lock, the write is left queued, exactly as an unwritten result is today. The run's next step lists it again, so nothing is lost and nothing is written twice. The wait across those attempts counts towards the 2 minutes in section 10.

### 6.4 Writing twice is still safe

A repeated write of the same document under the same run still reports that it was already written, as today. The write lock does not change this. It only makes sure two different runs cannot write at the same moment.

## 7. Re-checking at write time

Each run read its documents against the matter as it stood when the reading began. By the time it writes, other runs may have changed the matter. So every write re-checks, **inside the write lock**, everything it relies on.

### 7.1 Matter revision

Each write adds one to the matter revision. A run notes the revision when it reads the matter for a document. If the revision has not changed by write time, the re-checks below can be skipped. If it has changed, they run.

### 7.2 What is re-checked

| What | The risk | At write time |
|---|---|---|
| **The file's hash** | Another run wrote the same bytes. Should be impossible with claims, but the check is cheap. | Hash already written: refuse this write and report the file as already held. |
| **Parties and people** | Two runs each meet the same new name and each create a new party. | Look the name up again in the current case data. If a matching party now exists, use it, and do not create a second one. If the match is uncertain, ask the practitioner (section 8). |
| **Versions of a document** | A draft and the filed copy have different hashes, so neither claim catches the other. Two runs could each keep their copy as the main one. | Run the check for other versions of a held court document again against the current case data. If a version written since reading turns up, hold this write back and send the pair through the usual choice of which copy to keep. |
| **The proceeding** | A document is linked to a proceeding that another run has since changed or merged. | Look the proceeding up again. If it changed, use the current one, or ask if more than one now fits. |
| **Changes proposed by a court order** | The proposed changes (style of cause, trial date, parties, counsel) were worked out against an older state. | Work out the proposed changes again against the current state before showing them, and apply only what the practitioner approves, against that same state. |
| **What a response answers** | The pleading the response answers has since been superseded. | Look the pleading up again. Link to the current copy. |
| **The procedural history** | Two runs add entries for the same event. | Check for an entry for the same event and date before adding one. |

### 7.3 What is not re-checked

The extracted results themselves. Re-checking compares what the run is about to write with what the matter now holds. It never reads the document again.

## 8. Questions to the practitioner

A write that needs an answer (which party a name refers to, which copy to keep, whether a document is privileged, which proceeding) works like this:

1. The run releases the write lock, or never takes it.
2. It asks the question and notes the matter revision the question was based on.
3. When the answer arrives, it takes the write lock and checks the revision.
4. If the revision is unchanged, or changed in ways that do not touch the question, it writes using the answer.
5. If a change touches the question (for example, the party the practitioner picked has been merged, or a new candidate party has appeared), it releases the lock and asks again, saying what changed.

The file's claim (section 5.4) is kept the whole time, subject to 5.5.

## 9. Operations that still lock the whole matter

Some operations change the whole matter at once, and cannot safely run beside any ingest:

- a migration of the matter's case data;
- moving the matter's case data;
- moving its sources from one folder to another.

These take the **exclusive lock**:

- It waits for any write in progress to finish, then blocks new writes and new file claims.
- Runs already reading may keep reading. Their writes queue until the exclusive lock is released, then re-check as usual (section 7). The revision will have changed.
- It is released when the operation finishes or fails, with the same crash release and 5-minute backstop as the write lock.
- A run that wants to start while the exclusive lock is held is told that the matter is busy with a matter-wide change, and to try again shortly.

## 10. What the practitioner sees

Plain wording, with no internal names:

| Situation | Message |
|---|---|
| A file is being ingested in another session | "{file name} is being ingested in another session, so I left it out of this run." |
| A write waited for another session's write | Nothing, unless the wait passes 2 minutes. Then: "Another session is saving to this matter. {file name} will be saved once it finishes." |
| An answer is out of date | "Since you answered, another session added {what changed}. {The question again}." |
| A matter-wide change is running | "This matter is busy with a change that affects the whole file. I'll start the ingest once it finishes." |
| A stale run's files were picked up | "An earlier ingest of {file names} stopped without finishing. I've taken those files into this run." |

## 11. Failure scenarios

| # | Scenario | Outcome |
|---|---|---|
| F1 | Two runs route the same file at the same moment | One gets the claim. The other leaves the file out and reports it (5.3). |
| F2 | Two runs each find the same new party in different files | The first write creates the party. The second write's re-check finds it and uses it (7.2). |
| F3 | Run A has the draft, run B has the filed copy | Different hashes, so both are read. The second writer's version check finds the first and sends the pair to the usual choice of which copy to keep (7.2). |
| F4 | A session crashes in the middle of a write | Its write leaves the case data as it was, and the lock is free at once (6.2). If the process record cannot be trusted, it expires after 5 minutes. The file's claim lasts until the run's heartbeat goes stale, then the file is free (5.5). |
| F5 | A session crashes while reading | Its claims go stale with its heartbeat (5.5). Resuming the run takes them back, unless another run has claimed them meanwhile. |
| F6 | A session hangs but stays alive | It cannot hold the write lock for more than one write (6.1), or for more than 5 minutes even then (6.2). Its claims hold only its own files, so other runs carry on with other files. |
| F7 | A question waits overnight | No lock is held. The claim goes free once the run is stale (5.5). If another run takes the file, the answer is told the file was taken and nothing is written from the first run. If none does, the answer is checked against the current state when it comes (8). |
| F8 | A migration is needed while two ingests run | The exclusive lock waits for the write in progress, then blocks writes. Reading carries on. Writes resume and re-check afterwards (9). |
| F9 | A run resumes after a plugin update | As today: the run stays open across the restart and resumes. Its claims last as long as its heartbeat (5.5). |
| F10 | An email in one run, and its attachment saved separately in another | The email's claim covers its attachments (5.1), so the second run reports the attachment as taken. |

## 12. Acceptance tests

1. Two sessions ingest two folders of one matter with no files in common. Both finish. Neither waits more than a few seconds in total. Every file is written once.
2. Two sessions are given the same folder at the same time. Every file is read once and written once. Each session's report names the files the other session took.
3. Two files that name the same new person are ingested in two sessions at once. The matter ends with one party for that person, linked from both documents.
4. A draft and a filed copy of the same pleading are ingested in two sessions at once. The matter ends with one main copy and one superseded copy, settled the usual way.
5. A session is killed in the middle of a write. Within 5 minutes (at once, where its process has died), another session can write. The killed write left nothing behind.
6. A session is killed while reading. After the stale time limit, another session can claim and ingest its files. Resuming the killed run does not read them a second time.
7. A participant question is answered after another session has merged the chosen party. The question is asked again, saying what changed. Nothing is written under the old answer.
8. A matter-wide change is started while two ingests are running. It waits for the write in progress, runs, and both ingests then finish correctly.
9. Ten writes from three sessions arrive in the same second. All ten are written, one at a time. None is written twice and none is lost.
10. With two runs on one computer, no more readers run at once than the per-computer limit.

## 13. Decisions

1. **Reading capacity.** The limit applies per computer, across all matters.
2. **Stale time limit.** It stays 60 minutes. Extractors make no call between starting and finishing a document, so a shorter limit could free a file a healthy session is still reading.
3. **Waiting for a claim.** A run never waits for a claimed file. It leaves the file out (5.3).
4. **Several computers.** A matter is ingested from one computer at a time. The skill says so and nothing enforces it, because locks live on one computer and no lock file can cover a synced folder.
5. **A question waiting overnight.** Section 5.5 governs. A claim held open for a question for more than 60 minutes would otherwise let a crashed session block a file.

## 14. How the build differs from the proposal

1. **The wait is split across calls.** A bridged session gives up on a tool call at 60 seconds, so one write waits at most 15 seconds, then stays queued. The 2 minutes in section 10 is counted across calls from the run's journal.
2. **No evidence summary exists.** The nearest record is the evidence dump, which each write already rewrites under the lock, so rebuilding it is not a separate operation.
3. **Merging parties or proceedings has no tool of its own.** A merge done in one write holds the write lock for its whole length and advances the revision, so waiting runs re-check.
4. **Resume moves a run, claims included.** Tools carry no session identity, and a session that has just compacted may have lost its run's id while the heartbeat is still fresh. So a live run can still be resumed, and the session that held it is told to stop. A claim moves with its run and never passes to a different run. The status call lists every unfinished run with its file names, so a session can pick its own, and it asks the practitioner when it cannot tell.
5. **The matter revision is a local counter.** It sits beside the matter's lock file on this computer, needs no schema change and adds nothing to a legacy store. It advances just before each write, under the lock, so a crash can cause an extra re-check, never a missed one.
