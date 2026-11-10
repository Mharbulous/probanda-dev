# Converting Probanda's MCP Tools to a CLI: Free and Open-Source Options (as of November 2026)

> Research report saved 2026-11-09. Produced by a Claude extended-research task (task id wf-f609b3c2-f3e4-8f4f-b903-075ea84efb9b) for the probanda-dev maintainer. It draws on outside sources and has not been independently verified; see its Caveats section. Two example paths in the pilot plan were replaced with `<home>` and `<repo>` placeholders when saving, so that the file holds no path from a maintainer's machine.

For Probanda, try **MCPorter** (openclaw/mcporter, MIT, Node-native) first and **mcpc** (apify/mcpc, Apache-2.0) second. The long-term best option is a thin in-house `probanda` CLI built from your own tool registry. Before converting anything, though, measure the problem: Claude Code's built-in MCP tool search now defers tool schemas by default, so a CLI's token savings over today's baseline are much smaller than the "96–99%" figures in community posts.

## TL;DR

- **Best third-party fit: MCPorter**, with mcpc as the runner-up. MCPorter is TypeScript/Node like your bundles. It runs stdio servers with env vars, keeps stateful stdio servers warm in a per-user daemon, and supports per-server `allowedTools`/`blockedTools`. It can also generate a standalone CLI limited to an allowlist (`generate-cli --include-tools`). mcpc is the most spec-complete client, with persistent sessions, `grep` discovery, strict `--json`, and documented exit codes. However, it has no documented tool allow/deny filter, so the guardrails would have to live in your servers.
- **Any CLI route bypasses your Claude Code hooks.** A PreToolUse hook that matches `mcp__plugin_lawyer_data__...` never fires when the agent runs `mcporter call ...` through Bash. Two conditions must hold before pointing a CLI at the `data`, `contacts-calendars-email` or `files` servers. First, the safety rules (no permanent mail delete; only `files` may move, rename or trash) must be enforced inside the servers themselves. Second, the CLI's exposure must be allowlisted.
- **Is it worth it?** For context cost alone, gains are modest now that Claude Code tool search loads only tool names and server instructions at session start. The strongest reasons to convert are (a) scripting, tests and shell composition; (b) keeping large payloads out of context; and (c) surfaces that still load schemas eagerly. Run a two-week pilot on `timecamp`/`canlii`. Then plan an in-house CLI for the several-hundred-tool `data` server.

## Key Findings

### 1. Claude Code already does progressive discovery natively, so check this first

- The Claude Code MCP docs say tool search "keeps MCP context usage low by deferring tool definitions until Claude needs them. Only tool names and server instructions load at session start". They add that Claude Code "doesn't impose a fixed per-server tool cap".
- Tool search is on by default and controlled by `ENABLE_TOOL_SEARCH`:
  - unset: everything deferred
  - `auto` / `auto:N`: threshold-based
  - `false`: everything loaded upfront
- A server can opt out with `alwaysLoad`. Server authors can mark individual tools with `"anthropic/alwaysLoad"` in the tool's `_meta` (Claude Code v2.1.285 or later).
- Tool search runs on Claude Opus 4, Sonnet 4, Haiku 4.5 and later models. On earlier models Claude Code loads all MCP tools upfront.
- **Implication for Probanda:**
  - The residual standing cost is the name list (several hundred long names such as `mcp__plugin_lawyer_data__practice_data__upsert_contact`) plus server instructions. It is no longer the full schemas.
  - Each discovery still costs a ToolSearch round-trip.
  - Run `/context` in Claude Code with your plugins enabled to see the real number before investing.
