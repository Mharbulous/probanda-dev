# Spec: The Suggestion Box in Probanda's Cloud, and /suggestion-triage

Status: decided, 2026-10-18, by Brahm in the grilling session for ticket #51 on map #46 ("Lawyer-only access to Probanda's shared services").
Plugin: `researcher` (the `commons` server's `suggestion_box__submit`), plus the cloud project `nbzkuhgiqscjkypedqff` and repo-only maintainer files. No plugin ships `/suggestion-triage`.
Related: #50 (the server-side gateway), #57 (the COMMANDMENTS 3 amendment), #49 (keys with no scopes), #59 (the hand-off spec), and `2026-10-15_suggestion-skill-to-practice-plugin-spec.md`.

---

## 1. Problem

Ticket #51 asks how the Suggestion Box moves from the private GitHub repo to Probanda's Cloud, readable only by Probanda. Most of the move is done. What is left is the row's fields, how Probanda triages, and the GitHub side.

## 2. Evidence (verified at HEAD, 2026-10-18)

- `suggestion-submit` is deployed and `cloud/suggestions/suggestions.sql` is applied. The row holds `suggestion_id`, `title`, `body`, `source` and `created_at`.
- The GitHub route and `config.ts` are gone from source: commits `bb840b5` ("save to Probanda's Cloud with the commons key, not GitHub") and `640bbc2` ("delete the unused GitHub credential config").
- The researcher bundle rebuilt on 2026-10-17 no longer contains the GitHub route, so the stale-bundle note on #50 no longer holds.
- `source/researcher/commons-mcp/test/suggestion-box.test.mjs` still asserts a `POST https://api.github.com/repos/<repo>/issues` route the code no longer has.

## 3. Goal and non-goals

Goal: each suggestion row records the plugin version, the skill and a triage status, and Probanda triages new suggestions with `/suggestion-triage`, a maintainer-only debate that ends in a GitHub issue holding an implementation plan.

Non-goals: executing the plan issue; the lawyer-account column before #57; a read-back of one's own suggestions; any mirror of suggestions to GitHub other than the plan issue that triage files.

## 4. Design

### 4.1 The suggestion row (cloud)

`suggestions.suggestion` keeps its columns and gains:

| Column | Filled by | Values |
|---|---|---|
| `plugin_version text not null` | the `commons` MCP server, from the researcher plugin's own `plugin.json` version; never the model | e.g. `0.4.3` |
| `skill text` | the model, optional; `/draft`'s loose-thread route sends `draft` | a skill name, unique across the seven plugins, so it also names the plugin |
| `status text not null default 'new'` | the server on insert; `suggestion-set-status` afterwards | `new`, `approved`, `approved in part`, `rejected` |
| `issue_number integer` | `suggestion-set-status` | the probanda-dev issue holding the plan, when one was filed |
| `triaged_at timestamptz` | `suggestion-set-status` | |
| `account_id` | the server, from the key `serve()` looked up, never the body | added only once #57 allows it; until then the row names no one |

Installs stay insert-only: no install reads any suggestion, its own included (#50 decision 4).

`suggestion-submit` gains `plugin_version` (required) and `skill` (optional) in its body, with the same shape checks. Once #49's no-scopes design lands, it accepts any live lawyer key, and the `suggestions:write` scope and the `install_key_scopes_check` change in `suggestions.sql` go. Until then it keeps its scope.

### 4.2 Maintainer access (cloud and scripts)

Two new edge functions, project secret only (`serve()` with no `scope`, the pattern #50 sets for maintainer functions), listed in `config.toml` with `verify_jwt = false` and deployed with `supabase functions deploy suggestion-list suggestion-set-status --use-api --project-ref nbzkuhgiqscjkypedqff --workdir cloud/legal-commons`:

- `suggestion-list`: request `{}` or `{ "status": "new" }`; reply the matching rows, oldest first.
- `suggestion-set-status`: request `{ "suggestion_id", "status", "issue_number"? }`. Refuses a status outside the three terminal values and a row whose status is not `new`. Sets `triaged_at = now()`. Replies `{ "suggestion_id", "status" }`.

One maintainer script, `cloud/suggestions/tools/triage.mjs`, in the shape of `cloud/legal-commons/tools/find.mjs`: reads `POOL_SECRET_KEY` from the environment (`set POOL_SECRET_KEY first` when absent) and posts to `/functions/v1/<fn>` with the `apikey` header. Subcommands: `list` (prints the `new` rows as JSON) and `set-status <suggestion_id> <status> [--issue <n>]`.

Triage reads suggestions on Probanda's development machine with the project secret (#50 decision 5), never through the plugin. The project secret is never placed in the plugin's credential file.

GitHub token leftovers: each of Brahm's machines may still hold `%LOCALAPPDATA%\Coclerk\suggestion-box\credential.json.dpapi` with a GitHub token. Deleting the file on each machine and revoking the token on GitHub are Brahm's steps, recorded in the hand-off spec (#59). No cloud push to GitHub exists or is planned, so no GitHub token lives in the cloud.

### 4.3 `/suggestion-triage` (repo-only command and agents)

**Where it lives.** Maintainer-only, so in no plugin. A `.claude/skills/` folder must be assigned to a plugin (`check_layering.py` and `check_file_ops.py` stop otherwise), and `.claude/commands/` is where `/release` and `/rule-remodel` live. Files:

- `.claude/commands/suggestion-triage.md`: the orchestrator's procedure (§4.4).
- `.claude/agents/black-hat.md`, `.claude/agents/white-hat.md`: `model: opus`, `effort: high`, `tools: Read, Glob, Grep`. The build scripts never touch `.claude/agents/`.
- `.claude/agents/suggestion-oracle.md`: `model: fable`, `tools: Read, Glob, Grep`.
- `.claude/suggestion-triage/black-hat.md`, `.claude/suggestion-triage/white-hat.md`: each hat's own notes file, 3000 characters at most, written only at steps 7 and 8.
- `.claude/suggestion-triage/human-guidance.md`: the oracle's only reference file, edited by a human only.
- `scripts/triage_notes.py`, deterministic, with tests beside the repo's other script tests:
  - `show <file> <step>` prints the advice available at a step: untagged text plus every `<stepN>…</stepN>` block with N ≤ step, so advice is cumulative and arrives just in time.
  - `cap <file>`: if the file's length without the phrase `[characters in excess of 3000 have been truncated in accordance with the skill rules]` is 3000 or less, remove the phrase if present. Otherwise truncate to 3000 characters and append the phrase. Tags count toward the 3000.

**Who runs it.** A Claude Code session on Brahm's PC in the probanda-dev checkout, driven from the iPhone through Remote Control. `gh` (keyring), `POOL_SECRET_KEY` and the Agent tool all work there as on the desktop. No plugin, Cowork or cloud-session constraint applies.

**One agent per hat, resumed across steps.** Black-hat and white-hat are each dispatched once in the background at step 2 and resumed with `SendMessage` at steps 3, 4, 5 and 7, so each keeps its own context and sees nothing of the other's except what the orchestrator forwards. The orchestrator relays each reply as its completion notification arrives, so the faster agent's text shows first. The oracle is one agent too, dispatched at step 6 and resumed at step 7. The orchestrator makes every write: the notes files, the cap script, the issue, the status, the commit. No agent writes anything.

**Blinding.** The hats never open `.claude/commands/` or `.claude/suggestion-triage/`, and their definitions say so. Each step's message to a hat carries that step's notes from `triage_notes.py show`. The scoring rules live only in the command file and reach the hats in the step 5 message. The oracle sees `human-guidance.md` and never the hats' notes.

### 4.4 Steps

1. `triage.mjs list`. Take the oldest `new` row unless Brahm names a `suggestion_id`. Write a face-value summary of at most 1000 characters, reading no source and giving no opinion, and show it with the row's `skill`, `plugin_version` and `source`.
2. Dispatch both hats in parallel with the summary, the full title and body, and their step-2 notes. Black-hat: the best case, 500 words or fewer, for doing nothing. White-hat: the best case, 500 words or fewer, for implementing, free to argue for a better variation. Show each reply as it arrives.
3. Send each hat the other's argument. Each returns a critique of 300 words or fewer.
4. Send each hat the other's critique. Each replies in 300 words or fewer.
5. Send each hat the other's reply and, for the first time, the scoring: −1 per contested point lost, 0 per point conceded now, +1 per tie, +2 per point won. Each names the points it concedes.
6. Dispatch the oracle with `human-guidance.md`, the summary, and both sides' arguments, critiques, replies and concessions. It lists the points of contention, decides each with a written reason, tallies and declares the winner. Show the decision and forward it to both hats.
7. Two things at once:
   - In the background, each hat returns the full new text of its notes file (3000 characters at most, step tags allowed). The orchestrator writes it to the hat's file and runs `triage_notes.py cap`.
   - The oracle decomposes the suggestion into independent cohesive parts (a decision on one part must not change its advice on another, otherwise they are one part; the seams need not match the debate's points). For each part it gives three options, implement as proposed, implement with its modification, reject, with a recommendation, and a modification only where it recommends one. The orchestrator presents one part per message, the options side by side, under the one-question rule. After the last answer it sends the decisions to the oracle, which writes the implementation plan. The orchestrator files it with `gh issue create` on probanda-dev: title the suggestion's title, body the plan with the decision per part and the line `Suggestion <suggestion_id>`, label `suggestion`, no account and no name. Immediately after `gh` returns the issue number, or immediately after Brahm confirms that no part is implemented, it runs `triage.mjs set-status <id> approved|"approved in part"|rejected [--issue <n>]`.
8. Once both notes files are written and capped, commit the two files by pathspec with a message naming the suggestion id, `git pull --ff-only`, push `main`. Then say the triage is done.

Executing the plan issue is outside this skill.

## 5. Constraints that must still hold

- No install ever reads a suggestion. Lawyer keys reach only `suggestion-submit`.
- The project secret stays on Probanda's development machines and in no plugin file.
- The GitHub issue and the oracle's plan carry no person, entity, matter or account.
- Only a human edits `human-guidance.md`. Only steps 7 and 8 edit a hat's notes file. The cap script is the only truncation.

## 6. Options considered

1. Triage by a HITL debate between two self-improving agents judged by an oracle, ending in a plan issue (chosen).
2. Brahm reads rows in the dashboard and triages by hand: no record of the reasoning, and no plan issue.
3. Mirror every suggestion to GitHub as an issue: puts unscreened text and a GitHub token back in the loop. Rejected.
4. A read-back of one's own suggestions: a read function and a stored account link for a feature nobody asked for. Rejected.

## 7. Implementation plan

1. Add the §4.1 columns to `cloud/suggestions/suggestions.sql` (idempotent) and apply it.
2. `suggestion-submit`: the new `plugin_version` and `skill` fields.
3. `suggestion-list` and `suggestion-set-status`, with their `config.toml` entries; deploy.
4. `cloud/suggestions/tools/triage.mjs`.
5. The `commons` server sends `plugin_version` and accepts `skill`; rebuild the plugins and release the patch bumps.
6. `.claude/commands/suggestion-triage.md`, the three agent files, the three notes files.
7. `scripts/triage_notes.py` with its tests.

## 8. Implementation criteria

1. `triage_notes.py` tests pass: the cap at exactly 3000, phrase removal under the cap, `show` for untagged text, and a `<step3>` block shown at step 3 and not at step 2.
2. With `POOL_SECRET_KEY` set, a synthetic suggestion (no client data) submitted through `suggestion-submit` shows in `triage.mjs list` with `status: new`. `set-status` to `rejected` succeeds once and refuses a second call. `suggestion-list` with a lawyer key or no key gets 401.
3. One full `/suggestion-triage` run on that synthetic suggestion over Remote Control: each hat's text appears as it arrives, the issue exists with label `suggestion`, the row's status and `issue_number` are set, and the notes files are committed and within the cap.
4. `python scripts/check_publishable.py --new-since origin/main`, `python scripts/check_plugin.py` and `python scripts/build_plugin.py --check` pass.

## 9. Open questions

None. The `account_id` column waits on #57.
