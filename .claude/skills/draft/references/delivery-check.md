Read when: a letter's `Deliver` job is open at the opening, `/ingest` hands over an ingested letter, the Sent write refuses with `sent_copy_mismatch`, the practitioner asks whether a letter went out or arrived or says a client letter did, or the session is about to ask them that.
Assumes SKILL.md is loaded. Rules are not restated here.

# Delivery check

## 1. The rule

Never ask the practitioner whether a letter was sent, delivered or received, in any wording, until the `lawyer:delivery-checker` agent has checked that letter. The letter's own face says how it was sent, so the evidence is looked up first. After the check, ask only about what its result lists under `could_not_determine`, and name in the question what was checked and what could not be (section 5).

The agent only reads. This session acts on its result, updates the draft, records the letter as sent and shows the files. The result is used in this session and kept nowhere: no table, no file and no note holds it. The only lasting memory that a letter went is the Sent write on its Writing, which closes its `Deliver` job and so ends the opening check below, or for a client letter the history entry the practitioner's word adds (`references/letters.md` section 10). A letter with no Writing is simply checked again whenever one of the triggers fires.

## 2. When to run it

- **At the opening**, after the fast open's lines and the idle report, when the open Writing is a letter whose `Deliver` job the `live` lane does not show completed. Search the matter's correspondence folder, as `/find-document` step 1 searches, for a dated or signed copy of this letter: the same addressee and subject, dated on or after the draft's date. A file ending ` UNSIGNED.pdf` is not one. With no such copy, run nothing and say nothing. With more than one, check the newest.
- **Before any question** about whether a letter went out or arrived (section 1).
- **On `sent_copy_mismatch`** from the Sent write, when the copy passed has not been checked yet.
- **When the practitioner asks** for a letter to be checked, for any letter file in the matter, or says a client letter went.
- **When `/ingest` hands over an ingested letter**, with its path. First look for the open Writing it came from: ask `/drafting-data` for the matter's general Writings that are neither sent nor retired, with each one's title, `To` recipients, and stored RE line and date. A Writing matches when the letter goes to the same recipient and either has the same subject or is dated on or after the Writing's stored date. A file ending ` UNSIGNED.pdf` matches none. When several match, take the one nearest in subject and date, and ask one question only when two tie. Then dispatch for the letter (section 3), with the matched Writing as `draft`, or with no `draft` when none matched, and act on the result (section 4). This runs the check only: it claims no job and invokes no `/work`.

Without `/ingest`'s hand-over, an ingested letter is checked by `/matter-data` at its ingest, not here. An unattended run never runs the check: it reports that the letter's delivery was not checked.

## 3. Dispatch

