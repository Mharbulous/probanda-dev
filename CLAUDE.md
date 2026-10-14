Obey @COMMANDMENTS.md

# Probanda plugin repository

The plugin is developed here. Its source is the skill trees under `.claude/skills/` and the plugin files under `source/probanda/` (`plugin.json`, `roster.json`, agents, hooks and the MCP servers). `plugins/probanda/` is built from them by `scripts/build_plugin.py`, which replaces it wholesale, and is never edited by hand. To change the plugin, change the source, run `python scripts/build_plugin.py` and commit the result. `python scripts/build_plugin.py --check` reports whether `plugins/probanda/` matches its source, and `python scripts/check_plugin.py` checks the built plugin.

## Releasing

A push to `main` is the release. claude.ai installs Probanda from this repository as the marketplace `probanda` and picks up new commits itself, and each machine then syncs from claude.ai. To release, bump `version` in `source/probanda/plugin.json`, run `python scripts/build_plugin.py`, commit and push. Never build a `.plugin` archive and never ask for a manual upload: that was the old "My Uploads" route. No session can trigger either sync. A machine's copy under `~/.claude/plugins/synced/` can be hours behind claude.ai, so check the time on its `.last-complete-round` file before reporting which version is installed.

## Two repositories

- `Mharbulous/probanda-plugins` is this repository. It is private, and all development happens here. It stays private: its history holds schema files.
- `Probanda-app/litigation` is the public repository that users install from.

`public/` is the Public Folder: the only source of the public repository, so it never holds a Trade Secret or User Data. A skill lives under `public/plugins/probanda/skills/` or under `.claude/skills/`, never both. `python scripts/check_public_tree.py` checks the folder. Its files are approved with `python scripts/approve_public.py` and published by starting the `publish-public` workflow. A person confirms each approval and each publication: a hook makes the app ask before either runs. Nobody edits the public repository by hand.

## The move from CoClerk

The source moved here from CoClerk and is no longer edited there. The plugin carries legal-commons' read side only: its gatekeeper skill, the `troubleshooter` agent, the pool read tools that `research-agent` holds, and its MCP server under the key `commons`. The push skills (`consolidation-push`, `rule-sharing`) are not part of Probanda, and `hooks/commons-read-only.py` refuses the commons write tools. A few shipped files still mention those two skills; they are not available in Probanda.

## Permanent names

These are permanent once published. Do not rename them.

- The plugin name `probanda`.
- The marketplace name `probanda`.
- Every MCP server key in a plugin's `.mcp.json`.

Together they make up the tool names (`mcp__plugin_probanda_<server>__*`), the install key (`probanda@probanda`) and the `${CLAUDE_PLUGIN_DATA}` directory. A rename strands every user's installed copy and saved data. `displayName` and descriptions can change freely.

## Cowork constraints

Cowork runs plugins in a sandboxed Linux VM.

- Every path in `.mcp.json`, hooks and scripts uses `${CLAUDE_PLUGIN_ROOT}` or `${CLAUDE_PLUGIN_DATA}`, never an absolute path.
- MCP servers ship as self-contained bundles with no install step at runtime.
- Scripts use LF line endings and are executable.
- A plugin has no top-level `bin/` directory, because Cowork does not install a plugin that has one.

## Never commit

- SQL files or schema DDL. **Exception:** the plugin still ships the legacy schemas (`.sql` files in its data skills, and DDL in the data server bundle), in its source and in `plugins/probanda/`, so the publish-readiness check fails by design until the schema-split rebuild removes them. Until that rebuild, a schema hop may add lines to those legacy schemas when Brahm allows that hop in conversation, and the `--new-since` check below then reports those lines, and each schema file the hop edits as a forbidden file, and nothing else. Nothing else may add any.
- Databases.
- Built `.plugin` archives.
- Handovers or E2E reports.
- Client or matter data.
- Secrets.
- File paths from the maintainer's machines.

`scripts/check_publishable.py` enforces this and also pins the permitted plugin and marketplace names. The full scan runs on demand: from the repo's Actions tab, or locally with `python scripts/check_publishable.py`. Run it before making the repo public. On 2026-10-12 it reported 3,091 problems: 2,964 lines of schema DDL and 21 forbidden files, which the exception above covers, and 106 lines holding a path from a maintainer's machine, which no exception covers. About half of all the problems are in the source (`.claude/skills/` and `source/probanda/`) and half in the copy built from it in `plugins/probanda/`.

No change may add a problem of any kind. On every pull request and every push to `main`, CI runs `python scripts/check_publishable.py --new-since <base>`, which fails only when the change holds a problem its base does not. A problem line that moved, or a file that was renamed, adds nothing. Run it locally as `python scripts/check_publishable.py --new-since origin/main`.

The repo must never be made public while this check fails on `main`.

## One plugin

legal-commons is merged into `probanda`. There is no second plugin.
