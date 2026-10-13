---
name: TLDR
description: "Explicit invocation only. Runs when the user types /TLDR: prints a horizontal rule, then a short summary of this session for a person who has read none of it. Everything before the latest /TLDR is then treated as unread by the user."
disable-model-invocation: true
---

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
