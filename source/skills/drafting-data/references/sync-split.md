# A sync conflict split

The file sync keeps a conflict's copies side by side, under names like `submission-<computer name>.sqlite` (Microsoft), `submission (<name>'s conflicted copy <date>).sqlite` (Dropbox), `submission (1).sqlite` or `submission - Copy.sqlite` (Windows). A `submission.sqlite.bak-*` file is a backup, never a copy. Every drafting tool then refuses `sync_conflict_copies`, naming them, and creates or writes nothing. Each copy may hold work the other lacks, and no common ancestor tells an addition in one from a deletion in the other. So nothing merges unless the practitioner decides it.

1. **Stop.** Take no job and write nothing on this matter until step 5.
2. **Compare.** `drafting_data__split_merge` with `op: diff`, given only when exactly two copies stand (the file under its own name counts as one). It writes nothing and lists each record that differs: `only_a`, `only_b` or `differ`, with each copy's values. The revision counter is never asked: the merge takes the higher one.
3. **The practitioner decides each difference.** Show each difference side by side: its table, key, and the columns that differ, a beside b, in plain words. The practitioner says `a` or `b`: that copy's version of the record, its absence included. Never choose for them, and never infer a choice from dates, device names or which copy is larger. Record each answer by the difference's `id`.
4. **Merge.** `op: merge` with the diff's `sha256` list and every decision. It writes `submission-merged.sqlite` beside the copies and never writes, moves or removes a copy. A refusal changes nothing: `split_undecided` names the open ids. `split_inputs_changed` means a copy changed, so compare again. `split_merge_unsound` means a decision orphans a record, so put the decisions on the tables it names back to the practitioner.
5. **Put the folder right.** The practitioner renames `submission-merged.sqlite` to `submission.sqlite` and moves both copies out of `0. CASE DATA` (to the matter's TRASH, or wherever they choose), where they stay recoverable. No Probanda tool does this step. The tools refuse until that folder holds `submission.sqlite` alone. Then open the matter again.

## The file is missing, but earlier work shows

When `submission.sqlite` is missing, session entry and `drafting_data__migrate` create a new one only if nothing shows the matter had drafting records: no `submission.sqlite.bak-*` backup beside it, and no file in the matter's `0. DRAFT` folder that only drafting work writes (a Work Board, Litigation Strategy, Loose Threads or view page, or a file in its `Drafting records` folder). Otherwise both refuse `earlier_work_missing`, name each such file, and create or write nothing, because an empty file would stand in for the real one and the sync could carry it to the other computer.

Tell the practitioner, in plain words, that the matter's drafting records file is missing and which files show it existed. Then, in this order:

1. **Wait.** The file sync may not have finished on this computer. Once it has, open the matter again.
2. **Restore.** If the file does not come back, the practitioner looks for `submission.sqlite` in the sync service's version history for the matter's `0. CASE DATA` folder, or uses the newest `.bak-*` copy, and puts it back as `submission.sqlite`. No Probanda tool does this step.
3. **Merge.** If copies of the file appear instead, the tools refuse `sync_conflict_copies`: follow the steps above.

Leave the files the refusal names where they are: they are the evidence, and the way back.
