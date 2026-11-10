<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# CanLII MCP server (Probanda plugin)

The Probanda plugin's `canlii` server. It reads index metadata from the [CanLII API](https://www.canlii.org): the case citator and legislation metadata. The API serves no decision or legislative text, and neither does this server. Every data response says so in its `_notice` field.

Vendored from [Mharbulous/canlii-mcp](https://github.com/Mharbulous/canlii-mcp) and since modified. MIT licensed, see [LICENSE](LICENSE).

## Tools

| Tool | Returns |
|---|---|
| `get_case_citator` | Cases a decision cites and legislation it cites, in full, or the count of cases citing it and the 5 newest |
| `get_case_citator_tease` | The same lists, capped at 5 results |
| `get_legislation_databases` | The legislation database IDs |
| `browse_legislation` | Legislation items in one database, filtered by `titleContains` and paginated |
| `get_legislation_regulation_metadata` | One instrument's canlii.org URL, citation, dates and table of contents |
| `legislation_currency` | Whether each cited instrument is current, repealed, archived or not found, by the rules in `source/skills/shared/legislation-currency.md`; one check per instrument however many inputs name it; for a current B.C. Reg., also the amending regulations BC Laws' Cumulative B.C. Regulations Bulletin lists after its marker date, with their amended provisions quoted from the B.C. Gazette Part II text |
| `configure_credential` | Validates a CanLII API key, then saves it DPAPI-encrypted for later sessions |
| `configure_status` | Whether a key is configured, and whether it came from the environment or the saved credential |

## API key

The key is optional. Without it the server still starts, and each lookup fails with a message naming both ways to supply it:

- the `CANLII_API_KEY` user environment variable, which Claude Code CLI inherits at spawn and which always wins; or
- `configure_credential`, for Cowork, where the server does not see the user environment. The key is saved at `%LOCALAPPDATA%\Coclerk\canlii` (`src/dpapi-store.ts`), which shells out to PowerShell for DPAPI.

## Limits

Requests go only to `api.canlii.org`. A serialized queue keeps to CanLII's terms: 2 requests a second, 1 at a time, 5,000 a day.

## Build

```
npm run bundle
```

This writes `dist/canlii-mcp.js`, the tracked bundle the plugin ships. The version string is inlined at build time, because the installed plugin carries only `dist/`.
