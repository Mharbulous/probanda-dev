Obey @COMMANDMENTS.md

# Probanda plugin repository

Seven plugins are developed here: `legal`, `researcher`, `litigator`, `solicitor`, `file-manager`, `timekeeper` and `lawyer`. Their source is the skill trees under `.claude/skills/` and, for each plugin, the files under `source/<plugin>/` (`plugin.json`, `roster.json`, agents, hooks and the MCP servers it ships). `source/assignment.json` says which plugin ships each skill, agent, hook and server. `plugins/<plugin>/` is built from them by `scripts/build_plugin.py`, which replaces each of the seven folders wholesale, and is never edited by hand. `.claude/skills/shared/` exists once in source and is copied whole into every plugin. To change a plugin, change the source, run `python scripts/build_plugin.py` and commit the result. `python scripts/build_plugin.py --check` reports whether each `plugins/<plugin>/` matches its source, and `python scripts/check_plugin.py` checks the seven built plugins.

## Releasing

A push to `main` is the release. claude.ai installs the seven plugins from this repository as the marketplace `Probanda_Legal_experimental` and picks up new commits itself, and each machine then syncs from claude.ai. Each plugin has its own version. Release with `/release`, which bumps every plugin whose built folder changes. A change under `.claude/skills/shared/` changes all seven. Never build a `.plugin` archive and never ask for a manual upload: that was the old "My Uploads" route. No session can trigger either sync. A machine's copy under `~/.claude/plugins/synced/` can be hours behind claude.ai, so check the time on its `.last-complete-round` file before reporting which version is installed.

The version rule:

- **Patch** (0.2.1 to 0.2.2): after the update, everything the user had working keeps working with no action, and an old copy and a new copy of the plugin can safely use the same data. New features are patches.
- **Minor** (0.2.1 to 0.3.0): anything else. For example: a data migration or schema change, a tool removed or its inputs changed, a new required setup step such as a credential or a settings allowlist, a raised `requires`, or a server that refuses data an old copy wrote or writes data an old copy would damage.
- **1.0.0**: only when Probanda enters the Claude Directory.

## Two repositories

- `Mharbulous/probanda-plugins` is this repository. It is private, and all development happens here. It stays private: its history holds schema files.
- `Probanda-app/Probanda` is the public repository that users install from. claude.ai labels each plugin "from <repo name>", so the repo name is what users see.

`public/` is the Public Folder: the only source of the public repository, so it never holds a Trade Secret or User Data. A skill lives under `public/plugins/<plugin>/skills/` or under `.claude/skills/`, never both. `python scripts/check_public_tree.py` checks the folder. Its files are approved with `python scripts/approve_public.py` and published by starting the `publish-public` workflow. Each publication adds a top entry to `public/CHANGELOG.md`, a `## ` heading of 10 to 72 characters followed by `- ` bullets naming what it improves or adds. It is approved with the files, and the workflow uses it as the public commit message. A person confirms each approval and each publication: a hook makes the app ask before either runs. Nobody edits the public repository by hand.

## The move from CoClerk

The source moved here from CoClerk and is no longer edited there. The `researcher` plugin carries legal-commons' read side only: its gatekeeper skill, the `troubleshooter` agent, the pool read tools that `research-agent` holds, and its MCP server under the key `commons`. The push skills (`consolidation-push`, `rule-sharing`) are not part of Probanda, and `source/researcher/hooks/commons-read-only.py` refuses the commons write tools. No shipped file hands off to either skill.

## Permanent names

These are permanent once published. Do not rename them.

- The plugin names `legal`, `researcher`, `litigator`, `solicitor`, `file-manager`, `timekeeper` and `lawyer`.
- The marketplace names: `Probanda_Legal` for the public repository and `Probanda_Legal_experimental` for this one. A marketplace name cannot hold a space, so the readable "Probanda Legal" and "Probanda Legal (experimental)" go in `owner.name` and each plugin entry's `author.name`.
- Every MCP server key in a plugin's `.mcp.json`: `data` and `contacts-calendars-email` in `legal`, `canlii` and `commons` in `researcher`, `files` in `file-manager`, and `timecamp` in `timekeeper`.

Together they make up the tool names (`mcp__plugin_<plugin>_<server>__*`, for example `mcp__plugin_legal_data__*`), the agent names (`<plugin>:<agent>`), the install keys (`<plugin>@Probanda_Legal` and `<plugin>@Probanda_Legal_experimental`) and the `${CLAUDE_PLUGIN_DATA}` directory. A rename strands every user's installed copy and saved data. `displayName` and descriptions can change freely.