Spawn `lawyer:delivery-checker` once for the letter, each time a trigger fires, with the fields below. In a bridged session (`/matter-data`'s verify-law operation §2 defines it), the checker cannot see the matter folder, so it checks the sent mail only: also pass `sent_mail_only: true`, stage the letter and each PNG of its page manifest by that §2's staging rule, and pass the staged paths as `letter_path` and in the manifest, its `pdf` entries included. Staging copies the file into the session (Commandment 3). Stage only what the step needs. A staged copy stays with the session until the session is deleted. `file_name`, `file_size` and each manifest's `path` stay the letter's own. Where the letter cannot be staged, dispatch nothing: report in one line that the letter's delivery was not checked, with the reason.

   - `matter_root`, `letter_path`, `file_name`, and `file_size`, the file's size in bytes;
   - `environment_notes`: the practitioner's environment notes, as this session was given them (`/practice-data`, "Practice quirks");
   - `page_manifests`, when the letter is a PDF: call `pdf_pages__images` for it first and pass its page manifest as `{path, pages}`, with `path` the letter's path relative to `matter_root`. The manifest is `{page, images}` for each scanned page and `{pages: "a-b", pdf}` for each run of born-digital pages. A scanned page is read only from its images (`/matter-data`'s design decision #71). If the tool refuses, dispatch nothing: report that the letter's delivery was not checked, with the refusal's reason;
   - `draft`, when the letter is a Writing on this board: `writing_id`, `mockup_path` (the letter's copy from the latest render), `addressee`, `subject` and `date` as the mockup prints them, and `last_changed`, the latest stamp the letter's job cards show (`board_card(jobs: [N])`), left out when they show none.

## 4. Acting on the result

Do these in order. Nothing in this section asks the practitioner anything.

1. **Page images first.** When the result is refused with the reason `needs page images`, a check's `note` is exactly `needs page images`, or `draft.sync_blocked_by` is exactly `needs page images`, call `pdf_pages__images` for the letter, for each PDF such a check names as a `file` pointer, and for the PDF at `draft.sent_text_source`, as each applies. The checker returns each `file` pointer and `sent_text_source` relative to `matter_root`: resolve it against `matter_root` before you call the tool, which takes an absolute path. Stage each PNG as section 3 says. Dispatch the checker once more with the letter's and every such PDF's manifest, each keyed by the same relative pointer the checker returned, and act on the second result only. There is no third dispatch: a check still marked that way is reported as not checked, and a draft still blocked that way is left as it is. A refusal from the tool is reported with its reason, and that PDF stays unread.
2. **Report.** One line per stated method: the method, whether it was confirmed sent and confirmed delivered, and for anything not confirmed what was searched. A `could_not_check` is reported as not checked, with its reason, never as not sent. Never state a deadline, a deemed date of service or how long remains from a sent or delivered time (`shared/deadline-isolation.md`).
3. **No draft, as with a client letter, which has no stored text and no Sent write, or `draft.is_this_letter` false.** Stop here.
4. **`draft.sync_allowed` false.** Leave the draft and the `Deliver` job as they are. Say in one line why, from `sync_blocked_by`: no method was confirmed sent, the draft was changed after the letter went and may be a follow-up letter, or in a bridged session the draft could not be compared with the letter. Stop here.
5. **`draft.differs` true: update the draft to the letter as sent.**
   1. If the `live` lane shows a job on this letter in progress in another session, change nothing: say so in one line, naming the job, and stop here.
   2. Save the draft as it stood: copy the letter's mockup copy into the letter's Writing folder (SKILL.md section 13) as a new file, `<mockup name> before sent update.md`, at the next free ` vN` name if that exists. Never overwrite one.
   3. Replace the letter's stored text with the text of the file at `draft.sent_text_source` (a PDF read through its page manifest, a scanned page only from its PNGs), paragraph for paragraph and changing no word, through `/drafting-data`'s write for a general Writing's prose rows and clauses.
   4. Render the mockup (SKILL.md section 11).
6. **Record the letter as sent**, when a stated method is confirmed sent: `/drafting-data`'s Sent write, with the date of the earliest confirmed send as `sent_on` and `draft.sent_text_source` as the copy. A refusal is handled as `references/letters.md` section 8 says, except that `sent_copy_mismatch` after step 5 is quoted in one line and stops: never ask which text is right, and never retry. On a staff machine, name the signing lawyer and stop.
7. **Carry counsel's review forward after a sync.** When step 5 updated the draft and step 6 recorded the letter as sent, the letter as sent stands as counsel's review of its text: write `/drafting-data`'s carry-forward approval (its Sent write, "Counsel's review carried forward"), then render the mockup (SKILL.md section 11), so the board no longer counts `counsel-review` against the letter. Never carry it for a letter that is not recorded as sent.
8. **After a sync, show both versions and say so.** Present two file cards in one call (`references/present-files.md`): the draft as it stood (step 5.2's file) and the letter as sent. Then one line: the Work Board draft was updated to match the letter as sent, and whether it is now recorded as sent. Show both cards every time a draft is updated this way.
9. **Keep nothing.** Write the result to no database, file, job, idea or note. It is done with once this section has run.

## 5. The question, when one is still needed

Ask only when the result's `could_not_determine` is not empty, one question per `/show-me`, with the letter's file card. The question says what was checked, what could not be checked and why, and asks only for that. For example: the firm account's sent folder was searched for the letter's date and the 2 weekdays after it and nothing was found, and the fax log could not be opened, so was the letter faxed?

Never ask about a method the result holds as confirmed, and never ask before the check has run.

## 6. Environment notes

When the result's `environment_notes` is `missing` or `stale`, the practitioner's notes do not say where sent mail is kept. Once per session, offer to record it, by `/practice-data`'s "Practice quirks" write rule: which mail folder holds which account's sent mail, that a mirror account's copy is not a second sending, and that a whole-mailbox search times out. Write nothing without that rule's explicit yes.
