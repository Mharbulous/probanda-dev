# Answer grades — hunch, recommendation, advice

This file is the single source of truth for how a skill or agent labels a
proposed answer by what it rests on. Every skill that grades an answer points
here; none restates the table.

Three grades, ranked strictly by what was consulted — never by how confident the
answer sounds, how many times it has been revised, or who is speaking.

| Grade | Meaning | What it rests on | Test |
|---|---|---|---|
| **Hunch** | A first impression drawn only from what the model already knew before this session began. | Nothing in this session was consulted. | Could this have been said before opening a single file, running a single tool, or reading a line of the conversation? |
| **Recommendation** | An answer formed from information already within reach. | The repository, the matter's files, tool results, the conversation — whatever was already on the shelf. | Was it formed after reading what was available, without sending a separate agent off to research the point? |
| **Advice** | A recommendation that has been checked carefully against everything within reach **and** is backed by targeted research from a separately-spawned agent working independently. | Everything within reach, plus that agent's own findings on the specific point. | Did a separate agent contribute evidence on this point, and was that evidence reviewed before the answer was given? |

For a view of the law, the only grade outside the research-agent is **hunch**, whatever it rests on (`shared/legal-research.md`).

## The grade only goes up

The grade describes the answer at the moment it is stated. A hunch that is then
checked against the files becomes a recommendation. A recommendation that
survives an independent agent's review, with evidence, becomes advice. An answer
never drops a grade, and it never skips a step: reading the files is not
research, and a second agent that merely agrees without adding evidence does not
turn a recommendation into advice.

## Who counts as an independent research agent

A separately-spawned agent that brings its own evidence to the specific point:
an independent reviewer spawned on the most capable available model (Fable,
where available); the `research-agent` agent, or whichever law-audit agent the
legal research gate dispatches; `law-getter` returning retrieved
authorities; or an Explore or Plan agent given this one point to investigate. An
agent that only re-reads what the caller already read does not count. The test
is independent evidence on the point, not a second pair of eyes.

## What the grade is not

- **Not a confidence level.** A hunch can be stated confidently; advice can carry
  heavy caveats. Confidence is reported separately (for example, the legal audit
  protocol's confidence summary).
- **Not a workflow status.** "Awaiting review", "corrected", "superseded",
  "confirmed by user" describe where an item is in a process. They are not grades.
- **Not permission to act.** A recommendation is still not a decision. A decision
  is made by the user, or by a skill's own autonomous-decision rules where they
  apply. The grade says what an answer rests on, not whether anything may be
  built on it.

## How to report the grade

Any skill or agent that puts a proposed answer to the practitioner labels it with
its grade, unless the surrounding protocol already makes the grade obvious. Plain
prose is fine: "my recommendation is…", "that's only a hunch — I haven't opened
the file". A report format that uses a fenced block carries the grade in its
header line. A bare "I think…" with no grade is the pattern to avoid.

## Example

Asked how a job should name the filing it belongs to:

1. "Probably a filing id in the job's header" — said before opening any file.
   A **hunch**.
2. The same answer, given after reading the database schema and the handover
   skill. A **recommendation**.
3. An independent reviewer reads the schema itself, points out that the id
   renumbers whenever the database is rebuilt, and proposes adding a stable
   natural key; the answer is corrected on that evidence. **Advice**.
