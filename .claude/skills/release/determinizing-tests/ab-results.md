# A/B Test Results: release vs release-hardened

Date: 2026-11-26
Model: sonnet (general-purpose subagents, background, strictly sequential A1, B1, A2, B2, A3, B3)
Trials per skill: 3
Skill A path: .claude/commands/release.md (repo root probanda-dev)
Skill B path: .claude/skills/release-hardened/SKILL.md (repo root probanda-dev)

Test input: scenario 3 (scratch clone at f47f13b9). Every trial got a byte-identical prompt body, scoped to Steps 2–3 with no build, commit or push. The only difference was a final configuration line naming the procedure file, because a general-purpose subagent cannot take a skill as a launch setting. Metrics come from each subagent's JSONL transcript (assistant messages deduplicated by message id).

## Raw Trial Data

| Trial | Duration (s) | API calls | Tool uses | Input context | Cost |
|---|---|---|---|---|---|
| A1 | 71.4 | 10 | 10 | 972,437 | n/a |
| B1 | 35.9 | 4 | 3 | 360,103 | n/a |
| A2 | 87.0 | 13 | 13 | 1,276,135 | n/a |
| B2 | 30.1 | 4 | 3 | 358,612 | n/a |
| A3 | 59.4 | 8 | 8 | 759,765 | n/a |
| B3 | 32.7 | 4 | 3 | 359,067 | n/a |

## Summary Statistics

| Metric | A mean±std | B mean±std | Delta | Delta % | Significant? |
|---|---|---|---|---|---|
| Duration (s) | 72.6±13.8 | 32.9±2.9 | 39.7 | 54.7% | YES |
| API calls | 10.3±2.5 | 4.0±0.0 | 6.3 | 61.3% | YES |
| Tool uses | 10.3±2.5 | 3.0±0.0 | 7.3 | 71.0% | YES |
| Input context | 1,002,779±259,519 | 359,261±764 | 643,518 | 64.2% | YES |

All four differences favor B.

## Variance Comparison

| Metric | std A | std B | Lower |
|---|---|---|---|
| Duration (s) | 13.8 | 2.9 | B |
| API calls | 2.5 | 0.0 | B |
| Tool uses | 2.5 | 0.0 | B |
| Input context | 259,519 | 764 | B |

release-hardened has lower variance in 4/4 metrics.

## Functional Equivalence

Every trial reached the same decision (continue), the same release set (lawyer, litigator, file-manager, billing), the same source for each plugin, the same last bump (cc362afc) and the same rebuild commands (tsc, then bundle.mjs for source/lawyer/mcp).

The change sets differed only in A:
- A1 and A3 put the 4 `source/lawyer/mcp/src/` files in the file-manager and billing change sets and listed the 3 `test/` files apart as "also changed". A2 included them.
- A2 also put the built copy `plugins/litigator/skills/publish/scripts/emphasis.py` in litigator's change set. A1 and A3 named it only as the file the `released:` line counts.

All three B trials printed byte-identical change sets. B1's prose report misquoted one line of the script output and corrected itself in the same report, a transcription slip with no effect on the result. The differences are minor, and B is the more consistent under the original's own rule ("its skills, `source/skills/shared/`, `source/P/`, and the servers it ships").

## Decision

Equivalent, and every metric significantly favors B: **Recommend B. Hardening improved measured behavior without degradation.**
