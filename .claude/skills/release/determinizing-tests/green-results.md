# GREEN results: release-hardened, Steps 2–3

Each entry is the report of a Sonnet subagent that followed `release-hardened/SKILL.md` Steps 2–3 in the same scratch clone as the baseline, running `scripts/release_set.py --repo <clone>`. Nothing was built, committed or pushed.

## Scenario 1: Nothing to release (cc362afc)

- `release_set.py` exit **1**:
  ```
  released: litigator (last bump cc362afc; from check)
    (no change to its inputs since the bump)
  ```
- Decision: **continue**. Released: litigator (check), empty change set. Bundle rebuilds: none.

## Scenario 2: Built plugins committed without a bump (e3b3c357)

- `release_set.py` exit **1**: `rebuild: source/lawyer/mcp (for billing, file-manager, lawyer)` with the tsc and bundle.mjs `run:` lines; `released: billing (from rebuild)`, `released: file-manager (from rebuild)`, `released: lawyer (from released, rebuild)`, `released: litigator (from released)`, all `last bump cc362afc`.
- Change sets: billing and file-manager the 7 `source/lawyer/mcp/` files; lawyer the same 12 files as the baseline; litigator `M source/skills/publish/scripts/emphasis.py`.
- Decision: **continue**. Bundle rebuilds: tsc, then bundle.mjs for `source/lawyer/mcp`, then `--check` again.

## Scenario 3: Source changed and not rebuilt (f47f13b9)

- `release_set.py` exit **1**: `rebuild: source/lawyer/mcp (for billing, file-manager, lawyer)` with the tsc and bundle.mjs lines; `released: billing (from rebuild)`, `released: file-manager (from rebuild)`, `released: lawyer (from check, rebuild)`, `released: litigator (from released)`, all `last bump cc362afc`.
- Change sets: identical to the baseline (lawyer 12, file-manager and billing 7, litigator `emphasis.py`).
- Decision: **continue**. Bundle rebuilds: tsc, then bundle.mjs for `source/lawyer/mcp`, then `--check` again.

## Scenario 4: Server src changed with no bundle rebuild

- `release_set.py` exit **1**:
  ```
  rebuild: source/lawyer/mcp (for billing, file-manager, lawyer)
    run: node source/lawyer/mcp/node_modules/typescript/bin/tsc -p source/lawyer/mcp/tsconfig.json
    run: node source/lawyer/mcp/scripts/bundle.mjs
  released: billing (last bump cc362afc; from rebuild)
    M	source/lawyer/mcp/src/call-log.ts
  released: file-manager (last bump cc362afc; from rebuild)
    M	source/lawyer/mcp/src/call-log.ts
  released: lawyer (last bump cc362afc; from rebuild)
    M	source/lawyer/mcp/src/call-log.ts
  released: litigator (last bump cc362afc; from check)
    (no change to its inputs since the bump)
  ```
- Decision: **continue**. Bundle rebuilds: tsc, then bundle.mjs for `source/lawyer/mcp`, then `--check` again.

## Scenario 5: Shared skill change, not rebuilt

- `release_set.py` exit **1**: `released:` blocks for billing, developer, file-manager, lawyer, litigator, researcher and solicitor, each `(last bump cc362afc; from check)` with change set `M	source/skills/shared/answer-grades.md`.
- Decision: **continue**. Bundle rebuilds: none.

## Scenario 6: Stop, assignment not cutover

- `release_set.py` exit **2**:
  ```
  STOP: <scratch>\s6\source\assignment.json: "status" is 'draft', expected "cutover"
  stop: build_plugin.py exited 2
  ```
- Decision: **stop** and report the output. No release set, no change sets, no rebuilds.

## Comparison: Baseline vs GREEN

| Scenario | Decision | Release set and sources | Change sets | Rebuild commands | Match |
|---|---|---|---|---|---|
| 1 Nothing to release (cc362afc) | continue = continue | litigator (check) | empty = empty | none | yes |
| 2 Built without bump (e3b3c357) | continue = continue | lawyer, litigator, file-manager, billing; same sources | identical | lawyer/mcp tsc + bundle | yes |
| 3 Source not rebuilt (f47f13b9) | continue = continue | lawyer, litigator, file-manager, billing; same sources | identical | lawyer/mcp tsc + bundle | yes |
| 4 Server src edit | continue = continue | lawyer, file-manager, billing (rebuild), litigator (check) | identical | lawyer/mcp tsc + bundle | yes |
| 5 Shared skill edit | continue = continue | all seven (check) | identical | none | yes |
| 6 Not cutover | stop = stop | none | none | none | yes |

Two baseline ambiguities are now fixed by the script: a server's input is its whole build folder (`test/` included), and `source/lawyer/mcp` is named as the bundle source for billing too, which step 3's prose of the original left out.
