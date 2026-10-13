---
name: dyu
description: Use when the user's message ends with /dyu or $dyu, and only then. The user types it as the last word of a message, after describing an idea, a question or a request. Restate the user's intent in plain language as an active-listening checkpoint, then stop and wait for the user to confirm before answering, implementing, critiquing, researching or expanding.
---

# DYU

Restate the user's intent in plain language to demonstrate understanding, then stop.

Do not answer the user's question yet. Do not implement, critique, optimize, research, inspect files, or expand the idea yet. Wait for the user to confirm that the restatement is accurate.

If the prompt contains questions, paraphrase the questions and the underlying concern instead of answering them.

If the prompt contains an implementation request, restate the requested change, success criteria, and any explicit constraints instead of starting the work.

Only identify an ambiguity when the user's statement has a bona fide ambiguity: conflicting instructions, multiple plausible meanings, or an unclear required referent. A lack of detail is not an ambiguity. Missing scope, unstated implementation choices, or details that can be decided later should not be called ambiguities.

If there is no bona fide ambiguity, do not mention ambiguity at all.

Any reply amending the restatement is not confirmation: restate with the change and wait.

After the user confirms, continue with the confirmed task in the next response.
