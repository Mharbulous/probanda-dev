Read when: a letter's `Deliver` job is open at the opening, the Sent write refuses with `sent_copy_mismatch`, the practitioner asks whether a letter went out or arrived, or the session is about to ask them that.
Assumes SKILL.md is loaded. Rules are not restated here.

# Delivery check

## 1. The rule

Never ask the practitioner whether a letter was sent, delivered or received, in any wording, until the `legal:delivery-checker` agent has checked that letter. The letter's own face says how it was sent, so the evidence is looked up first. After the check, ask only about what its result lists under `could_not_determine`, and name in the question what was checked and what could not be (section 5).

The agent only reads. This session acts on its result, updates the draft, records the letter as sent and shows the files. The result is used in this session and kept nowhere: no table, no file and no note holds it. The only lasting memory that a letter went is the Sent write on its Writing, which closes its `Deliver` job and so ends the opening check below. A letter with no Writing is simply checked again whenever one of the triggers fires.

## 2. When to run it

- **At the opening**, after the fast open's lines and the idle report, when the open Writing is a letter whose `Deliver` job the `live` lane does not show completed. Search the matter's correspondence folder, as `/find-document` step 1 searches, for a dated or signed copy of this letter: the same addressee and subject, dated on or after the draft's date. A file ending ` UNSIGNED.pdf` is not one. With no such copy, run nothing and say nothing. With more than one, check the newest.
- **Before any question** about whether a letter went out or arrived (section 1).
- **On `sent_copy_mismatch`** from the Sent write, when the copy passed has not been checked yet.
- **When the practitioner asks** for a letter to be checked, for any letter file in the matter.

An ingested letter is checked by `/case-data` at its ingest, not here. An unattended run never runs the check: it reports that the letter's delivery was not checked.

## 3. Dispatch

Spawn `legal:delivery-checker` once for the letter, each time a trigger fires, with:

   - `matter_root`, `letter_path`, `file_name`, and `file_size`, the file's size in bytes;
   - `environment_notes`: the practitioner's environment notes, as this session was given them (`/practice-data`, "Practice quirks");
   - `draft`, when the letter is a Writing on this board: `writing_id`, `mockup_path` (the letter's copy from the latest render), `addressee`, `subject` and `date` as the mockup prints them, and `last_changed`, the latest stamp the letter's job cards show (`board_card(jobs: [N])`), left out when they show none.

## 4. Acting on the result

Do these in order. Nothing in this section asks the practitioner anything.

1. **Report.** One line per stated method: the method, whether it was confirmed sent and confirmed delivered, and for anything not confirmed what was searched. A `could_not_check` is reported as not checked, with its reason, never as not sent. Never state a deadline, a deemed date of service or how long remains from a sent or delivered time (`shared/deadline-isolation.md`).
2. **No draft, or `draft.is_this_letter` false.** Stop here.
3. **`draft.sync_allowed` false.** Leave the draft and the `Deliver` job as they are. Say in one line why, from `sync_blocked_by`: no method was confirmed sent, or the draft was changed after the letter went and may be a follow-up letter. Stop here.
4. **`draft.differs` true: update the draft to the letter as sent.**
   1. If the `live` lane shows a job on this letter in progress in another session, change nothing: say so in one line, naming the job, and stop here.
   2. Save the draft as it stood: copy the letter's mockup copy into the letter's Writing folder (SKILL.md section 13) as a new file, `<mockup name> before sent update.md`, at the next free ` vN` name if that exists. Never overwrite one.
   3. Replace the letter's stored text with the text of the file at `draft.sent_text_source`, paragraph for paragraph and changing no word, through `/drafting-data`'s write for a general Writing's prose rows and clauses.
   4. Render the mockup (SKILL.md section 11).
5. **Record the letter as sent**, when a stated method is confirmed sent: `/drafting-data`'s Sent write, with the date of the earliest confirmed send as `sent_on` and `draft.sent_text_source` as the copy. A refusal is handled as `references/letters.md` section 8 says, except that `sent_copy_mismatch` after step 4 is quoted in one line and stops: never ask which text is right, and never retry. On a staff machine, name the signing lawyer and stop.
6. **After a sync, show both versions and say so.** Present two file cards in one call (`references/present-files.md`): the draft as it stood (step 4.2's file) and the letter as sent. Then one line: the Job Board draft was updated to match the letter as sent, and whether it is now recorded as sent. Show both cards every time a draft is updated this way.
7. **Keep nothing.** Write the result to no database, file, job, idea or note. It is done with once this section has run.

## 5. The question, when one is still needed

Ask only when the result's `could_not_determine` is not empty, one question per `/show-me`, with the letter's file card. The question says what was checked, what could not be checked and why, and asks only for that. For example: the firm account's sent folder was searched for the letter's date and the 2 weekdays after it and nothing was found, and the fax log could not be opened, so was the letter faxed?

Never ask about a method the result holds as confirmed, and never ask before the check has run.

## 6. Environment notes

When the result's `environment_notes` is `missing` or `stale`, the practitioner's notes do not say where sent mail is kept. Once per session, offer to record it, by `/practice-data`'s "Practice quirks" write rule: which mail folder holds which account's sent mail, that a mirror account's copy is not a second sending, and that a whole-mailbox search times out. Write nothing without that rule's explicit yes.
