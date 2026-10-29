# tokeneconomizer — Vision

`tokeneconomizer` cuts what a Claude Code or Claude Cowork session spends: it injects short facts learned from a repository's earlier sessions at session start, and redirects a turn stuck in a failing loop. It is optional, and third-party code under Apache-2.0, adapted here from the fork `Mharbulous/TokenEconomizer`.

It requires no plugin and names nothing in any other. Tool pruning is off in this copy, so it writes only under its own state root and temporary folders, never a file Probanda did not create.

The vision, the design principles and the anti-patterns that govern all the Probanda plugins are in the `VISION.md` of the `lawyer` plugin. They apply here unchanged.
