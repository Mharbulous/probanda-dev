# Scenario 1: Nothing to release

## Input

Clone at commit cc362afc (a release commit: all seven plugins bumped). The clone is a scratch copy of probanda-dev; it runs that commit's own `scripts/`.

## Expected behavior

build_plugin.py --check and release_changes.py both exit 0. Report "nothing to release" and stop. Empty release set.
