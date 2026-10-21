# relocate — move a matter's case data into the matter folder

Read `../shared/conventions.md` first.

A matter set up before `docs/ADRs/0013-per-matter-case-data-inside-the-matter-folder.md`
keeps its case data in the firm-level `0. CASE DATA\<matter_id> <short_name>\`. Every
tool still finds it there. This operation moves it into the matter's own
`0. CASE DATA\`, so the matter folder's grant covers it. Run it only when the
practitioner asks. (A moved or renamed source file is `relocate-source.md`, not this.)

1. **Plan.** Call `matter_data__relocate` with `matter_root` (the live host path,
   §2.2) and `mode: "plan"`. It writes nothing and returns `old_folder`, `target`,
   `files` (each `path` and `size`) and `total_bytes`. A refusal (already in the
   matter folder, no `main.sqlite`, or the matter's `0. CASE DATA` exists and is
   not empty) is reported as it stands.
2. **Approve.** Under `/show-me`, show the old folder, the target, the file count
   and total size. Say that nothing is deleted: the old folder stays until the
   practitioner deletes it. Ask one question: move it?
3. **Apply.** On a yes, call it again with `mode: "apply"`. It copies both pointer
   files aside, copies the whole folder into a staging folder in the matter,
   checks every copy (sha256, and for each `.sqlite` `integrity_check`, per-table
   row counts and `user_version`), and only then renames the staging folder to
   `0. CASE DATA` and rewrites both pointer files.
4. **Report.** On success, report `case_data_dir`, `files_copied`, the pointer
   backups and the old folder's path, which the practitioner may delete once
   satisfied. Reopen any drafting session on this matter before more drafting work,
   and re-plan any migration: an outstanding plan token named the old path. On a refusal, report the check that failed and the staging folder it
   names. The pointer was not changed and nothing was deleted. On
   `relocate_incomplete`, the copy is in place but a pointer file stayed locked:
   report which pointer files were and were not rewritten, and the step the error
   gives to finish (usually replacing a pointer file with its leftover `.tmp`).
