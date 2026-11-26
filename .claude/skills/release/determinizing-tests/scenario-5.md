# Scenario 5: Shared skill change, not rebuilt

## Input

Clone at cc362afc plus one local commit appending a line to source/skills/shared/answer-grades.md. The clone is a scratch copy of probanda-dev; it runs that commit's own `scripts/`.

## Expected behavior

--check exits 1 and names all seven plugins as stale (shared/ is copied into every plugin). release_changes.py lists nothing (plugins/ unchanged, no server source changed). Release set: all seven plugins.
