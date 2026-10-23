# Spec: Small tool mismatches that cost a round trip each (low priority)

Status: proposed, 2026-10-23. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` data server. Paths below are **UNVERIFIED** against the repo unless marked otherwise.
Related specs: none. Land last; skip if time is short.

## 1. Problem
Four retries in the observed session came from tool parameters that differ from tool to tool without the descriptions saying so. Each cost one wait.

## 2. Evidence (observed, verbatim where recorded)
- matter_data__query takes `matter_root`; drafting_data__query rejects `matter_root` and wants `db_path`. The two gatekeepers for the same matter take different root parameters.
- Host-side tools (pdf_pages__images and others) need a Windows path; a container path returns "not_found" without saying that the path style is the problem.
- drafting_forms__render rejected `proceeding_id` when `filing_id` and `documents` were also given; the description does not say they are exclusive.
- A query against the parties table failed on a column ("role") that does not exist; the description does not say which columns describe counsel (lawyer_name, lawyer_firm, lawyer_email).

## 3. Goal and non-goals
Goal: each tool description says what it takes, so a session gets it right the first time.
Non-goals: renaming parameters that other code depends on, unless the change is trivial.

## 4. Design
- Let drafting_data tools accept `matter_root` as well as `db_path` (derive the path), or state the difference in both descriptions.
- Host-side tools that get a non-Windows path return an error that says "this tool takes a Windows path" rather than "not_found".
- render's description states which parameters are mutually exclusive.
- matter_data__query's description, or the schema reference it points to, names the counsel columns on the parties table.

## 5. Constraints that must still hold
Internals stay confidential in anything the practitioner sees; error text is shown to agents, not practitioners.

## 6. Options considered
1. Fix descriptions and error text (recommended). Small and safe.
2. Unify parameters across gatekeepers. Larger; later.

## 7. Implementation plan
1. Verify before building (§10).
2. Make the four changes.
3. Tests where a code path changed (the root-parameter acceptance and the path-style error).
4. Commit and push. Finish with "Implementation of Small tool mismatches complete!", then what you verified and what you assumed.

## 8. Implementation criteria
1. Each of the four mismatches is either removed or named in the tool's description or error text.

Scope: as in Spec A §8 (2026-10-23_bare-email-request-fast-path-spec.md).

## 9. Open questions
None.

## 10. Verify before building
Confirm each of the four behaviours against the current tool definitions; drop any that no longer occur.
