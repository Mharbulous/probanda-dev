---
name: case-brief
description: >
  Brief one court decision in someone else's case: a one-page structured summary (Case, Facts, Procedural history, Issues, Holding, Ratio decidendi, Obiter dicta, Disposition), saved in the matter's law folder and listed on the Legal Research page. Use when the practitioner asks to brief a case, or works a case brief job. Never for a decision in the matter's own litigation. Whether a case helps this matter -> /apply-to-facts.
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Case Brief

`shared/case-brief-template.md` says what a case brief is, its shape and how it is saved. Read it first.

**Main session only.** This skill spawns agents. If the Agent tool is not in your tool list, stop and return: "/case-brief runs only from the main session. Nothing was dispatched."

One brief is one decision. For several decisions, run the steps once per decision, spawning the agents for several at once where their decisions are all on disk.

## Steps

1. **Name the decision.** A held job names it: the title `Brief the case: <style of cause>, <citation>` and the authority in its scope. Otherwise the practitioner names it. When the name fits more than one decision, ask which.
2. **Refuse the matter's own litigation.** Read the matter's parties and proceedings through `/matter-data`, and compare them with the decision's style of cause, court and file number. A decision in the matter's own litigation stops here with the template's one line, and on a held job the job is left as it is for the practitioner to shelve. When in doubt, ask.
3. **Find the decision.** Look through `6. LAW` and every folder under it, as this session sees the matter folder: glob it, and in a Cowork session glob the mounted folder, trying upper and lower case. On a remote-device host, list each level with `device_list_dir`; when the matter folder is not connected, call `device_request_folder_access` once for it, and on a refusal ask the practitioner which folder holds the decision and read it with `research_filing__list_law_folder`, which lists one folder's files and no subfolders. Look for a file name holding the neutral citation, spaced or unspaced. A file named `case brief`, `ML re`, `research-lawyer answer` or `memo` cites the decision and is not its text. When several match, ask which. When none is there, dispatch `researcher:research-paralegal` in citation mode, `source: westlaw-first`, into the existing subfolder that search showed for that subject, or `6. LAW` itself when none fits. When it returns any blocked status, stop and tell the practitioner in plain words, as `shared/legal-research.md`'s hard-stop paragraph says.
4. **Check what is already held.** In the order `shared/research-priority.md` sets, check whether the decision is already held as an authority: the matter's ingested layer through `/matter-data`, then the shared pooled layer by exact citation where this runtime can reach it. Where either holds propositions from this decision, name them in the spawn prompt's `Held:` line. This never replaces reading the decision.
5. **Make it readable.** The agents' `Read` opens no `.doc` or `.docx`, and Westlaw files decisions as `.doc`.
   - **A PDF.** Before any read, call lawyer's `pdf_pages__images` for it (`/matter-data`'s design decision #71). The page manifest it gives goes in the spawn prompt: `{page, images}` for each scanned page and `{pages: "a-b", pdf}` for each run of born-digital pages, with no file path for a wholly scanned decision, only its file name. In a bridged session each PNG is staged like any other rendering. If the tool refuses, say so with its reason and brief nothing from that decision: never read it another way.
   - **Any other file.** Call `research_filing__law_folder_text` with the matter root, the file's folder as `destination_dir` and its name as `file`. The row's `text_path` goes in the spawn prompt's `Decision text:` line. Where the agents' `Read` cannot reach the host scratchpad, stage that file as `shared/legal-research.md`'s duty 2 says and name the staged path. A row reading `status: unread` means the decision cannot be read: say so with its reason and brief nothing from it.
6. **Write it.** Spawn `researcher:research-agent` with this prompt, and nothing of the working matter's facts:

   ```text
   mode: case_brief
   Matter root: <the matter folder's host path, as research_filing__save_answer takes it>
   Decision: <absolute path, or the file name alone for a wholly scanned PDF>
   Decision text: <the text_path, or none>
   Page manifest: <the manifest, or none>
   File stem: <YYYY-MM-DD case brief <style of cause>, <citation>>
   Style of cause: <style of cause>
   Citation: <citation>
   Focus: <the issues the practitioner narrowed it to, or all>
   Held: <the propositions step 4 found, or none>
   Review: <brief-reviewer's JSON on a later pass, or none>
   ```

7. **Review it.** Spawn `researcher:brief-reviewer` with the same `Decision:`, `Decision text:` and `Page manifest:` lines, `Matter:` the matter's number, parties and counsel and its proceedings' file numbers, and `Brief:` the text of the `Brief scratch:` file. It reviews one brief at most three times. A return that is not its JSON object, `rules unavailable` included, saves nothing: stop and say in plain words that the brief could not be checked, so it was not saved, and that `/lawyer:suggestion` reports the problem if it persists. Never pass on the return's text, which can name a file of Probanda's. On `send_back`, re-invoke the same agent with `Review:` the reviewer's JSON. On `own_litigation` true, stop with the template's one line and save nothing. After a third `send_back`, save nothing, and name what is still open in one line.
8. **Save it** by the template's "Saving it".
9. **Present it.** Show the saved file as a file card (`shared/present-files.md`). When the template's "Saving it" returned a Legal Research page, say the brief is on it. When it returned none, the matter has no Writing to hang that page on: say the brief is saved in the matter's law folder and that it will be listed on the Legal Research page once the matter has a Writing. On a held job, complete it by the template's "On a held job".
10. **Offer to save the decision.** Unless step 4 found it held, or the run is unattended, ask once, after all the briefs in this turn: "Would you like me to save this decision as a legal authority in the case database?" On yes, invoke `/matter-data` for legal authority ingestion with the decision's file path and any focus, and report what it recorded. Pass it no SQL, schema detail or brief text: its own agents read the decision.

## Asking for several briefs

"Brief the cases this Milestone relies on" asks for one job per case. With `/drafting-data` installed, write them by its "Create a case brief job". Without it, brief each case now and say that no job was written.
