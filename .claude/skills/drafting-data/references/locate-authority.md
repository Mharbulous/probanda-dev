# Locate an authority's own text

Owned by `/drafting-data`. Finds the file on disk that holds one `authorities` row's own text, so a caller can pass that path on (for a verbatim check, to `/verify-law`). It reads one row and lists the matter's `6. LAW` tree. It writes nothing, and it never opens, converts or hashes the file: making a file readable is `/matter-data`'s job. There is no path or hash column to consult, so identity is by filename only, and the report says so.

## Inputs

`db_path` and `matter_root`, both returned by `drafting_forms__open_session`, and the authority's `id`.

## Procedure

1. `drafting_data__query` the row's `citation`, `style_of_cause_or_title`, `kind` and `url_or_locator`.
2. **Stored locator.** If `url_or_locator` is an absolute path to a file that exists, return it. Arm: `stored locator`.
3. **Filename match.** Otherwise list `6. LAW` and everything under it, in the matter folder as this session sees it. `matter_root` is a host path: in a Cowork session, glob the mounted matter folder instead, and use `matter_root` only to name the folder in the report (Configuration: a `C:\…` listing there is unproven). Try upper and lower case, since a mounted filesystem may be case-sensitive.
   - `kind = case`: filenames containing the neutral citation, spaced or unspaced (`2026 BCCA 74`, `2026bcca74`).
   - Statute, regulation or rule: the citation's chapter or regulation number (`168-2009`), or the title's distinctive words, never "Act", "Regulation", "Rules" or "British Columbia" alone.
   - Skip files named `* ML re *`, `*research-lawyer answer*` or `*memo*`: they cite the authority but are not its text. Filter by filename only, never by folder, because the authority files sit in the same folder as the answer.

   Arm: `filename match`. Read nothing else in the tree, and do not widen the search after a miss.

## Report

Always return the arm, the folder searched (`<matter_root>\6. LAW`), each pattern tried, and `no hash identity: matched by filename`.

- **One match**: its path.
- **Several**: every candidate. The caller asks the practitioner to choose. Never pick one yourself.
- **None**: no path, the folder and patterns only. Never a guess. On a miss you did not expect in a Cowork session, suspect a stale mount before reporting absence (the root `CLAUDE.md`, "Cowork Sandbox FUSE Staleness").

A title match locates a file. It does not prove the file covers the passage: an extract titled for Parts 1-9 holds no Part 14 rule. The caller's check reports that, not this operation.