- **A surface that may still load eagerly:** an open Claude Code issue (#49073) reports that Claude Code Desktop loads MCP tools eagerly regardless of its "Tool access" setting. The reporter saw about 75k tokens for 155 tools, versus "loaded on-demand" in the CLI. I could not verify how Cowork behaves. Check `/context` there too. If Cowork loads eagerly, the case for a CLI becomes much stronger.

### 2. The evidence on tokens and accuracy is real but depends on the baseline

- **Anthropic, "Code execution with MCP" (Nov 4, 2025):** presenting MCP servers as code APIs cut a Google Drive→Salesforce workflow "from 150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%". Much of that saving comes from keeping intermediate results in the execution environment, not from schemas alone.
- **Anthropic, "Advanced tool use":** the Tool Search Tool gives "an 85% reduction in token usage". On MCP evaluations, Opus 4 improved from 49% to 74% and Opus 4.5 from 79.5% to 88.1%; Stacklok notes that "Anthropic's experiments and datasets are not publicly available." Programmatic tool calling cut average usage from 43,588 to 27,297 tokens (37%).
- **Community figures:**
  - mcp2cli claims 96–99% savings, measured against *eager* schema injection.
  - Phil Schmid's mcp-cli post measures "6 MCP servers, 60 tools | ~47,000 tokens" against "After dynamic discovery | ~400 tokens". He calls this "a 99% reduction in MCP-related token usage for this scenario," with static (eager) loading as the baseline.
  - These baselines no longer describe default Claude Code.
- **Contrary evidence:**
  - Smithery's "MCP vs CLI Is the Wrong Fight" found that "native MCP tool integration achieved 91.7% success versus 83.3% for CLI. On successful runs, CLI used 2.9× more billed tokens and took 2.4× longer". Median tokens were 28,838 (MCP) vs 82,942 (CLI tree + descriptions), on Claude Haiku 4.5 and Codex GPT-5.4.
  - A dev.to AWS benchmark found that a plain CLI first lost to MCP. A carefully engineered CLI later beat MCP by 43–60% on input tokens, but only after per-service wrapper work.
  - Scalekit's "MCP is up to 32× more expensive than CLI" (Mar 11, 2026) ran 75 tasks on Claude Sonnet 4 against GitHub's 43-tool Copilot MCP server: "CLI: 25/25 (100%). CLI+Skills: 25/25 (100%). MCP: 18/25 (72%)". Scalekit adds that "Every failure was a TCP-level timeout", which points to infrastructure rather than the protocol. Token use was 1,365 vs 44,026 on one task (32×).
- **Bottom line:** CLIs win when the model already knows the CLI or when output is filtered and shaped. They lose when the agent must rediscover a large, unfamiliar surface through `--help`. Probanda's tools are unfamiliar to any model, so discovery ergonomics (grep and namespaces) matter more than the raw token claims.

### 3. The CLI route sidesteps the plugin permission and hook layer

- Claude Code hooks and permission rules key on the tool name. A call routed through `Bash(mcporter call data.practice_data__upsert_contact ...)` is, to Claude Code, just a Bash command.
- Your mail no-delete hook and your "only `files` may move/rename/trash" rule therefore will not fire.
- The only robust fix is to enforce these invariants in server code, which you control. Then add defence in depth:
  - CLI-side allowlists: MCPorter `allowedTools`/`blockedTools`, generated CLIs restricted with `--include-tools`, or mcp2cli bake `--include`/`--exclude`.
  - Optionally, Claude Code Bash permission rules that deny the CLI for sensitive servers.

## Details: Catalogue by Category

### (A) Runtime generic CLIs (connect to any server; list / describe / call)

**MCPorter: openclaw/mcporter (formerly steipete/mcporter)**
- **What it is:** a TypeScript runtime and CLI with `list`, `call`, `resource`, `auth`, `generate-cli`, `emit-ts`, `record`/`replay`, `daemon` and `serve`.
- **Install:** `npx mcporter` or `npm install -g mcporter`. Requires Node 24+ for npm installs.
- **Stdio and env:** works with stdio servers via config or ad-hoc `--stdio`. Config accepts `command`/`args`/`env`/`cwd` and `${VAR}`/`${VAR:-fallback}` placeholders. It auto-imports Claude Code, Cursor, Codex and VS Code configs.
- **Persistence:** `"lifecycle": "keep-alive"` routes a server through a per-login daemon that keeps the stdio process warm, with `daemonIdleTimeoutMs`. Ad-hoc `--stdio` targets stay per-process unless persisted to config. Generated CLIs can also use the daemon.
- **Filtering:** per-server `allowedTools` (an empty array blocks everything) or `blockedTools` (hidden from `list`, rejected by `call`). A generated CLI "embeds the policy of the config file or definition it was generated from". `generate-cli` adds `--include-tools`/`--exclude-tools`, and an unknown include is an error.
- **Arguments and output:** `key=value` or `key:value` flags, function-call syntax, `--args '{json}'`, and `--output json`.
- **OAuth:** OAuth with an optionally encrypted vault.
- **Adoption and maintenance:** about 5.1k stars, 359 forks, 1,011 commits. Latest release is **v0.15.0 (Oct 16, 2026)**, with commits on main since.
- **Windows:** CI covers Node 24 on Linux, macOS and Windows. A Windows 11 bug in which the daemon failed on non-elevated accounts (ACL read, issue #380) was fixed in PR #390. The changelog records further Windows daemon hardening.
- **License:** MIT.

**mcpc: apify/mcpc**
- **What it is:** a universal CLI client. Session commands include `tools-list`, `tools-get`, `tools-call`, `grep`, resources, prompts, completions, async tasks, skills and logs.
- **Install:** `npm install -g @apify/mcpc` or Bun. No minimum Node version is stated.
- **Stdio and env:** stdio servers connect via config-file entries (`mcpc connect ./x.json:entry @name`). Stdio servers inherit only a minimal env whitelist, so you must forward other variables via `env`. Stdio `env` values are stored in the OS keychain per session, and the README says no secrets are visible in `ps`.
- **Persistence:** a persistent bridge process per named session.
- **Arguments:** `key:=value` with JSON auto-parsing, inline JSON, or piped stdin JSON. Stdin is the best route for avoiding Windows quoting problems.
- **Output and errors:** `--json` emits spec-shaped objects (stdout on success, stderr on error). Exit codes are 0 success, 1 client error, 2 server error, 3 network error, 4 auth error.
- **Discovery and safety:** `grep` exits 1 on no match. Tool listings show read-only/destructive annotations. `--schema` snapshot validation is available for CI.
- **Feature gaps:** elicitation is "Planned". The README documents no per-tool allow/deny filter.
- **Adoption and maintenance:** about 1.1k stars, 813 commits. Latest release is **v0.8.0 (Nov 4, 2026)**, which fixed duplicate or orphaned bridges on Windows (issue #427, PR #428).
- **License:** Apache-2.0.

**mcp2cli: knowsuchagency/mcp2cli (Python)**
- **What it is:** turns MCP, OpenAPI or GraphQL into a CLI at runtime. Subcommands and flags are generated from tool schemas.
- **Install:** `uvx mcp2cli` or `uv tool install mcp2cli`.
- **Stdio and env:** `--mcp-stdio "node server.js" --env K=V`.
- **Configuration and filtering:** bake mode saves named configs with `--include`/`--exclude` globs, and `bake install` writes a `~/.local/bin` wrapper.
- **Discovery:** `--list --top N --compact` and `--search`, with usage-ranked listings.
- **Output:** `--json` returns the full `CallToolResult` including `structuredContent`; `--toon` and `--head N` shrink large outputs.
- **Caching and secrets:** 1-hour schema cache. `env:`/`file:` prefixes keep secrets out of argv.
- **Schema handling caveat:** a PR merged Nov 9, 2026 notes that `--list --json` "flattens each tool into CLI parameters, which loses nested schemas". The same PR adds `--schema`, `--req-json` and Windows `--session` support, bumped to 3.9.0. That release may not yet be on PyPI. The PyPI page I saw listed 3.3.1 (Jun 30, 2026), while a fork's issue cites upstream v3.8.0 (Oct 29, 2026), so the exact current version is uncertain.
- **Adoption:** about 2.4k stars, 176 forks.
- **License:** MIT.

**Official MCP Inspector CLI and `mcpdo`: modelcontextprotocol/inspector**
- `npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/list` makes a one-shot connect/run/exit call. It takes `-e KEY=VAL`, `--tool-name`/`--tool-arg` and `--format json`.
- `mcpdo` (experimental, same package) "connects once and keeps the connection open".
- Requires Node ≥22.19. About 11.1k stars, supports protocol 2026-07-28.
- Best used as a test and CI harness for your servers, not as the agent-facing CLI.
- License: not verified in this research.

**FastMCP CLI: PrefectHQ/fastmcp (Python, v3.0+)**
- `fastmcp list --command '...' --json --input-schema` and `fastmcp call ... --json`.
- Known bug (#5882): `fastmcp call --command` cannot call a tool on a stdio command server, although `list --command` works. That bug makes it unsuitable for your bundled Node servers today.

**Older or stale generic clients (avoid for Probanda):**
- **philschmid/mcp-cli** (Bun single binary). Offers `allowedTools`/`disabledTools`, a lazy-spawn connection daemon and grep. The mcpc comparison table flags it as stale (30 commits).
- **f/mcptools** (Go). Notable for `mcp guard --allow/--deny` proxy filtering, but its client hardcodes protocol 2024-11-05 and it is flagged stale.
- **IBM/mcp-cli.** An LLM chat client rather than a pure CLI.
- **wong2/mcp-cli** and **adhikasp/mcp-client-cli.** Stale.

**Newer small entrants (2026; low adoption, watch only):** lydakis/mcpx (Go), arcadeai-labs/mcpx (TS), mcp2cli/source-code (Rust; per-server named CLI with typed flags), activeing123/mcptoon (TOON output), EstebanForge/mcp-cli-ent, mcpshim, domdomegg/call-mcp.

### (B) Code generators (MCP schemas → standalone CLI or typed SDK)

- **MCPorter `generate-cli` / `emit-ts`.**
  - Emits a Commander.js CLI for one server, with embedded schemas and optional Rolldown bundle or Bun-compiled binary.
  - `--include-tools`/`--exclude-tools` select tools, and `--from` regenerates.
  - `emit-ts` emits `.d.ts` types or a typed client. This is the closest open-source implementation of Anthropic's "filesystem of typed wrappers" pattern.
- **thellimist/clihub (Go).**
  - Compiles a server into a static Go binary with one subcommand per tool, with `--include-tools`/`--exclude-tools`. One user reported compiling 142 tools.
  - The same user hit a `--raw` flag collision.
  - Single maintainer, flagged stale. Requires a Go toolchain to generate.
- **volodymyrsmirnov/mcp-bin (Go)** and **mongodben/mcp-2-cli (npm, stdio-only).** Small projects that convert MCP servers to CLIs.
- **myeolinmalchi/mcp2cli.** A Claude Code plugin that has Claude analyse server source and write a TypeScript CLI plus `SKILL.md` (LLM-driven, not deterministic).
- **Code Mode libraries:**
  - Cloudflare `@cloudflare/codemode` (MIT, in cloudflare/agents) generates TypeScript declarations from MCP schemas and executes model-written code in a sandbox, but it is designed around Cloudflare Workers.
  - UTCP `code-mode` (MPL-2.0) runs TypeScript tool chains against MCP servers, including stdio.
  - Both are a different architecture (a code sandbox) from a shell CLI.

### (C) Bridges and gateways (MCP → HTTP, callable by curl)

- **MCPorter `serve --http <port>`** exposes keep-alive servers as one Streamable HTTP endpoint.
- **mcpc `connect --proxy`** exposes a session as a localhost MCP server that hides credentials.
- **sparfenyuk/mcp-proxy**, **IBM/mcp-context-forge** and REST wrappers exist.
- For Probanda these add a network surface without adding much value. Use them only if Cowork's sandbox cannot spawn your bundles directly.

### (D) Reverse direction (CLI → MCP), for disambiguation only

These wrap an existing CLI as an MCP server. They are not relevant here.

## Comparison Table

| Tool | Cat. | Language / install (no admin) | Stdio + env | Schema → flags | Daemon / persistent | Allow/deny filter | Windows + user-level | Maintenance (last release) | License | Probanda fit |
|---|---|---|---|---|---|---|---|---|---|---|
| MCPorter | A+B | TS; `npx`/`npm -g`; Node 24+ | Yes (config `env`, `cwd`) | `key=value` flags; generated Commander CLIs | Yes, keep-alive daemon | Yes: `allowedTools`/`blockedTools`; `--include-tools` | Windows CI; non-admin daemon bug fixed | Very active; v0.15.0, Oct 16, 2026 | MIT | **8.5/10** |
| mcpc | A | TS; `npm -g` | Yes (config entry; env in keychain) | `key:=value`, JSON, stdin | Yes, bridge per session | None documented | Win supported; bridge leak fixed in 0.8.0 | Very active; v0.8.0, Nov 4, 2026 | Apache-2.0 | **7.5/10** |
| mcp2cli | A | Python; `uvx`/`uv tool` | Yes (`--mcp-stdio`, `--env`) | Dynamic flags; nested schemas flattened | `--session` (Windows support just merged) | Bake `--include`/`--exclude` globs | uv is user-level | Active; 3.9.0 merged Nov 9, 2026 (PyPI status unverified) | MIT | 6.5/10 |
| Inspector CLI / mcpdo | A | TS; `npx`; Node ≥22.19 | Yes (`-e`) | `--tool-arg k=v` | mcpdo (experimental) | No | npx, user-level | Active (official) | Not verified | 5/10 (testing) |
| FastMCP CLI | A | Python; `uvx` | `list` yes; `call --command` broken (#5882) | Schema-coerced `k=v` | No | No | uv, user-level | Active | Not verified | 4/10 |
| philschmid/mcp-cli | A | Bun binary | Yes | JSON args | Lazy-spawn pool | `allowedTools`/`disabledTools` | Install script is bash-oriented | Stale | Not verified | 4/10 |
| f/mcptools | A+C | Go binary | Yes | JSON args | No | `guard` proxy | Binary in user dir | Stale; protocol 2024-11-05 | Not verified | 3/10 |
| clihub | B | Go; needs Go toolchain | Yes | One subcommand per tool | No | `--include/--exclude-tools` | Static binary | Stale; 1 maintainer | MIT | 3/10 |
| In-house `probanda` CLI | B | Your TS bundle | Native | You control (namespaces) | Optional | Shared with server policy | Ships in plugin | You | Yours | **9/10 (long-term)** |

Scores are the researcher's judgement, weighted toward guardrail preservation, Node/Windows fit and maintenance.

## Probanda-Specific Fit and Risks

1. **Plugin path variables.**
   - Outside Claude Code, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` are not set. Your CLI config must pass both explicitly as `env`, plus `cwd`.
   - Otherwise the server will look in the wrong place for its SQLite database and the per-machine credentials stored by `configure_credential`. It may silently create a second, empty store.
   - Point `CLAUDE_PLUGIN_DATA` at the *same* directory Claude Code uses, not a copy.
2. **Two writers on one SQLite database.**
   - A keep-alive daemon (MCPorter) or session bridge (mcpc) holds a long-lived server process. Claude Code may simultaneously run its own instance of the same server.
   - Confirm your DB layer uses WAL mode and busy timeouts.
   - Alternatively, use ephemeral lifecycle (spawn per call) for write-heavy servers until you have tested this.
3. **Guardrails.**
   - Move the mail no-permanent-delete and file-move restrictions into server code.
   - Start with an allowlist of read-only tools for `data`, `contacts-calendars-email` and `files`.
   - Keep `configure_credential` out of agent-facing CLIs. Credentials passed as flags land in shell history. Use `env:`/`file:` prefixes (mcp2cli), config `env` (MCPorter), or mcpc's keychain-backed `env`.
4. **Windows quoting.**
   - JSON in PowerShell or cmd quoting breaks easily. Prefer piping JSON through stdin (mcpc), `--args` with single-quoted JSON in Git Bash (MCPorter), or a JSON args file.
   - Use forward slashes in config paths.
5. **User-level installs.**
   - MCPorter needs Node 24+. If the machine-wide Node is older, use a portable Node zip or a user-level version manager in your profile directory.
   - `npm -g` installs into the user prefix without admin.
   - mcp2cli needs only `uv` (user-level).
6. **Cowork constraints.**
   - Do not rely on a plugin top-level `bin/`.
   - Ship any CLI as a self-contained JS file inside the existing bundle directory and invoke it as `node "${CLAUDE_PLUGIN_ROOT}/<path>/cli.js"` from a skill.
   - Global npm installs may not persist in the VM. Bundling the CLI avoids that dependency.
7. **Several hundred tools in one server.**
   - Generic tools list flat names. Your `namespace__tool` naming makes `mcpc grep practice_data` or `mcp2cli --search drafting_forms` workable.
   - Flag-per-property generation struggles with nested objects and arrays. Plan on JSON input for complex tools.

## Recommendations: Pilot Plan

**Step 0 (½ day): baseline.**
- In Claude Code and in Cowork, run `/context` with all seven plugins enabled.
- Record standing MCP tokens and whether tools show "loaded on-demand".
- If both surfaces defer and the standing cost is under a few thousand tokens, frame the project around scripting and testing rather than context.

**Step 1: MCPorter on `canlii` (read-only, so lowest risk), then `timecamp` (credentialed).**

Create `<home>/.mcporter/mcporter.json` (paths illustrative):
```json
{
  "mcpServers": {
    "canlii": {
      "command": "node",
      "args": ["<repo>/plugins/researcher/<bundle>/canlii.js"],
      "cwd": "<repo>/plugins/researcher",
      "env": { "CLAUDE_PLUGIN_ROOT": "<repo>/plugins/researcher",
               "CLAUDE_PLUGIN_DATA": "<same data dir Claude Code uses>" },
      "lifecycle": "keep-alive",
      "allowedTools": ["<search tool>", "<get-decision tool>"]
    }
  }
}
```
Then:
```bash
npx mcporter list canlii --schema
npx mcporter call canlii.<tool> query="limitation period" --output json | jq .
npx mcporter daemon status
npx mcporter generate-cli canlii --include-tools <a>,<b> --bundle dist/canlii-cli.js
node dist/canlii-cli.js --help
```
Check the exact `allowedTools` placement against MCPorter's `docs/config.md` before relying on it.

**Step 2: mcpc on the same server, for comparison.**
```bash
npm install -g @apify/mcpc
mcpc connect ./probanda.mcp.json:canlii @canlii
mcpc @canlii grep search
mcpc @canlii tools-get <tool>
echo '{"query":"limitation period"}' | mcpc --json @canlii tools-call <tool>
mcpc @canlii close
```
Pass `CLAUDE_PLUGIN_*` through the entry's `env` block, because mcpc forwards only a minimal env whitelist.

**Step 3: agent trial.**
- Write one small skill per server (MCPorter's docs recommend per-server skills over one generic skill) with 3–5 named commands.
- Run 10–20 representative tasks with the plugin MCP server enabled versus the CLI skill.
- Compare tokens, success rate and wall time.

**Step 4: scale to `data`.**
- Only after the guardrails are enforced in the server.
- Expose by namespace: start with `knowledge`, `rules` and `research_filing` reads, add `practice_data` writes last.
- Use `generate-cli --include-tools` per namespace so each agent-facing CLI is small.

**Step 5: decide build vs adopt.** If the pilot shows value, build the in-house CLI below. Keep MCPorter or mcpc for ad-hoc debugging and the Inspector CLI for CI.

### Building a thin in-house CLI (likely the end state)

You control the server source, so you can do better than any generic wrapper:
- **One entry point inside the existing bundle** (for example `dist/cli.js`). Either:
  - import the same tool registry and handlers and call them directly, with no MCP hop and no extra process; or
  - use the official MCP TypeScript SDK `Client` with `StdioClientTransport` to spawn the bundle.
- **Subcommands mirroring progressive discovery:**
  - `probanda servers`
  - `probanda tools data --ns practice_data`
  - `probanda schema <tool>`
  - `probanda call <tool> --json @args.json | -`
  - Commander or yargs is sufficient. JSON input avoids flag generation for nested schemas.
- **A shared policy module** imported by both the MCP server and the CLI, so the no-delete and files-only-move rules, plus read-only modes, cannot diverge.
- **Agent-friendly contract:** compact `--help`, JSON on stdout, errors on stderr, mcpc-style exit codes, and `--fields`/`--head` to trim large payloads and return file paths instead of contents.

The researcher estimates this as a small project (a few hundred lines on top of the existing registry). That is an estimate, not a measured figure. It beats adopting a third-party tool once you need guardrail parity, Cowork-safe packaging, and namespace-aware discovery across hundreds of tools.

## Caveats

- Star counts, versions and dates are as observed in early November 2026. mcp2cli's current PyPI version is inconsistent across sources (3.3.1 vs 3.8.0 vs 3.9.0 merged Nov 9, 2026).
- Licenses for the Inspector, FastMCP, mcptools and philschmid/mcp-cli were not verified in this research.
- Cowork's tool-search behaviour and plugin packaging rules could not be verified beyond what the maintainer stated.
- Hook-bypass behaviour follows from how Claude Code keys hooks and permissions on tool names. Test it directly with your mail hook before relying on it.
- Benchmarks are vendor or community measurements with differing baselines; OnlyCLI's figures were seen only secondhand. Stacklok's blog says "Stacklok MCP Optimizer achieves 94% accuracy… Anthropic's Tool Search Tool achieves only 34% accuracy" on 2,792 tools with Claude Sonnet 4.5. That claim comes from a competing vendor, and an independent GitHub issue (crunchtools/trentina #473) notes "the comparison can't be reproduced."
- Excluded paid or closed options (footnote): Composio CLI/hosted toolkits, Smithery hosted services, and Safeguard MCP Guardrail. They were left out because the brief asked for free, open-source tools only.

## Sources

- https://www.matthewswong.com/en/blog/claude-code-tool-search-deferred-tools/
- https://code.claude.com/docs/en/mcp
- https://github.com/ericbuess/claude-code-docs/blob/main/docs/mcp.md
- https://www.nihardaily.com/posts/your-mcp-connector-spends-context-before-you-type
- https://github.com/mnemoverse/mcp-memory-server/pull/234
- https://github.com/anthropics/claude-code/issues/49073
- https://www.anthropic.com/engineering/code-execution-with-mcp
- https://daily.dev/posts/github---knowsuchagency-mcp2cli-turn-any-mcp-server-or-openapi-spec-into-a-cli-at-runtime-with-z-olbhdwpeq
- https://context7.com/knowsuchagency/mcp2cli
- https://dev.to/webramos/mcp-vs-cli-for-ai-agents-a-real-aws-benchmark-and-why-the-popular-narrative-asks-the-wrong-4h8
- https://github.com/openclaw/mcporter
- https://www.npmjs.com/package/mcporter?activeTab=readme
- https://mcporter.sh/install.html
- https://github.com/openclaw/mcporter/blob/main/docs/config.md
- https://newreleases.io/project/github/openclaw/mcporter/release/v0.13.9
- https://github.com/openclaw/mcporter/blob/main/CHANGELOG.md
- https://github.com/steipete/mcporter/blob/main/README.md
- https://deepwiki.com/steipete/mcporter/3.2-server-definitions
- https://github.com/openclaw/mcporter/blob/main/docs/cli-reference.md
- https://atskills.one/steipete/mcporter
- https://github.com/apify/mcpc
- https://github.com/openclaw/mcporter/releases/tag/v0.15.0
- https://github.com/openclaw/mcporter/issues/380
- https://github.com/openclaw/mcporter/pull/390
- https://alternativeto.net/software/mcp2cli/about
- https://github.com/knowsuchagency/mcp2cli
- https://github.com/apify/mcpc/releases/tag/v0.8.0
- https://github.com/apify/mcpc/blob/main/CLAUDE.md
- https://github.com/apify/mcpc/blob/main/README.md
- https://github.com/apify/mcpc/pull/428
- https://deepwiki.com/knowsuchagency/mcp2cli
- https://tokrepo.com/en/workflows/mcp2cli-turn-mcp-servers-into-cli-tools-zero-codegen-54b79071
- https://github.com/knowsuchagency/mcp2cli/pull/129
- https://pypi.org/project/mcp2cli/
- https://github.com/Sanmarcsoft/mcp2cli/issues/3
- https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/cli
- https://www.augmentcode.com/mcp/mcp-inspector
- https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/mcpdo
- https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector
- https://gofastmcp.com/docs/v3/cli/client
- https://github.com/PrefectHQ/fastmcp/issues/5882
- https://daily.dev/posts/introducing-mcp-cli-a-way-to-call-mcp-servers-efficiently-rpwozfkvv
- https://github.com/f/mcptools
- https://mcporter.sh/
- https://deepwiki.com/steipete/mcporter
- https://github.com/thellimist/clihub
- https://dev.to/simplemindedrobot/i-deleted-all-my-mcp-servers-and-everything-got-faster-3k8l
- https://github.com/mongodben/mcp-2-cli
- https://github.com/volodymyrsmirnov/mcp-bin
- https://github.com/myeolinmalchi/mcp2cli
- https://www.npmjs.com/package/@cloudflare/codemode
- https://www.jahanzaib.ai/blog/cloudflare-code-mode-mcp
- https://github.com/universal-tool-calling-protocol/code-mode
- https://github.com/openclaw/mcporter/blob/main/README.md
- https://mcporter.sh/cli-reference.html
- https://phasetransitionsai.substack.com/p/mcp-plumbing-landscape
- https://github.com/openclaw/mcporter/blob/main/docs/agent-skills.md
- https://safeguard.sh/resources/blog/mcp-guardrail-for-ai-agents-guide
