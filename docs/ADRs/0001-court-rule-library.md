---
status: accepted
---

# Court Rules live in a firm-wide Rule Library served by one court-rules-clerk

Procedural rules were looked up like case law, through /legal-research, and fetched into one matter's `6. LAW` folder by legislation-fetcher, one page at a time. A Rule Set changes often, is long, is issued over several Consolidation parts, and is used by every matter before the same Venue. So each practitioner keeps a Rule Library on their own machine, at `<case_data_root>\_practice\rules\`, laid out by the knowledge-tree grammar (country, jurisdiction, optional locality, Venue, Rule Set), with transnational bodies under a reserved `_International` folder that the grammar gains for every tree. A single agent, `court-rules-clerk` in the `research` plugin, files, indexes, keeps current, locates and quotes Rule Sets for any Venue. It knows how to work with rules, not the rules themselves.

## Considered options

- **Matter `6. LAW` folders** (legislation-fetcher as it is): a Rule Set would be fetched again for every matter, and no copy is firm-wide.
- **Knowledge trees**: legal-research's tree holds publisher maps and never instrument text, and the trees hold learned requirements, not whole instruments.
- **research-agent or legislation-fetcher with more duties**: research-agent is the only component that states law, and the clerk must not. legislation-fetcher files one instrument into one matter.
- **"rules agent", `rules__*` tools**: those names already mean /draft's working-rules map.

## Consequences

- The clerk locates and quotes verbatim with the currency marker and reports what it searched. It never says what a Rule means, whether it applies, or that none exists. Those go to research-agent, which may cite the clerk's search record.
- Whole-instrument retrieval reads every part's link off the publisher's own contents page and never guesses a part id. `sources__fetch` gains same-host link targets, and the publisher map gains the pattern for finding the contents page and its part links. legislation-fetcher uses the same step, so a regulation published in parts no longer stops it.
- Library files are filed, searched and retired by `court_rules__*` tools in the `practice` data server, server-side, so rule text never passes through a model to be rewritten.
- The docket-clerk's modelled deadline rules and rule periods stay separate. They model deadline logic, and the library holds text.
- What, if anything, the legal commons pools for Rule Sets is not decided here.
