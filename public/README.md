# Probanda

Probanda is a set of Claude Cowork plugins for legal practice in British Columbia.

## Install

In Claude, add this repository as a plugin marketplace, then install the plugins from it in this order. `legal` comes first because every other plugin requires it, and `research` comes before `litigator`, which requires both:

```
/plugin marketplace add Probanda-app/plugins
/plugin install legal@probanda
/plugin install research@probanda
/plugin install litigator@probanda
/plugin install solicitor@probanda
```

On Claude Code 2.1.275 or later each install works in one step:

```
/plugin install legal --marketplace Probanda-app/plugins
/plugin install research --marketplace Probanda-app/plugins
/plugin install litigator --marketplace Probanda-app/plugins
/plugin install solicitor --marketplace Probanda-app/plugins
```

`solicitor` ships no skills yet.

## Status

This is an early release. It holds a first few skills, and more are added here as each one is published.
