# Beyond Token Savings: Should Probanda's MCP Tools Become a "Model-Native" CLI?

> Research report saved 2026-11-09. Produced by a Claude extended-research task (task id wf-8794f735-10d1-8fbe-8997-2c608c76e93f) for the probanda-dev maintainer, as a follow-up to `2026-11-09_mcp-to-cli-open-source-tools.md`. It draws on outside sources and has not been independently verified; see its Caveats section.

**Bottom line:** Yes, but only for some tools. The main gains left from a CLI are no longer the tool-definition tokens. They are composability (filtering large results before they reach the model), reproducibility and scripting without an LLM, easier debugging, and fewer round trips. The idea that copying familiar CLI syntax makes a tool usable without instructions is only partly supported. Models are fluent with the real `gh`, `git`, `jq` and `sqlite3`, but no published study shows that a new CLI that merely looks like them gets the same benefit, and there is evidence that look-alike syntax can cause invented flags.

## TL;DR

- **The premise is mostly right.** Claude Code now defers MCP tool definitions by default (tool search), so the cost of loading several hundred `data` tools has largely gone. The headline "MCP costs 4–32× more tokens than CLI" numbers (Scalekit, March 2026) were measured against a remote 43-tool GitHub server without tool search. Savings still exist for *intermediate results*, which a CLI can filter with `jq`/`head`/`grep` before they enter context, and for multi-step analysis, where Arize (May 2026) measured MCP at more than 6× the cost of CLI skills on hard tasks.
- **The "trained-on CLIs are intuitive" hypothesis is half true.** Models clearly use *famous* CLIs from their training weights: bare Claude with no skill did as well as skill-guided `gh` in Arize's 500-trial eval. Smithery found that blind success ranged from 91.7% on GitHub to 16.7% on Linear depending on how familiar the API was. But Probanda's commands will not be in any model's training data. Borrowing *conventions* (noun-verb subcommands, `--json`/`--jq`, `--dry-run`, exit codes, SQL) helps. Imitating a specific tool's surface is risky, because one ablation found agents applying Kubernetes-style flags to `gcloud` and failing. You will still need a short skill and good `--help`.
- **Recommendation:** Pilot a hand-designed, read-mostly `probanda` CLI for the `data` server (matters, time entries, knowledge store, rules, commons) and for CanLII research. Keep mail sending/moving, file mutation and anything that must run in Cowork's sandbox as MCP for now. Before converting further, run an A/B/C test (MCP vs generic wrapper vs model-native CLI, each with and without a skill, plus an "unfamiliar-syntax" control).

## Key Findings

### 1. Is the premise right? Where token savings went, and where they remain

**What changed (2025–2026):**

- **Claude Code tool search is on by default.** According to the current Claude Code MCP docs (code.claude.com, retrieved November 2026), "Tool search is enabled by default: MCP tools are deferred and discovered on demand." Only tool names and server instructions load at session start, and "Claude Code doesn't impose a fixed per-server tool cap; the practical limit is your context window budget." An earlier version, Claude Code v2.1.7 (released 14 January 2026, per the official changelog), "Enabled MCP tool search auto mode by default for all users. When MCP tool descriptions exceed 10% of the context window, they are automatically deferred and discovered via the MCPSearch tool instead of being loaded upfront." Community reports from before that change described 7+ servers using 67,000+ tokens up front.
- **Anthropic's API-level tool search (24 November 2025).** In "Introducing advanced tool use", Anthropic reported tool definitions using 134K tokens internally before optimisation. It gave an example where loading all definitions upfront ("~72K tokens for 50+ MCP tools") meant "~77K tokens before any work begins"; with only the Tool Search Tool loaded (~500 tokens), "Total context consumption: ~8.7K tokens, preserving 95% of context window" (an 85% reduction; Anthropic's own figures are approximate). Accuracy on MCP evaluations rose from 49% to 74% (Opus 4) and from 79.5% to 88.1% (Opus 4.5) with tool search enabled. Anthropic also says tool search "doesn't break prompt caching because deferred tools are excluded from the initial prompt entirely."
- **Programmatic tool calling and code execution with MCP.** Anthropic's "Code execution with MCP" (4 November 2025) cut one Drive-to-Salesforce workflow from 150,000 to 2,000 tokens (98.7%). That saving came mainly from keeping *intermediate data* out of context, not from schemas. Programmatic Tool Calling reduced average tokens on complex research tasks from 43,588 to 27,297 (37%).
- **Cloudflare Code Mode (26 September 2025)** argued that "LLMs are better at writing code to call MCP, than at calling MCP directly," on the grounds that models have seen huge amounts of real TypeScript but "only a small set of contrived examples of tool calls." This is the same pretraining-familiarity argument behind the CLI idea, applied to code.

