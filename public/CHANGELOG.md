# Changelog

## Repository renamed Probanda-app/Legal; legal folded into lawyer

- The repository is now `Probanda-app/Legal`. The old address redirects to it.
- The legal plugin is folded into lawyer, which is now the core plugin and takes over proof-read. Install lawyer first. researcher, litigator and solicitor now require lawyer instead of legal.
- README install commands and each plugin's homepage and repository links use the new name.

## Probanda_Legal marketplace, researcher and lawyer plugins

- The marketplace is now `Probanda_Legal`. Install each plugin as `<plugin>@Probanda_Legal`.
- Plugin listings name "Probanda Legal" as owner and author, with shorter display names.
- The research plugin is renamed researcher.
- New lawyer plugin: dyu and TLDR move to it from legal. It requires nothing.
- README updated for the five plugins.

## For lawyers in any jurisdiction; README lists each plugin's skills

- Marketplace, legal, research and litigator descriptions no longer limit Probanda to British Columbia.
- README: a table of the four plugins, what each is for, and the skills each ships.

## Split into four plugins: legal, research, litigator, solicitor

- legal 0.0.1: the core plugin, with proof-read, TLDR and dyu. Every other plugin requires it.
- research 0.0.1: legal-citation.
- litigator 0.0.1: litigation-fact-extractor.
- solicitor 0.0.1: reserved, with no skills yet.

## First release: the probanda plugin

- One plugin holding the first skills.
