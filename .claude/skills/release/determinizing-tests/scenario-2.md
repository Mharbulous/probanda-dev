# Scenario 2: Built plugins committed without a bump

## Input

Clone at commit e3b3c357 ("Rebuild plugins: suggestion check reads older case data; unchecked draft is held"), two commits after the last release cc362afc. The clone is a scratch copy of probanda-dev; it runs that commit's own `scripts/`.

## Expected behavior

--check exits 0. release_changes.py exits 1 and lists `released:` lines (and `rebuild:` lines if the server src changed since the bump). Every listed plugin is released even though --check is clean. Each released plugin gets a change set from its last bump.
