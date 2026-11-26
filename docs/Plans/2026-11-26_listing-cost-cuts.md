# Listing cost cuts: hand-started skills and deny-and-fork agents

Goal: lower the two fixed costs every session pays before any work, the skill listing (9.9K tokens) and the custom-agent listing (9.8K), measured with `/context` in a new session in this folder. Rule numbers refer to the context-engineering skill.

## What is already done and what was learned (2026-11-26)

- `.claude/settings.json` turns 19 unused plugins off in this repo with `"<name>@synced": false` (commit 8fb699e4). A new `claude -p` session here lists none of their skills.
- `skillOverrides` does not apply to plugin skills (code.claude.com/docs/en/skills). The only ways to hide one plugin skill are its own `disable-model-invocation: true` (only in plugins we own) or turning its whole plugin off.
- The desktop Code tab ignores `enabledPlugins` for plugins it loads from claude.ai (settled 2026-11-26): `/context` in a new Code tab session here still listed the agent `timekeeper:screenshot-reader`, although `timekeeper@synced` is `false` in this repo's settings, and Skills (9.9K) and Custom agents (9.8K) were unchanged. The Code tab's `/context` gives no per-skill breakdown, only a link to the account's plugin settings.
- Usage in this repo's 566 transcripts: about 60 skill names were ever started, by the model or typed. Every other listed skill has never been started here.
- Listing demand, from source files (characters / 4): skills about 17.8K tokens against a cap of about 10K (1% of a 1M window). Probanda's 39 agents about 8.5K of the 9.8K agent listing. Half of the agent cost is tool lists, about half of those being the `mcp__remote-devices__*` copies that Cowork needs, so those stay.

## Part A: hand-started skills (skill listing)

A1. **Check the Code tab.** Open a new Code tab session in this folder and run `/context`. If `ultrapowers-dev`, `trials` and `timekeeper` skills are still listed, the Code tab ignores `enabledPlugins` for claude.ai plugins. Then the only Code-tab switch for them is the app's own plugin settings, which apply to the whole account. Ask Brahm which to uninstall there. Candidates are plugins started nowhere: `ultrapowers-dev`, `trials`, `timekeeper` (retired), `commandments`, `nvidia-skills`, `supabase-expert`.

A2. **Mark never-model-started skills in the toolkit** (repository `C:\Users\Brahm\Git\toolkit`, marketplace `toolkit`). Run this in a session opened in that repository, because it lands there. For each skill in its plugins (`skill-tooling`, `session-flow`, `agent-runners`, `planning`, `design-review`, `software-design`, `code-quality`, `ui-testing`, `docs-writing`, `governance`, `context-engineering`, `git-workflow`, `firebase-genai`, `nvidia`), set `disable-model-invocation: true` only when all of these hold:
- the model has not started it in any transcript under `~/.claude/projects/` (all folders, not only this one), counted with the scan below;
- no skill, agent, hook or CLAUDE.md names it as a Skill-tool target (grep for the name, for example `run-context-architect`);
- no agent preloads it through `skills:` (rule 08: that flag blocks the preload);
- its description is over about 100 characters.

  Typed-only use is fine: the flag keeps the `/name` command. The scan is the Python loop used on 2026-11-26. It reads each `*.jsonl` and counts `tool_use` blocks named `Skill` (model starts) and `<command-name>` tags in user messages (typed starts). Save it as a script in the toolkit if it is run more than once.

A3. **Probanda's own skills are out of scope for A2.** Practitioners rely on their descriptions to start them, so hiding a description changes how the shipped product behaves. Only `developer` skills qualify, under the same tests as A2, followed by `python scripts/build_plugin.py` and `/release`.

Done when: `/context` in a new session here shows the Skills row lower than 9.9K, and every changed skill still runs when typed.

## Part B: deny and fork for rarely used Probanda agents (agent listing)

Mechanics are in the context-engineering skill, `references/agents-and-orchestration.md`, "Hiding a rarely used agent". In short: a `permissions.deny` entry `"Agent(<plugin>:<name>)"` removes the agent from the listing, and a skill with `context: fork` and `agent: <plugin>:<name>` runs it. A plugin cannot ship a deny line, so the deny lines go only in Brahm's user settings. The run skills and dispatch changes ship to everyone and work with or without the deny.

Candidates (never parallel, never background), with listing size in characters and the number of source files that dispatch them:

| Agent | Listing chars | Dispatch files |
|---|---|---|
| `lawyer:docket-clerk` | 2,162 | 24 |
| `lawyer:scrivener` | 1,780 | 12 |
| `researcher:tech-support` | 1,243 | 4 |
| `lawyer:technical-writer` | 878 | 3 |
| `lawyer:spec-backstop` | 823 | 3 |
| `lawyer:migration-runner` | small | 7 |

`lawyer:localize-helper` (1,261 characters) left the listing another way: algorithm-cycle `localize-helper-2026-11/c01` deleted it on 2026-11-26 (commit ea2de26e), and `/localize` now follows its playbook itself. The spike below was first built on it (commit 611f1e94) and never tested.

Expected saving for the six left: about 6,700 characters, roughly 1.7K tokens, less one listing line per run skill (about 0.3K). Net about 1.4K of the 9.8K.

B1. **Spike first, on one agent (`lawyer:technical-writer`, three dispatch files).** Add `source/skills/run-technical-writer/SKILL.md` (`context: fork`, `agent: lawyer:technical-writer`, body `$ARGUMENTS` plus one line telling the agent to follow its instructions), assign it to `lawyer` in `source/assignment.json`, and change each dispatch site to call the Skill tool with the brief as args. Build and add `"Agent(lawyer:technical-writer)"` to the user settings deny list. Check three things:
- in the Code tab: the agent is gone from the listing, and a direct Agent call is refused;
- `/lawyer:suggestion`'s write-up still completes through the run skill;
- in Cowork: the run skill works there too. The fork mechanics were tested only in the CLI. If it fails in Cowork, stop Part B.

B2. **Roll out to the other five** in descending size. Each dispatch site changes from an Agent call to the run skill. This includes the session-start note in `source/lawyer/hooks/hidden-skills-note.py`, which tells sessions to call the Agent tool by the agent's name. It must name the run skill for these six. `docket-clerk`'s 24 sites go last and in their own commit.

B3. **Release.** The change is a patch: old and new copies dispatch the same agent and share the same data. Run `python scripts/build_plugin.py`, `python scripts/check_plugin.py`, `python scripts/check_layering.py` and `/release`.

Done when: `/context` in a new session shows the Custom agents row about 1.4K lower, and one real task through each changed skill completes.

## Not pursued

- Lowering `skillListingBudgetFraction`: it cuts the number at once, but Claude Code then chooses which descriptions to drop.
- TokenEconomizer `toolprune` for skills or agents: it prunes only tools and servers. Its "unused for 10 prompts" rule would deny agents that skills dispatch weekly, which would break those skills.
- Removing the `mcp__remote-devices__*` tool names from agent lists: Cowork needs them.