**Where CLI token savings have shrunk:**

- *Tool-definition overhead.* With deferral on, idle MCP tools cost a name each. The large gaps in Scalekit's March 2026 benchmark (repo-language task: CLI 1,365 tokens vs MCP 44,026, or 32×) came almost entirely from "43 tool definitions injected into every conversation" on GitHub's remote Copilot MCP server. As one practitioner noted, those benchmarks "don't mention tool search… so they likely reflect the pre-tool-search experience." For the several-hundred-tool `data` server this was the biggest win a CLI used to offer, and it has mostly gone.
- *Prompt-cache churn.* Anthropic's prompt-caching docs state that modifying tool definitions "invalidates the entire cache" (tools → system → messages). Tool search largely neutralises this, because deferred tools are loaded by reference rather than by changing the prefix. A CLI still never touches the prefix at all, so this is now a minor benefit.

**Where savings persist:**

- *Intermediate results and multi-step analysis.* Arize's eval (Laurie Voss, published 1 May 2026; Claude Opus 4.6; 25 GitHub tasks; 500 trials) found correctness nearly identical across arms (MCP 0.834, skills 0.826–0.833, bare CLI 0.845). On the hardest tier, however, "MCP cost more than six times what the skills cost and took five times longer," averaging about 12 tool calls against 5. Its explanation: "MCP can't compose… gh plus jq plus pipes can compose." In one task the worst MCP run took 71 tool calls and $2, against 7 calls and $0.19 for the skill arm.
- *Tool search has its own costs.* A March 2026 practitioner benchmark (Kun Chen) found tool search "saves upfront tokens but spends them on extra turns," and introduced a new failure mode: 0/5 success on one task where raw MCP got 4/5. His AXI study (425 runs, Claude Sonnet 4.6) reported raw `gh` at 86% success and $0.054/task, GitHub MCP at 87% and $0.148, and MCP+ToolSearch at 82% and $0.147. These are a maintainer's own numbers with an LLM judge, so treat them as indicative.

**Where evidence conflicts:**

- Smithery's 756-run study (March 2026) found *native MCP beating CLI*: 91.7% vs 83.3% success, with median tokens of 28,838 vs 82,942. Its CLI was "auto-generated from API specs," which makes it the closest published analogue to a generic MCP-to-CLI wrapper.
- An AWS ablation (Webmaster Ramos, dev.to, 2026) found a naive CLI at 50% success against MCP's 100%. Only after "half a day of engineering work per service" did a tuned CLI beat MCP by 43–60% on input tokens at equal success. MCP still won on wall-clock time in 4 of 5 tasks.
- Mario Zechner's controlled test (15 August 2025) of the same tool exposed both ways found "MCP vs CLI truly is a wash": both at 100% success, with MCP 23% faster and 2.5% cheaper. Part of the reason was that Claude Code's per-command Bash safety check adds overhead that MCP calls avoid.
- A healthcare-workflow benchmark (CHI-Bench, arXiv 2605.16679, 2026) re-exposed every MCP tool as a CLI via MCPorter and found results "neutral-to-worse": pass@1 changed by −1.3, −6.7 and +2.7 points across three domains. **This is the most relevant data point for Probanda**, because it covers a professional, out-of-distribution domain with a generic wrapper.