The plugin name `probanda` is retired and never reused. It was the single plugin until the plugin split, and claude.ai still records it against every machine that installed it. The plugin name `file-admin` is retired too (renamed `file-manager` on 2026-10-15) and never reused. The plugin name `practice` is retired too (renamed `legal` on 2026-10-15) and never reused. The plugin name `research` is retired too (renamed `researcher` on 2026-10-17) and never reused. The marketplace name `probanda` is retired too (split into `Probanda_Legal` and `Probanda_Legal_experimental` on 2026-10-17) and never reused.

## Cowork constraints

Cowork runs plugins in a sandboxed Linux VM.

- Every path in `.mcp.json`, hooks and scripts uses `${CLAUDE_PLUGIN_ROOT}` or `${CLAUDE_PLUGIN_DATA}`, never an absolute path.
- MCP servers ship as self-contained bundles with no install step at runtime.
- Scripts use LF line endings and are executable.
- A plugin has no top-level `bin/` directory, because Cowork does not install a plugin that has one.

## Never commit

- SQL files or schema DDL. **Exception:** the plugin still ships the legacy schemas (`.sql` files in its data skills, and DDL in the data server bundle), in its source and in the built folders under `plugins/`, so the publish-readiness check fails by design until each legacy store is converted and leaves the list in Exception 2 of COMMANDMENTS.md. No change may add any.
- Databases.
- Built `.plugin` archives.
- Handovers or E2E reports.
- Client or matter data.
- Secrets.
- File paths from the maintainer's machines.

`scripts/check_publishable.py` enforces this and also pins the permitted plugin and marketplace names. The full scan runs on demand: from the repo's Actions tab, or locally with `python scripts/check_publishable.py`. Run it before making the repo public. On 2026-10-12 it reported 3,091 problems: 2,964 lines of schema DDL and 21 forbidden files, which the exception above covers, and 106 lines holding a path from a maintainer's machine, which no exception covers. About half of all the problems are in the source (`.claude/skills/` and `source/`) and half in the copies built from it under `plugins/`. The data server bundle holds problem lines, so it ships in `plugins/legal/` only: a second copy of it in another plugin would add every one of them again. The `files` bundle of `file-manager` is built from the same source by a second entry point (`source/legal/mcp/scripts/bundle.mjs`) and must carry none of them.

No change may add a problem of any kind. On every pull request and every push to `main`, CI runs `python scripts/check_publishable.py --new-since <base>`, which fails only when the change holds a problem its base does not. A problem line that moved, or a file that was renamed, adds nothing. Run it locally as `python scripts/check_publishable.py --new-since origin/main`.

The repo must never be made public while this check fails on `main`.

## Seven plugins

| Plugin | Role | Requires |
|---|---|---|
| `legal` | The base: firm records, time, billing, case data, and every part the others share | nothing |
| `researcher` | What the law is | `legal` |
| `litigator` | Court work on a matter | `legal`, `researcher` |
| `solicitor` | Reserved. Ships no skills | `legal` |
| `file-manager` | Optional. Every tool, skill and agent that renames, moves, changes or deletes a file Probanda did not create. Without it, Probanda only reads or copies such files | `legal` |
| `timekeeper` | Optional. Automated time tracking: capturing a day's time evidence, sorting it to matters, correcting TimeCamp and drafting time entries. Its tools stay in `legal`'s `data` server for now | `legal` |
| `lawyer` | Skills for any lawyer, displayed as "Lawyer": `dyu` and `TLDR`. Independent of the others | nothing |

`source/assignment.json` is the list of what each plugin ships. Prose points down only: a skill, agent or hook names nothing in a plugin its own plugin does not require. `lawyer` requires nothing, so it and every other plugin name nothing in it. `legal` names nothing in another plugin, `researcher` names only `legal`, `litigator` names `legal` and `researcher`, and `file-manager` and `timekeeper` name only `legal`. A step anywhere that moves, renames or trashes a file may call into `file-manager` conditionally: without it, the step stops and tells the practitioner, never falling back to a shell move or delete. An exception needs a ruling in `source/layering.json`, and `python scripts/check_layering.py` fails on an upward reference with no ruling. Commandment 7 is enforced by `python scripts/check_file_ops.py`: a new operation outside `file-manager` that renames, moves or deletes a file needs a ruling in `source/file-ops.json`, and a ruling covers a stated number of occurrences, each one read, and only of a file Probanda created. A hook ships in the plugin whose work it guards, and its matcher changes in the same commit as the name it matches. A skill name or agent name is unique across the seven plugins. legal-commons is merged into `researcher`. The plan and its history are in `docs/Plans/2026-10-13_four-plugin-split.md`, `file-manager`'s design in `docs/Plans/2026-10-14_file-admin-plugin.md`, and `timekeeper`'s in `docs/Specs/2026-10-15_timekeeper-plugin-spec.md`.
