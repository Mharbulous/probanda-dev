Obey @COMMANDMENTS.md

# Probanda plugin repository

The plugin is developed here. Its source is the skill trees under `.claude/skills/` and the plugin files under `source/probanda/` (`plugin.json`, `roster.json`, agents, hooks and the MCP servers). `plugins/probanda/` is built from them by `scripts/build_plugin.py`, which replaces it wholesale, and is never edited by hand. To change the plugin, change the source, run `python scripts/build_plugin.py` and commit the result. `python scripts/build_plugin.py --check` reports whether `plugins/probanda/` matches its source, and `python scripts/check_plugin.py` checks the built plugin.

## The move from CoClerk

The source moved here from CoClerk and is no longer edited there. The plugin carries legal-commons' read side only: its gatekeeper skill, the `law-librarian` and `troubleshooter` agents, and its MCP server under the key `commons`. The push skills (`consolidation-push`, `rule-sharing`) are not part of Probanda, and `hooks/commons-read-only.py` refuses the commons write tools. A few shipped files still mention those two skills; they are not available in Probanda.

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

- SQL files or schema DDL. **Exception:** the plugin still ships the legacy schemas (`.sql` files in its data skills, and DDL in the data server bundle), in its source and in `plugins/probanda/`, so the publish-readiness check fails by design until the schema-split rebuild removes them. Nothing else may add any.
- Databases.
- Built `.plugin` archives.
- Handovers or E2E reports.
- Client or matter data.
- Secrets.
- File paths from the maintainer's machines.

`scripts/check_publishable.py` enforces this and also pins the permitted plugin and marketplace names. It runs only on demand: from the repo's Actions tab, or locally with `python scripts/check_publishable.py`. Run it before making the repo public.

The repo must never be made public while this check fails on `main`.

## One plugin

legal-commons is merged into `probanda`. There is no second plugin.
