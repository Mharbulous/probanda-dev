# Scenario 6: Stop: assignment not cutover

## Input

Clone at cc362afc plus one local commit setting source/assignment.json "status" to "draft". The clone is a scratch copy of probanda-dev; it runs that commit's own `scripts/`.

## Expected behavior

Either script exits 2 with a STOP message about the status. The skill stops and reports the output. No release set.
