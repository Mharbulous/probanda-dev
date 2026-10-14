# Probanda

Probanda is a set of four Claude Cowork plugins for legal practice in British Columbia, in one marketplace named `probanda`.

| Plugin | What it does | Requires |
|---|---|---|
| `practice` | The base: firm records, time, billing, filing, case data and deadlines | nothing |
| `research` | What the law is: legal research, citation and verification | `practice` |
| `litigator` | Court work on a matter: applying the law to the facts, drafting, court forms and filing packages | `practice`, `research` |
| `solicitor` | Reserved. It ships no skills yet | `practice` |

## Install

In Claude, add this repository as a plugin marketplace, then install the plugins from it in this order:

```
/plugin marketplace add Mharbulous/probanda-plugins
/plugin install practice@probanda
/plugin install research@probanda
/plugin install litigator@probanda
```

Keep to that order. Claude Code installs a required plugin with the plugin that requires it, but claude.ai and Cowork do not: there, a plugin whose required plugin is missing loads with tools and agents absent.

## Status

This repository is private during development. The install commands above work only for accounts that have been given access to it. The public repository, `Probanda-app/plugins`, still offers the single plugin `probanda` until the public plugins are split the same way.

The four plugins replace the single plugin `probanda`, which itself combined two CoClerk plugins: `litigation`, and the read side of `legal-commons`. If you have any of those three installed, uninstall it before installing these, or every skill will appear twice.
