# Matter mail

Shared doctrine for reading a matter's correspondence from the practitioner's mailbox. It is not a skill: it has no `SKILL.md` and is never wrapped. It ships inside the `skills/shared/` tree of every Probanda plugin. Every skill that reads matter mail follows it before any other mail step: `/find-document`, `file-review-prep` and `/ingest`. Decision record: `/matter-data`'s design decision #77.

Scope: mail filed in a matter's mail folder, received or sent. The time-tracking sent-mail source that build-timeline reads keeps its own folders and rules, and nothing here changes them.

## The route

Matter mail is read only through the lawyer plugin's mail tools, which read the practitioner's mailbox over IMAP with the credential set once through `mail__configure_credential`. ToolSearch them when they are deferred. On a remote-device host their names carry the host's prefix: use the trailing `mail__*` name as the operative name. The practitioner's environment note (`/practice-data`, Practice quirks) says which mailbox the tools read and why, and which mail folder trees hold matter folders. Relay what it says when the practitioner asks why mail is read this way.

## Never a browser

These tools are the only route to matter mail. Never fall back to a browser (Outlook on the web, iCloud web mail, any other webmail), to Outlook desktop automation, or to any other mail connector, even when the route fails.

When the mail tools are not in the session, or a call fails because the mailbox cannot be reached or no credential is set, say so in one line, name the folder you were about to read, and stop reading mail. The rest of the task may go on without mail, saying what was not read.

## Finding the matter's folder

Use every folder path exactly as `mail__list_folders` returns it. Never retype one: folder names can hold a double space.

1. **Recorded folder.** Ask `/matter-data` for the matter's mail folder (its mail-folder operation). When one is recorded, check it with `mail__folder_status` before the first read in the session, and read it. When the check says the folder does not exist, say so and go to step 2.
2. **No recorded folder.** Call `mail__list_folders` once, with no `prefix`. A `prefix` matches the leading text only, so `3. OPEN  FILES` would also return `3. OPEN  FILES (This computer only)`. Look for folders whose last path segment carries the matter number (`/practice-data`'s `matt_num`) as a whole token, so that matter 12 never matches a folder for matter 123. Match on the matter number only, never on a client name. When the environment note names the trees that hold matter folders, search them in its order: a folder is under a tree only when its path is the tree's path followed by the separator the list uses, and the first tree with a match wins. The note lists each tree before any copy of it, such as a "(This computer only)" sibling, so the unsuffixed tree wins over its copy. When the note names no tree, match against every folder in the list.
   - **One match in the winning tree, or in the whole list:** use it. Name it, and name each folder for the same matter in a later tree that was passed over.
   - **Several matches:** name each one and ask which is the matter's folder.
   - **No match:** say which trees, or that the whole folder list, were matched against which matter number, and stop reading mail.
3. **Record it.** Check the chosen folder with `mail__folder_status`, then ask `/matter-data` to record it as the matter's mail folder, and say what was recorded. A folder the practitioner names in place of it is checked and recorded the same way. When the matter has no case database, say that the folder was not recorded. A skill that writes nothing skips recording the folder and says that it was not recorded.

## Reading

Search one folder per call with `mail__search_emails`, by sender and date. A search does not include subfolders. Read a message with `mail__get_email` only when its headers do not answer the question. Never search every folder, so never call `mail__find_email_by_message_id`, which does. `mail__find_thread_messages` and `mail__get_latest_emails` are read tools too. `mail__download_attachment` is used only when the practitioner asks for an attachment, with `save_dir` inside the open matter folder.

Never call a mail tool that changes the mailbox in a read: `mail__save_draft`, `mail__create_folder`, `mail__rename_folder` or `mail__move_messages`, or any send, reply or forward tool. Every read opens the folder read-only, so it marks nothing read.

## Where the content goes

Matter mail content stays in the matter session. It is never written into a plugin or repository file, a memory file, the environment note, any shared pool, or another matter's files. Cite a message by its date, sender, subject and folder.
