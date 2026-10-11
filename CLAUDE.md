# Probanda plugin repository

This repo is a publish target, not a workshop. The plugin folders under `plugins/` come from CoClerk's plugin packager and are never edited by hand here. Only `.claude-plugin/marketplace.json` and the repo docs (this file, the READMEs, `scripts/`, `.github/`) are maintained here.

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

- SQL files or schema DDL.
- Databases.
- Built `.plugin` archives.
- Handovers or E2E reports.
- Client or matter data.
- Secrets.
- File paths from the maintainer's machines.

`scripts/check_publishable.py` enforces this and also pins the permitted plugin and marketplace names. CI runs it on every push and pull request. Run it locally with `python scripts/check_publishable.py` before committing.

The repo must never be made public while this check fails on `main`.

## Second plugin

A second plugin, the legal-commons expansion, will be added later under its own permanent name. Do not create it until the maintainer has chosen that name.
