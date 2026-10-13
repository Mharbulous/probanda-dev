---
name: TLDR
description: "Explicit invocation only. Runs when the user types /TLDR: prints a horizontal rule, then a short summary of this session for a person who has read none of it. Everything before the latest /TLDR is then treated as unread by the user."
disable-model-invocation: true
---

<!-- probanda v0.1.4 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# /TLDR

Write for a person who has just sat down at this session and has read none of it. They are intelligent, and they may not know this project's terms.

## Step 1: mark the boundary

Before anything else, output a horizontal rule on a line of its own (three hyphens in markdown). Everything above the rule is what the user is assumed not to have read.

## Step 2: write the summary

Use these six headings, in this order. Use plain words, and define every project term the first time it appears.

1. **What this session is for.** The goal, in one or two sentences.
2. **What has been done.** Each finished piece of work with its result: committed, pushed, tested, or run, and on which data.
3. **Tangents.** Each side path taken, why it was taken and how it ended. Write "none" when there were none.
4. **Where we are now.** The current task and how far along it is, given as steps done out of steps known. Do not guess a percentage.
5. **Waiting on you.** Every decision, approval or manual step that only the user can do. Write "nothing" when there is nothing.
6. **Not verified.** Anything stated above that rests on an assumption.

Rules for the summary:

- Lead with the present state, not the history.
- Report outcomes faithfully, including failures.
- Do not run tools to build the summary. Summarise the conversation, and mark as unverified anything that may have changed since it was last checked.
- If earlier parts of the conversation were replaced by an automatic summary, say that this summary rests on it.
- Keep it to one screen where the session allows.

## Step 3: hold the marker

From this point on, assume the user has read nothing, and knows nothing, that appears before the latest `/TLDR`.

- Never write "as I said above", and never point to an earlier message, label or decision without restating it.
- Define again any term that was coined before the marker.
- Restate any earlier fact that a later answer depends on.
- The user knows what they write after `/TLDR`, and what you write from the summary onward.
- A later `/TLDR` moves the marker forward.
