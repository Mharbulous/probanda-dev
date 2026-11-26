# Scenario 3: Source changed and not rebuilt

## Input

Clone at commit f47f13b9 (source and server src changed, plugins/ not yet rebuilt). The clone is a scratch copy of probanda-dev; it runs that commit's own `scripts/`.

## Expected behavior

--check exits 1 and names the stale plugins. release_changes.py lists `rebuild:` lines for the changed server folder. The release set is the union of the stale plugins and the rebuild owners.
