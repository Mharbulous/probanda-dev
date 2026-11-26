---
name: run-localize-helper
description: "Internal: runs the localize-helper agent. Dispatched only by /localize; pass the helper's JSON argument object as args."
context: fork
agent: lawyer:localize-helper
user-invocable: false
---

Your brief, from the /localize run that called you:

$ARGUMENTS

Carry it out as your agent instructions say, and return only the output they specify. If the brief above is empty, return one line saying no brief was given.
