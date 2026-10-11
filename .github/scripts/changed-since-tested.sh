#!/usr/bin/env bash
# Decides whether a scheduled test run is needed. Writes run=true|false to $GITHUB_OUTPUT.
# Usage: changed-since-tested.sh <workflow file> <regex of the suite's input paths>
#
# The base is the head commit of the newest earlier run on main whose `test` job actually ran
# (it has steps and passed or failed), so a skipped night or a run blocked before starting never
# counts as tested. The run is skipped only when no file matching the regex changed between that
# base and this run's commit. Any API error fails the step, and the caller then runs the tests.
set -euo pipefail
workflow=$1 inputs=$2
decide() { echo "run=$1" >> "$GITHUB_OUTPUT"; echo "run=$1: $2"; exit 0; }

[ "$GITHUB_EVENT_NAME" = schedule ] || decide true "not a scheduled run"

runs=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$workflow/runs?branch=main&status=completed&per_page=100" \
  --jq ".workflow_runs[] | select(.id != $GITHUB_RUN_ID) | \"\(.id) \(.head_sha)\"")
base=""
while read -r id sha; do
  [ -n "$id" ] || continue
  ran=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id/jobs?per_page=100" --jq \
    '[.jobs[] | select(.name == "test" and (.steps | length) > 0 and (.conclusion == "success" or .conclusion == "failure"))] | length')
  if [ "$ran" -gt 0 ]; then base=$sha; break; fi
done <<< "$runs"

[ -n "$base" ] || decide true "no earlier run that tested a commit"
[ "$base" != "$GITHUB_SHA" ] || decide false "main is unchanged since $base was tested"

compare=$(gh api "repos/$GITHUB_REPOSITORY/compare/$base...$GITHUB_SHA" --jq '(.files | length), .files[].filename')
count=$(head -n 1 <<< "$compare")
# The compare API lists at most 300 files, so a full list may hide a match: test.
[ "$count" -lt 300 ] || decide true "300 or more files changed since $base"
if grep -qE "$inputs" <<< "$(tail -n +2 <<< "$compare")"; then
  decide true "suite inputs changed since $base"
fi
decide false "no suite input changed since $base"
