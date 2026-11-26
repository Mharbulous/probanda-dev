---
name: run-technical-writer
description: "Internal: runs the technical-writer agent. Dispatched only by /lawyer:suggestion's technical write-up; pass the brief from suggestion_card__write_up_brief as args."
context: fork
agent: lawyer:technical-writer
user-invocable: false
---

Your brief, from the /lawyer:suggestion run that called you:

$ARGUMENTS

Carry it out as your agent instructions say, and return only the output they specify. If the brief above is empty, return one line saying no brief was given.
