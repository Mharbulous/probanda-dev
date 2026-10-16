# Probanda

Probanda is a set of five Claude Cowork plugins for legal practice in British Columbia, in one marketplace named `probanda`.

| Plugin | What it does | Requires |
|---|---|---|
| `legal` | The base: firm records, time, billing, case data and deadlines | nothing |
| `research` | What the law is: legal research, citation and verification | `legal` |
| `litigator` | Court work on a matter: applying the law to the facts, drafting, court forms and filing packages | `legal`, `research` |
| `solicitor` | Reserved. It ships no skills yet | `legal` |
| `file-manager` | Optional. Every Probanda tool that renames, moves or deletes your own files: matter housekeeping, routing accounting files, applying approved renames | `legal` |

## Install

In Claude, add this repository as a plugin marketplace, then install the plugins from it in this order:

```
/plugin marketplace add Mharbulous/probanda-plugins
/plugin install legal@probanda
/plugin install research@probanda
/plugin install litigator@probanda
/plugin install file-manager@probanda
```

Keep to that order. Claude Code installs a required plugin with the plugin that requires it, but claude.ai and Cowork do not: there, a plugin whose required plugin is missing loads with tools and agents absent.

`file-manager` is optional: leave it out to keep Probanda's file tools away from your files. Without it, a step that would move or trash a file stops and says so. The host's own shell (`device_bash` in Cowork, Bash/PowerShell elsewhere) can still create and rename files in a connected folder. That access is outside any plugin's control. Disabling file-manager removes Probanda's file tools, not the host's.

## Status

This repository is private during development. The install commands above work only for accounts that have been given access to it. The public repository, `Probanda-app/Probanda-Legal`, still offers the single plugin `probanda` until the public plugins are split the same way.

The five plugins replace the single plugin `probanda`, which itself combined two CoClerk plugins: `litigation`, and the read side of `legal-commons`. If you have any of those three installed, uninstall it before installing these, or every skill will appear twice.
