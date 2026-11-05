---
name: case-brief
description: >
  Brief one court decision in someone else's case: a one-page structured summary (Case, Facts, Procedural history, Issues, Holding, Ratio decidendi, Obiter dicta, Disposition), saved in the matter's law folder and listed on the Legal Research page. Use when the practitioner asks to brief a case, or works a case brief job. Never for a decision in the matter's own litigation. Whether a case helps this matter -> /apply-to-facts.
---

<!-- researcher v0.15.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Case Brief

`shared/case-brief-template.md` says what a case brief is, its shape and how it is saved. Read it first.

**Main session only.** This skill spawns agents. If the Agent tool is not in your tool list, stop and return: "/case-brief runs only from the main session. Nothing was dispatched."

One brief is one decision. For several decisions, run the steps once per decision, spawning the agents for several at once where their decisions are all on disk.

## Steps

1. **Name the decision.** A held job names it: the title `Brief the case: <style of cause>, <citation>` and the authority in its scope. Otherwise the practitioner names it. When the name fits more than one decision, ask which.
2. **Refuse the matter's own litigation.** Read the matter's parties and proceedings through `/matter-data`, and compare them with the decision's style of cause, court and file number. A decision in the matter's own litigation stops here with the template's one line, and on a held job the job is left as it is for the practitioner to shelve. When in doubt, ask.
3. **Find the decision.** Look through `6. LAW` and every folder under it, as this session sees the matter folder: glob it, and in a Cowork session glob the mounted folder, trying upper and lower case. On a remote-device host, list each level with `device_list_dir`; when the matter folder is not connected, call `device_request_folder_access` once for it, and on a refusal ask the practitioner which folder holds the decision and read it with `research_filing__list_law_folder`, which lists one folder's files and no subfolders. Look for a file name holding the neutral citation, spaced or unspaced. A file named `case brief`, `ML re`, `research-lawyer answer`, `memo` or `note-up` cites the decision and is not its text. When several match, ask which. When none is there, dispatch `researcher:research-paralegal` in citation mode, `source: westlaw-first`, into the existing subfolder that search showed for that subject, or `6. LAW` itself when none fits. When it returns any blocked status, stop and tell the practitioner in plain words, as `shared/legal-research.md`'s hard-stop paragraph says. A mounted path is only for looking: `Matter root:`, the paralegal's destination and every path a tool takes below are host paths, the matter folder's host path as `/matter-data` derives it joined with the folder's place under the matter folder.
4. **Check what is already held.** In the order `shared/research-priority.md` sets, check whether the decision is already held as an authority: the matter's ingested layer through `/matter-data`, then the shared pooled layer by exact citation where this runtime can reach it. Where either holds propositions from this decision, name them in the spawn prompt's `Held:` line. This never replaces reading the decision.
5. **Make it readable.** Call `research_filing__law_folder_text` with the matter root, the file's folder as `destination_dir` and its name as `file`. The row's `text_path` goes in the spawn prompt's `Decision text:` line.
   - **A PDF whose row reads `ocr_unavailable`** has `Decision text: none`. The agents read it from `Decision:` through `research_filing__research_folder`, each scanned page only from its images.
   - **Any other row reading `status: unread`**, or a refusal such as an HTML page with no text file beside it, means the decision cannot be read: say so with its reason and brief nothing from it.
6. **Write it.** Spawn `researcher:research-agent` with this prompt, and nothing of the working matter's facts:

   ```text
   mode: case_brief
   Matter root: <the matter folder's host path, as research_filing__save_answer takes it>
   Decision: <absolute path>
   Decision text: <the text_path, or none>
   File stem: <the stem the template's "Saving it" chooses, after looking for the case's saved briefs as it says: a saved brief's when the case has one, else YYYY-MM-DD case brief <style of cause>, <citation>>
   Style of cause: <style of cause>
   Citation: <citation>
   Focus: <the issues the practitioner narrowed it to, or all>
   Held: <the propositions step 4 found, or none>
   Review: <brief-reviewer's JSON on a later pass, or none>
   ```

   A return with no `Brief scratch:` line saves nothing: stop and say in plain words that the brief could not be written, and that `/lawyer:suggestion` reports the problem if it persists. Never pass on the return's text, which can name a file of Probanda's.

7. **Review it.** Spawn `researcher:brief-reviewer` with the same `Matter root:`, `Decision:` and `Decision text:` lines, `Matter:` the matter's number, parties and counsel and its proceedings' file numbers, and `Brief:` the text of the `Brief scratch:` file. It reviews one brief at most three times. A return that is not its JSON object, `rules unavailable` included, saves nothing: stop and say in plain words that the brief could not be checked, so it was not saved, and that `/lawyer:suggestion` reports the problem if it persists. Never pass on the return's text, which can name a file of Probanda's. On `send_back`, re-invoke the same agent with `Review:` the reviewer's JSON. On `own_litigation` true, stop with the template's one line and save nothing. After a third `send_back`, save nothing, and name what is still open in one line.
8. **Save it** by the template's "Saving it".
9. **Present it.** Show the saved file as a file card (`shared/present-files.md`). When the template's "Saving it" returned a Legal Research page, say the brief is on it. When it returned none, the matter holds nothing but research results, which have no page of their own: say the brief is saved in the matter's law folder and that the Legal Research page will list it once the matter has a filing, a letter or other work besides its research. When research-agent's return held a `Divergence:` line, say in plain words how the brief differs from what was already held. On a held job, complete it by the template's "On a held job".
10. **Offer to save the decision.** Unless step 4 found it held, or the run is unattended, ask once, after all the briefs in this turn: "Would you like me to save this decision as a legal authority in the case database?" On yes, invoke `/matter-data` for legal authority ingestion with the decision's file path and any focus, and report what it recorded. Pass it no SQL, schema detail or brief text: its own agents read the decision.

## Asking for several briefs

"Brief the cases this Work Board relies on" asks for one job per case. With `/drafting-data` installed, write them by its "Create a case brief job". Without it, brief each case now and say that no job was written.
