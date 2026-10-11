# Nightly launch

A desktop-app scheduled task, `draft-nightly`, fires at 1:00 am local time (cron `0 1 * * *`) and works through the Writings on its list with unattended runs (SKILL.md section 14), one after another, in its own session. This file is the procedure that task follows. Decided on #1051. Cloud routines are ruled out: they still need this PC and the app on, and the remote bridge has dropped the litigation tools mid-run before.

The task's prompt stays thin: it points the session at this file, carries the list, and names the write actions the runs take, because the desktop app's scheduled-run preamble otherwise tells the run to skip writes the task file does not name.

## The list

The list lives in the scheduled task's own prompt, one entry per line, in the order the practitioner wants them run:

```text
<matter folder absolute path> | <Writing title> | opted in YYYY-MM-DD
```

An entry is the practitioner's instruction that the Writing is still live, standing in for the typed `/draft unattended <Writing title>` of SKILL.md section 14. It stands until the practitioner withdraws it. Only the practitioner opts a Writing in or withdraws it, never inferred.

**Opt-in, withdrawal and retitle** are the three list edits. Opt-in and withdrawal are chat requests in any `/draft` session. The retitle update follows only a retitle the practitioner confirmed (SKILL.md section 12): an entry naming this matter folder and the old title gets the new title in its place, keeping its position in the list and its `opted in` date. It is not a new opt-in, since the standing one carries over, and a Writing with no entry gets no word about the list. For each edit, find `draft-nightly` with `list_scheduled_tasks`, then add, remove or retitle the entry by editing its prompt with `update_scheduled_task`, and report it in one line, which for a retitle names the old and new titles: never silent. Name the task only through those tools, never a storage path. With no scheduled-task tool in the session, hand the practitioner the exact one-line edit and stop that step. A retitle's edit is conditional, since the session cannot see the list: if a line reads `<matter folder> | <old title> | opted in <date>`, it becomes `<matter folder> | <new title> | opted in <date>`, the rest of the line unchanged, and with no such line there is nothing to change. The retitle itself stands.

## Procedure

**Clock.** The host local wall-clock, never a shell or Bash `date` call, which can read UTC. The window reads the first entry's `open_session` `bootstrapped_at` (opening a Writing does no job work); the 2:30 am cutoff reads the latest run's render `rendered_at`. SKILL.md section 14's Clock rule otherwise governs each run's own readings.

1. **Window.** Fired before 1:00 am or at or after 3:00 am local means the app was closed when the task was due and fired it late. Report `Turned away: fired HH:MM, outside the 1:00–3:00 am window. Nothing done.` and stop. An empty list reports `No Writings on the nightly list.` and stops before any clock read.
2. **Runs.** Every entry starts the night active. Pass over the active Writings in list order, one run per Writing per pass, and repeat. Each run executes inline in this session, one at a time, never in a subagent, because a job's step may itself dispatch subagents (`references/job-session.md`, Movers). Each run follows SKILL.md section 14 "Unattended run" exactly: it opens its Writing with `unattended: true` and gets its own session token. A run's token is retired when that run ends, and a lock held under a retired token is never a later run's, so a later run never re-enters an earlier run's stopped job.
   - A run that completes its job keeps its Writing active. Any other end ends that Writing's night: no eligible job, a stop at an obstacle, a lost race, a failed pre-claim check, a title matching no Writing, or a retired Writing.
   - Before each run, if 2:30 am local has passed, start no more. A run already going finishes, since stopping it midway leaves its job locked and half-done.
   - After each run, append its section 14 report verbatim to a scratch file in this session's scratch space.
3. **End.** The night ends when no Writing is active or at the 2:30 am cutoff. Assemble the morning report from the scratch file, never from memory, so a context compaction loses nothing, and stop.

## The morning report

The session's final message, visible in the desktop app's scheduled-task run list:

```text
Nightly /draft, YYYY-MM-DD, started HH:MM, ended HH:MM: <no Writing active | 2:30 am cutoff>
<matter folder name> | <Writing title>: <n> jobs completed; passed over: <job>, <reasons>; or no eligible job
Needs you:
  <matter folder name> | <Writing title> | Job #<n>: left in progress, stopped at <where>
<each run's report, verbatim, in run order>
```

Each passed-over job carries the reasons its `eligible:` line gave. `Needs you:` lists every job left in progress under a run's lock after a stop, and is left out when there are none. A turned-away run's report is its one line, so a skipped night never reads as an empty one.
