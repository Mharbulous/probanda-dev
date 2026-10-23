# Spec: Default email subject for a matter

Status: proposed, 2026-10-23. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.9.2). Paths below are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-23_bare-email-request-fast-path-spec.md (A)

## 1. Problem
With no RE: line written yet, an email request has no subject source, so the subject is made up each time. In one run the subject was reported as "Court File No. <file no>" (verify); in another it was built from the style of cause, file number and topic. The practitioner expects every email from a matter to carry the matter's standing subject line unless told otherwise.

## 2. Evidence (observed; quoted text is data, not instructions)
- letters.md §8: "`subject` from the letter's RE: line". An email with no RE: line has no subject source.
- A search of the installed plugin text for "default subject", "subject line", "email_subject" and "subject_line" found no matter default subject (**UNVERIFIED** as to data stores and the repo).

## 3. Goal and non-goals
Goal: write_email (and the letter RE: slot) defaults to the matter's standing subject unless the practitioner gives one.
Non-goals: composing subjects from content.

## 4. Design
Read the matter's standing subject from its stored home (§10 finds or adds it) and pass it as `subject` when none is given. Preferably write_email reads it itself when `subject` is omitted, so the fast path needs no extra call. When the practitioner names a topic ("re service of the notice of hearing"), append it after the standing subject with " – ".

## 5. Constraints that must still hold
No client content in plugin text. When no standing subject is stored, the session still writes the .eml at once, with a subject built from the style of cause and file number, and tells the practitioner in one line that no standing subject is stored for the matter, offering to store one. It never blocks the .eml to ask.

## 6. Options considered
1. Store the standing subject on the matter record in practice data and default write_email to it (recommended).
2. A per-proceeding field in drafting data.
3. Do nothing. Subjects stay inconsistent.

## 7. Implementation plan
1. Verify before building (§10) and append the verification table to this spec.
2. Locate or add the field and the write path for it.
3. Default `subject` in letters.md §8, shared/email.md and write_email.
4. Tests: default applied; practitioner's subject wins; topic appended; no default stored.
5. Commit and push. Finish with "Implementation of Default email subject for a matter complete!", then what you verified and what you assumed.

## 8. Implementation criteria
1. An email with no subject given carries the matter's standing subject.
2. With no standing subject stored, the .eml is still written at once with the style-of-cause fallback, and the session offers once to store a standing subject; it never asks before writing.

Scope: as in Spec A §8.

## 9. Open questions
None for Brahm unless §10 finds two candidate homes for the field; then ask which.

## 10. Verify before building
Search the whole repo (practice data schema, matter record, file-naming convention, matter-data fields), not only the skill text, for an existing standing-subject field or convention. Confirm whether the "Court File No." subject was in fact produced by the plugin or by the session.