**Interpretation:** The data fits one pattern. CLIs win when the model already knows the tool and the task needs composition. MCP wins or ties when the surface is unfamiliar, the CLI is auto-generated, or the task maps one-to-one onto a well-designed tool. A generic wrapper over Probanda's MCP servers is likely to give you neither benefit.

### 2. Testing the hypothesis: do familiar-looking CLIs need no instructions?

**Evidence for:**

- **Famous CLIs really are used from the weights.** Arize added a fourth arm, "bare Claude with a generic system prompt, no MCP, no skill," and found it "barely behind the skills… For a popular CLI, the training data is doing most of the work." Scalekit's no-guidance CLI arm worked out `gh` commands unaided at 100% reliability.
- **Familiarity drives success sharply.** Per the Smithery study, as reproduced by Nordic APIs (May 2026), blind raw-API calling succeeded 91.7% on GitHub, 41.7% on Singapore Bus and 16.7% on Linear. Smithery: "Blind API calling only works when the model already knows the shape — GitHub survives on prior familiarity."
- **Anthropic's own guidance** says CLI tools "are the most context-efficient way to interact with external services," and adds that "Claude is also effective at learning CLI tools it doesn't already know," recommending prompts such as "Use 'foo-cli-tool --help' to learn about foo tool" (Claude Code best practices, current docs).
- **SkillsBench** (Li et al., arXiv 2602.12670, v4 14 June 2026; 87 tasks, 18 model–harness configurations) found that "Domains requiring specialized procedural knowledge underrepresented in model pretraining… improve most, whereas domains with stronger pretraining and tooling coverage benefit less from external procedural guidance"; v1 reported curated skills adding +16.2 points on average, while self-generated skills changed results by −1.3 points. The flip side is that well-represented conventions need less instruction.

**Evidence against or limiting:**

- **Your CLI will not be in the training data.** As Arize puts it: "Your company's CLI is not as famous as GitHub's. The model hasn't seen it… You will need a skill or you will need MCP." Imitating `gh` syntax does not put `probanda matter list` into the weights. At best the model generalises from conventions.
- **Look-alike syntax produces invented flags.** In Karl Weinmeister's 72-trial skills ablation (2026), "the baseline agent borrowed Kubernetes conventions, generating invalid flags like --volume-mount" (the correct `gcloud` flag is `--add-volume-mount`). The fix that "eliminated CLI syntax hallucination across the benchmark trials" was forcing a `gcloud help <group> <command>` lookup first. Arcjet's maintainers (2 June 2026) likewise report that agents "remember old command shapes, hallucinate flags, paste identifiers into the wrong place."
- **Variant confusion is a measured failure class.** Terminal-Bench 2.0 (Merrill et al., arXiv 2601.11868, ICLR 2026; 89 tasks; frontier agents under 65%) counts "Cross-shell or GNU/BSD variant mismatch" as a distinct failure mode. In an LLM-judge classification of 3,800 sampled errors, "command not found" made up 24.1% of command failures, and command-failure rates ranged from 9.2% (Grok 4) to 26.7% (GPT-OSS-120B). Even real, familiar tools trip models when variants differ. A fake `git` with different semantics would be worse.
- **No direct test exists.** The researcher found no study comparing a new CLI built to resemble familiar tools against the same CLI with neutral syntax. The closest, Kun Chen's gh-axi (100% vs raw `gh` 86%), *kept* `gh`'s syntax and got its gains from output design (counts, compact format, next-step hints), not from mimicry.

**Verdict:** Copy *conventions*, not *identities*. A model generalises well from patterns it has seen thousands of times: `noun verb` subcommands, `--json fields` and `--jq`, `--limit`, `--dry-run`, SQL `SELECT`, unified diffs, exit code 0 for success. It generalises badly when a command looks like a specific tool but behaves differently. Where real semantics match, **use the real tool**, such as actual `git` on a drafts folder or actual `sqlite3`/SQL on a read-only replica. A short skill (Scalekit: an "800-token skills file… reduces tool calls by a third and latency by a third") remains the cheapest reliable way to teach the rest.

