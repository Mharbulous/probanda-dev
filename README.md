# Probanda

Probanda is a set of six Claude Cowork plugins for legal practice in British Columbia, in one marketplace named `Probanda_Legal_experimental`.

| Plugin | What it does | Requires |
|---|---|---|
| `lawyer` | The base: firm records, time, billing, case data and deadlines, and skills for any lawyer: `dyu` restates a request before acting, `TLDR` summarizes a session | nothing |
| `researcher` | What the law is: legal research, citation and verification | `lawyer` |
| `litigator` | Court work on a matter: applying the law to the facts, drafting, court forms and filing packages | `lawyer`, `researcher` |
| `solicitor` | Reserved. It ships no skills yet | `lawyer` |
| `file-manager` | Optional. Every Probanda tool that renames, moves or deletes your own files: matter housekeeping, routing accounting files, applying approved renames | `lawyer` |
| `timekeeper` | Optional. Automated time tracking: gathers the evidence of a day's work, sorts it to client matters, corrects TimeCamp and drafts time entries | `lawyer` |

## Install

In Claude, add this repository as a plugin marketplace, then install the plugins from it in this order:

```
/plugin marketplace add Mharbulous/probanda-plugins
/plugin install lawyer@Probanda_Legal_experimental
/plugin install researcher@Probanda_Legal_experimental
/plugin install litigator@Probanda_Legal_experimental
/plugin install file-manager@Probanda_Legal_experimental
/plugin install timekeeper@Probanda_Legal_experimental
```

Keep to that order. Claude Code installs a required plugin with the plugin that requires it, but claude.ai and Cowork do not: there, a plugin whose required plugin is missing loads with tools and agents absent.

`file-manager` is optional: leave it out to keep Probanda's file tools away from your files. Without it, a step that would move or trash a file stops and says so. The host's own shell (`device_bash` in Cowork, Bash/PowerShell elsewhere) can still create and rename files in a connected folder. That access is outside any plugin's control. Disabling file-manager removes Probanda's file tools, not the host's.

`timekeeper` is optional too: leave it out if you do not track time with it. Billing keeps working without it, and a billing step that needs it says so and stops.

## Status

This repository is private during development. The install commands above work only for accounts that have been given access to it. The public repository, `Probanda-app/Probanda`, still offers the single plugin `probanda` until the public plugins are split the same way.

The five plugins replace the single plugin `probanda`, which itself combined two CoClerk plugins: `litigation`, and the read side of `legal-commons`. If you have any of those three installed, uninstall it before installing these, or every skill will appear twice. The same goes for `legal`, whose contents moved into `lawyer` on 2026-10-17. Your data is untouched: it lives outside the plugins.
