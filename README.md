# Probanda

Probanda is a Claude Cowork plugin for litigation practice in British Columbia.

## Install

In Claude, add this repository as a plugin marketplace, then install the plugin from it:

```
/plugin marketplace add Probanda-app/litigation
/plugin install probanda@probanda
```

On Claude Code 2.1.275 or later this works in one step:

```
/plugin install probanda --marketplace Probanda-app/litigation
```

## Status

This repository is private during development. The install commands above work only for accounts that have been given access to it.


The plugin combines what used to be two CoClerk plugins: `litigation`, and the read side of `legal-commons`. If you had either installed, uninstall it before installing Probanda, or every skill will appear twice.