**Design guidance for a "model-native" CLI:**

| Convention to borrow | Source pattern | Probanda use | Caution |
|---|---|---|---|
| `noun verb` subcommands, `--json a,b,c`, `--jq '<expr>'` | `gh` | `probanda matter list --status open --json id,client,limitation_date` | Keep verbs consistent across all nouns (list/view/create/edit/close) |
| Read-only SQL | `sqlite3`/`psql` | `probanda db query "SELECT … FROM matters WHERE …" --csv` on a read-only connection | Publish the schema in `probanda db schema`; never allow writes through SQL |
| Version verbs (`log`, `diff`, `show`) | `git` | Drafts: preferably use **real git** on the drafts folder | Do not build a fake git whose `commit`/`reset` mean something else |
| Search and print | `grep`/`rg`, `cat`, `ls` | `probanda kb search "limitation period" --limit 5`, `probanda kb cat <id>`, `probanda rules show 7-1` | Output `path:line:text` or JSONL so `grep`/`head` compose |
| Folders and messages | IMAP clients (e.g. himalaya's envelope/message/folder verbs) | `probanda mail list --folder INBOX --since 2026-11-01`, `probanda mail move <id> Archive` | Mail-client syntax is less common in training data than `gh`; provide no delete/expunge verb |
| `--dry-run`, `--confirm` | `kubectl`, `terraform plan` | `probanda time push --dry-run` | Mutations return a confirmation envelope (see below) |
| Exit codes and JSON errors on stderr | Unix, Arcjet | 0 ok, 2 auth, 3 validation, 4 confirmation required | Treat it as a contract once agents learn it |

**Techniques that make unfamiliar commands learnable** (mostly from maintainer write-ups, so practitioner evidence rather than controlled studies):

- `--help` that starts with a one-line usage shape followed by 3–5 realistic examples. Arcjet: "The first line is the contract. The following lines are examples an agent can adapt."
- Errors that name the correct command and the remediation, e.g. `{"error":"…","code":2,"remediation":"Run 'probanda auth login'…"}`.
- **Did-you-mean is contested.** Arcjet deliberately turned it off ("unknown commands and flags are hard failures") because fuzzy suggestions can be taken as confirmation. A middle path is to suggest a command in the error text but never auto-execute it.
- JSON by default when stdout is not a TTY, plus `--fields` to trim output.
- Stable, additive-only changes after 1.0 ("Add a new flag, but do not change the meaning of an existing flag").
- A `probanda skills` or `probanda help agents` page, and a Claude Skill that is short and opinionated. Arize found a 341-line opinionated skill beat a 2,187-line encyclopedic one on cost.

## Details

### 3. Non-token benefits of CLI over MCP

| Benefit | Evidence / source | Strength of evidence | Size of benefit | Risk / caveat | Relevance to Probanda |
|---|---|---|---|---|---|
| Composability (pipes, `jq`, `sort`, `head` before context) | Arize (May 2026): MCP >6× cost on tier-4 analysis; Anthropic code-execution post (Nov 2025) | Strong (controlled evals) | Large for analysis/reporting; nil for single lookups | Model may write fragile pipelines; Windows shell differences | High: time-entry analysis, matter reports, KB search |
| Keeping client data out of context | Anthropic code-execution post: "intermediate results stay in the execution environment by default"; Arcjet `--fields` | Moderate (design argument plus token data) | Potentially large for confidentiality | Only if commands filter by default; a careless `cat` defeats it | **Very high** (solicitor-client privilege, Law Society confidentiality duties) |
| Fewer round trips via loops and batching | Arize: ~12 vs ~5 calls; Anthropic PTC 37% fewer tokens | Strong | Medium–large on bulk tasks | Batches magnify mistakes; needs `--dry-run` | High: time-tracking pipelines, bulk matter updates |
| Reproducibility and scripting without an LLM (cron, CI, replays) | Ronacher (Jul 2025): code offers "repeatability and human reviewability"; Arcjet: same binary for CI | Moderate (expert opinion, widely corroborated) | Large over time | Must version the CLI | High: scheduled time sync, nightly reports, audit replays |
| Human debugging (maintainer reruns the exact command) | Ronacher; async-let (2025): MCP failures "incredibly hard to debug" | Moderate (practitioner consensus) | Medium | Need the exact command logged | High: a sole maintainer benefits greatly |
| Golden-output tests per command | Anthropic "Writing effective tools" (Sep 2025) urges eval-driven tool design; CLIs are trivially snapshot-testable | Moderate (inference) | Medium | Also possible for MCP via an SDK harness | Medium–high |
| Portability across harnesses (Codex, Gemini CLI, IDEs) | Arcjet: "Most agents already have shell access"; Holmes (Feb 2026) | Moderate | Medium; MCP is also cross-client | Every harness needs shell permission; quoting varies | Medium: mainly Claude Code/Cowork today |
| Permission granularity by command prefix | Claude Code permissions docs: Bash rules are prefix-matched and "aware of shell operators"; compound commands must match each part | Strong (documented) | Medium | Older issue reports of chained-command bypasses (#36637); MCP-name hooks won't fire on Bash | High, but hooks must be rewritten |
| Dry-run and confirmation envelopes | Arcjet's exit-code-4 `confirmCommand` protocol | Moderate (one maintainer design) | Medium | Agent may simply add `--confirm`; pair with an `ask` permission rule | High: mail moves, time pushes |
| Audit log of every invocation | Wrapper logs argv, user, timestamp, exit code | Moderate (engineering inference) | Medium | Logs may capture client data; MCP servers can log too | High for a law practice |
| Reliability (no server crash, stdio, reconnects) | Scalekit: 7/25 MCP runs failed with `ConnectTimeout` (remote server) | Weak for local stdio (the failures were remote-network) | Small for local stdio servers | CLI cold-start on every call (Node startup) | Low–medium: Probanda's servers are local stdio |
| Context-stable prompt cache | Anthropic caching docs: tool-definition changes invalidate the whole cache | Strong, but mostly neutralised by tool search | Small now | — | Low |
| Subagents without inheriting MCP definitions | Inference from deferral design | Weak | Small | — | Low |
| Skills compatibility (skills bundle scripts and CLIs) | Anthropic Skills; Scalekit skill result | Moderate | Medium | Skill drift if the CLI changes | High: a plugin can ship the CLI plus SKILL.md |

**Drawbacks to weigh:**

- **Loss of typed schemas and server-side validation** has to be rebuilt in the CLI (validate IDs before any network call, as Arcjet does).
- **Loss of MCP features**: structured content, elicitation, progress, and the OAuth flows that Arize and Scalekit treat as decisive for multi-user or enterprise settings.
- **Windows quoting and escaping problems** with JSON arguments (*unverified for your setup*; prefer `--input file.json` or stdin over inline JSON).
- **Secrets in shell history or process lists.** Read credentials from the OS keychain or a config file, never from flags.
- **Shell-route bypass of MCP-layer hooks.** A hook keyed to `mcp__probanda__mail_delete` does nothing against `probanda mail …` in Bash, let alone against raw `curl`.
- **The model improvising dangerous shell compositions.** Arize observed even the MCP arm "shelled out to bash" when the tools couldn't compose, with tool fidelity of 0.33. Agents leave the intended boundary when it is too narrow.
- **Cowork sandbox constraints (important).** Per Anthropic's Cowork architecture doc, local plugin MCP servers run natively on the device, while "Shell commands and any code Claude writes execute inside a dedicated Linux VM" with its own network egress filtering. A GitHub issue (#28067) documents a static domain allowlist blocking plugin connections. A CLI that needs IMAP, CalDAV, CanLII or TimeCamp network access may therefore *fail inside Cowork* even though the same calls work as MCP. In cloud Cowork sessions, local MCP servers do not run at all.

### 4. Counter-arguments and expert positions

- **"MCP is dead, just use CLIs."** Eric Holmes, "MCP is dead. Long live the CLI" (28 February 2026, top of Hacker News): "Ship a good API and a good CLI. The agents will figure it out." Armin Ronacher, "Tools: Code Is All You Need" (3 July 2025) and "Your MCP Doesn't Need 30 Tools: It Needs Code" (18 August 2025), argues that MCP is neither composable nor context-efficient and that code is reviewable and repeatable. *Strongest form:* for local tools the model already knows, a schema layer adds cost without adding capability. This is well supported by the Arize and Scalekit data for `gh`.
- **"MCP remains better."** Scalekit (11 March 2026) published the benchmark against itself and still argues that agents acting for *other people* need "per-user authorization… explicit tool boundaries… structured audit trail." Arize: "MCP uses OAuth… Enterprise control." Smithery: "for remote services, especially large internal APIs with zero training priors, or for security-sensitive workflows, a typed agent contract beats forcing every model through raw shell syntax." *Strongest form:* for unfamiliar, proprietary surfaces, schemas carry exactly the knowledge the weights lack. The Smithery and CHI-Bench numbers support this.
- **The hybrid view, which the researcher considers best supported.** Zechner: "The protocol is just plumbing." Arize: "Use both." Arcjet treats the CLI and MCP server as "peer clients for the same platform." In practice, keep one core library and expose it through (a) MCP for connection, auth, guarded mutations and non-shell clients, and (b) a CLI for read, filter and batch work, plus a short skill. Anthropic's own direction (tool search plus programmatic tool calling plus code execution) is a version of this hybrid inside MCP.

### 5. Probanda-specific analysis

| Server family | Value of CLI beyond tokens | Conventions to mimic | Keep as MCP? |
|---|---|---|---|
| **`data`** (practice records, matters, drafting, time pipelines, KB, rules) | **High**: reporting and analysis compose; batch time work; cron and replays; client data filtered in-shell | `gh` noun-verb with `--json/--jq`; read-only `sqlite3`-style `db query`; real `git` for drafts; `rg`-style KB search | Keep MCP for high-stakes writes (matter creation, trust-related records) until the pilot proves the CLI safe |
| **mail / calendar / contacts** (IMAP/CalDAV) | Medium: triage and search filtering; but network access in the Cowork VM is a blocker | `list/read/move` folder-message verbs; RFC-style dates | **Yes** for send/move in Cowork; a read-only CLI is optional in Claude Code. Enforce no permanent deletion *in the binary* (no expunge verb; "delete" means move to Trash) |
| **canlii** | Medium–high: large result sets to filter; caching to disk; reproducible research logs | `gh api`-like `get`/`search` with `--json`, `--limit`, `--page` | Optional; CLI is fine in Claude Code; check Cowork egress |
| **commons** (shared DB) | Medium: SQL is the most "model-native" interface there is | Read-only `sqlite3`/`psql` semantics with `.schema`-like introspection | Keep MCP for writes |
| **files** | **Low**: the shell already *is* the model-native file CLI (`ls`, `find`, `rg`), and that is the guardrail problem | Use native tools for reading | **Yes**. Keep rename/move/trash in MCP and deny `Bash(mv *)`, `Bash(rm *)` and similar, plus a PreToolUse hook |
| **timecamp** | Medium: scheduled sync and `--dry-run` diffs are the main win | `kubectl`/`terraform`-style `plan`/`apply` or `--dry-run` | Either; CLI suits cron |

**What matters most for a law practice:**

1. **Keeping client data out of context.** Make default output IDs and counts, and require `--fields` for content.
2. **Auditability.** Log every invocation with argv, exit code and a hash of the output to an append-only file.
3. **Guardrails enforced in code, not in prompts.** The CLI must be unable to permanently delete mail. Add permission rules such as `deny: Bash(probanda mail expunge*)`, `ask: Bash(probanda mail move *)`, `allow: Bash(probanda matter list *)`. Port existing hooks from MCP tool names to Bash command patterns, and also deny raw network tools against mail hosts if credentials are reachable.
4. **Reproducibility.** The same command reruns without Claude.

**Decision framework (convert a tool to CLI when ≥3 apply; keep MCP when any "keep" item applies):**

- *Convert when:*
  - results are large or need filtering or joining;
  - the operation is read-only or idempotent;
  - it is used in batches or on a schedule;
  - you want to replay or test it without an LLM;
  - it maps naturally onto SQL, `gh`-style or `git` conventions;
  - it runs in Claude Code on the host.
- *Keep MCP when:*
  - it is a destructive or externally visible mutation (sending email, moving mail, file moves) whose guardrail currently lives in the MCP server or hooks;
  - it must run in Cowork with network access the VM cannot reach;
  - it needs OAuth, elicitation or confirmation UI;
  - it is a one-to-one action that tool search already serves cheaply;
  - a non-shell client (desktop chat) must use it.

### 6. Proposed pilot experiment

**Goal:** Measure separately (i) the CLI-versus-MCP effect and (ii) the "familiar conventions" effect.

- **Arms (6 + 2 controls):**
  - (A) existing MCP with tool search on;
  - (B) generic MCP-to-CLI wrapper (e.g. MCPorter-generated);
  - (C) hand-designed model-native CLI.
  - Run each with no instructions and with an 800–1,500-token skill.
  - **Controls:** (C′), the same CLI with identical semantics but deliberately *non-conventional* verbs and flags (e.g. `probanda fetch-matters --fmt=js`), with and without the skill. C vs C′ is the direct test of the hypothesis, which no published study has run.
- **Tasks:** 20–30 fixed tasks on a synthetic practice dataset (fake matters, time entries, a test mailbox, recorded CanLII responses). Split them into lookups, multi-step analyses, batch updates with dry-run, and "guardrail probes" (e.g. "permanently delete these emails", which must be refused or blocked).
- **Runs:** 5–10 repetitions per task and arm, on two models (e.g. Sonnet and Haiku). Use headless `claude -p --output-format stream-json` so every run is logged.
- **Metrics:**
  - success, judged against ground truth;
  - turns and tool calls;
  - input/output and cached tokens;
  - wall time;
  - invalid-command or hallucinated-flag rate;
  - `--help` lookups;
  - guardrail violations, which must be zero;
  - bytes of client-identifying data entering context.
- **Decision rule:** Adopt C for a server family only if it matches A on success, shows zero guardrail violations, and improves turns or tokens by ≥25% on analysis tasks. The hypothesis is supported only if C beats C′ *without a skill* by a meaningful margin, say ≥10 points of success or ≥20% fewer invalid commands.
- **Scope:** Run it on Windows 11 Claude Code first, then repeat a subset in Cowork to confirm network and VM behaviour.

## Recommendations

1. **Don't convert wholesale, and don't use a generic wrapper as the end state.** The Smithery and CHI-Bench evidence suggests auto-generated CLIs are neutral to worse in unfamiliar domains.
2. **Build one core library with two front ends.** Start the CLI with read-only `data`, commons and CanLII commands that use `gh`-style nouns and verbs, `--json`/`--jq`, read-only SQL, and real `git` for drafts.
3. **Ship a short, opinionated skill with the CLI.** Make `--help` example-first, and freeze command names once agents use them.
4. **Re-implement every guardrail at the CLI level** (no delete/expunge verbs, `--dry-run`, confirmation envelopes) *and* in Claude Code permission rules and PreToolUse hooks keyed to Bash patterns.
5. **Run the 8-arm pilot before expanding.** Treat the "intuitive from training" hypothesis as unproven until C beats C′.

## Caveats

- Most CLI-vs-MCP numbers come from vendor or practitioner blogs (Scalekit, Smithery, Arize, Kun Chen) with small samples, single domains (mostly GitHub) and sometimes LLM judges. Several predate default tool search.
- The Smithery post could not be fetched directly; its figures here come from search snippets and the Nordic APIs reproduction.
- No published study tests whether *mimicking* familiar CLI syntax helps a new tool. The guidance above is inference from adjacent evidence.
- The Cowork network and VM behaviour for plugin-invoked CLIs should be verified on the maintainer's installation. Documentation and issue reports describe egress filtering, but specifics change quickly.
- Windows quoting issues and Node cold-start costs are practitioner concerns that were not measured.

## Sources

- https://www.matthewswong.com/en/blog/claude-code-tool-search-deferred-tools/
- https://dev.to/trashwbin/cli-vs-mcp-vs-skills-the-whole-debate-is-asking-the-wrong-question-nc1
- https://ascii.co.uk/news/article/news-20251125-85f14942/anthropic-releases-three-advanced-tool-use-features-for-ai-a
- https://www.anthropic.com/engineering/advanced-tool-use
- https://particula.tech/blog/code-execution-mcp-token-reduction-pattern
- https://habr.com/ru/post/969898
- https://blog.cloudflare.com/code-mode/
- https://www.scalekit.com/blog/mcp-vs-cli-use
- https://kaxil.substack.com/p/mcp-vs-cli-vs-rest
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching
- https://www.respan.ai/articles/claude-prompt-caching
- https://arize.com/blog/mcp-vs-cli-skills-for-agents-what-our-eval-found-and-which-you-should-use/
- https://kunchenguid.medium.com/i-benchmarked-github-cli-vs-mcp-vs-tool-search-vs-code-mode-turns-out-the-best-solution-is-none-93528d5039e4
- https://github.com/kunchenguid/gh-axi
- https://hysenlabs.com/projects/kunchenguid-axi
- https://softmaxdata.com/blog/cli-vs-mcp-how-ai-agents-actually-decide-which-tool-to-call/
- https://smithery.ai/blog/mcp-vs-cli-is-the-wrong-fight
- https://www.metaheuristic.co/blog/mcp-vs-cli-abstraction-tax
- https://dev.to/webramos/mcp-vs-cli-for-ai-agents-a-real-aws-benchmark-and-why-the-popular-narrative-asks-the-wrong-4h8
- https://webmaster-ramos.com/blog/mcp-vs-cli-aws-benchmark
- https://materializedview.io/p/mcp-server-could-have-been-json-file
- https://elite-ai-assisted-coding.dev/p/mcp-vs-cli-benchmarking
- https://mariozechner.at/posts/2025-08-15-mcp-vs-cli/
- https://arxiv.org/pdf/2605.16679
- https://medium.com/@visrow/mcp-isnt-dying-it-s-being-squeezed-from-three-sides-in-2026-7017c17eb697
- https://code.claude.com/docs/en/best-practices
- https://www.analyticsvidhya.com/blog/2026/08/claude-code-best-practices-analysis/
- https://x.com/kweinmeister/status/2099962972798153194
- https://medium.com/google-cloud/still-packaging-ai-models-in-containers-do-this-instead-on-cloud-run-a0219e625bca
- https://arcjet.com/blog/designing-a-cli-for-ai-agents
- https://github.com/kunchenguid/axi/blob/main/bench-github/published-results/STUDY.md
- https://www.firecrawl.dev/blog/mcp-vs-cli
- https://blog.arcjet.com/designing-a-cli-for-ai-agents/
- https://code.claude.com/docs/en/permissions
- https://www.developersdigest.tech/blog/claude-code-permissions-settings-guide
- https://github.com/anthropics/claude-code/issues/36637
- https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview
- https://github.com/anthropics/claude-code/issues/28067
- https://www.harmonic.security/resources/securing-claude-cowork-a-security-practitioners-guide
- https://redreamality.com/blog/claude-cowork-cloud-sandbox-where-agents-run/
- https://medium.com/@flamehaven/is-mcp-really-dead-a-history-of-ai-hype-told-through-the-rise-and-fall-of-a-protocol-8a71ab8c8831
- https://mcpplaygroundonline.com/blog/is-mcp-dead-cli-debate
- https://ksinder.medium.com/the-battle-for-context-why-mcp-vs-cli-is-the-wrong-fight-3c0cb63849a4
- https://daily.dev/sources/mitsuhiko/best-of/2025
- https://nordicapis.com/mcp-vs-cli-which-is-better-for-agentic-ai/
