# Probanda

Probanda is a set of Claude Cowork plugins for lawyers in any jurisdiction.

## Plugins

| Plugin | Purpose | Skills |
|---|---|---|
| `legal` | The core plugin. Every other plugin requires it. | `proof-read` checks legal writing for spelling, grammar and tone. `TLDR` summarizes the session for someone who has read none of it. `dyu` restates your request and waits for you to confirm it before acting. |
| `research` | What the law is. | `legal-citation` sets out a case or statute citation, with its pinpoint, as an italicized block quote. |
| `litigator` | Court work on a matter. | `litigation-fact-extractor` presents the facts in litigation documents for review, citing the source of each. |
| `solicitor` | Reserved for solicitor's work. | None yet. |

## Install

In Claude, add this repository as a plugin marketplace, then install the plugins from it in this order. `legal` comes first because every other plugin requires it, and `research` comes before `litigator`, which requires both:

```
/plugin marketplace add Probanda-app/Probanda
/plugin install legal@probanda
/plugin install research@probanda
/plugin install litigator@probanda
/plugin install solicitor@probanda
```

On Claude Code 2.1.275 or later each install works in one step:

```
/plugin install legal --marketplace Probanda-app/Probanda
/plugin install research --marketplace Probanda-app/Probanda
/plugin install litigator --marketplace Probanda-app/Probanda
/plugin install solicitor --marketplace Probanda-app/Probanda
```

## Status

This is an early release. It holds a first few skills, and more are added here as each one is published.
