// Run: node .claude/hooks/exception-rulings-guard.test.js
const { spawnSync } = require("child_process");
const path = require("path");
const HOOK = path.join(__dirname, "exception-rulings-guard.js");
const CWD = path.join(__dirname, "..", "..");

function decide(payload, cloud = false) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_REMOTE;
  if (cloud) env.CLAUDE_CODE_REMOTE = "true";
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8", env });
  if (!r.stdout) return "pass";
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
}
const bash = (command, tool_name = "Bash") => ({ tool_name, tool_input: { command }, cwd: CWD });

const PASS = [
  'git -C "C:/repo" grep -nE "\\"research\\"|plugins/research\\b" -- . ":!plugins" ":!docs" ":!*.js" ":!exception-rulings.json"',
  'git grep -n "a|b" -- ":!exception-rulings.json"',
  'git grep -n "a;b" -- ":!exception-rulings.json"',
  'rg -n "foo" source/exception-rulings.json',
  "jq . source/exception-rulings.json",
  "jq -r 'keys[]' source/exception-rulings.json",
  "git ls-files exception-rulings.json",
  'git -C "C:/repo" ls-files source/exception-rulings.json',
  'git -C "C:/repo" blame source/exception-rulings.json',
  "git ls-files | grep exception-rulings.json",
  "git log -p -- source/exception-rulings.json | head -50",
  "ls -la source/exception-rulings.json",
  "cat source/exception-rulings.json",
  "git log --pretty=oneline -- source/exception-rulings.json",
  "sed -n 1,20p source/exception-rulings.json",
  "echo --- ; cat source/exception-rulings.json",
  "ls source ; grep -n x source/exception-rulings.json | head -5",
  // The two commands that stalled the first /triage-issue pilots (2026-10-25), retargeted at the rulings file.
  'sed -n 60,70p scripts/build_plugin.py; sed -n 278,292p scripts/build_plugin.py; grep -n "is_cutover\|cutover\|None\|SINGLE" scripts/check_layering.py scripts/check_plugin.py source/exception-rulings.json scripts/check_plugin_*.py | sort -u | head -60',
  'grep -rn "is_cutover\|--out" scripts/*.py .github/workflows/* | head -30; echo ---; sed -n 25,110p scripts/check_plugin.py; echo ---; grep -n "def load_script\|spec_from_file_location" scripts/check_public_tree.py source/exception-rulings.json',
  // Two plan-mode research commands that asked (2026-11-26); the second had its wildcard removed.
  "rg -n -o -P '.{0,90}(Probanda-app|Probanda_Legal(?!_experimental)|public/|Public Folder|publish-public|approve_public|public plugin).{0,90}' CLAUDE.md source/skills/shared/correspondence-isolation.md; echo ==; rg -n -i 'public' source/exception-rulings.json scripts/check_plugin_sources.py | cut -c1-200; echo; cat public/README.md | head -30; echo; head -12 public/CHANGELOG.md",
  "rg -c --hidden -P -e 'Probanda-app' -e 'exception-rulings.json' docs | sort -t: -k2 -nr; echo ==; rg -n -i 'implemented|shipped' source/skills/suggestion source/lawyer/mcp/src/suggestion 2>/dev/null | head; echo ==; rg -n '\"(TLDR|dyu)\"' source/assignment.json",
];

const ASK = [
  "\tgit grep --output=source/exception-rulings.json x",
  "ls ;\tgit grep --output=source/exception-rulings.json x",
  "sed -n 1p * source/exception-rulings.json",
  "sed -n 1p $F source/exception-rulings.json",
  "sed -n '1p' source/exception-rulings.json",
  "rg x * source/exception-rulings.json",
  "git grep x $F -- source/exception-rulings.json",
  "sed -n 1p -i source/exception-rulings.json",
  "sed -n 1p --in-place source/exception-rulings.json",
  "sed -n 1w source/exception-rulings.json x",
  "cat source/exception-rulings.json ; cp x source/exception-rulings.json",
  "ls ; git grep --output=source/exception-rulings.json x",
  "echo ok && cp x source/exception-rulings.json",
  "cat source/exception-rulings.json ;",
  "echo {} > source/exception-rulings.json",
  "cp x source/exception-rulings.json",
  "jq '.a=1' source/exception-rulings.json > t && mv t source/exception-rulings.json",
  "sed -i 's/a/b/' source/exception-rulings.json",
  "python -c \"open('source/exception-rulings.json','w').write('{}')\"",
  "git checkout -- source/exception-rulings.json",
  "git restore source/exception-rulings.json",
  "git diff --output=x.txt source/exception-rulings.json",
  'git -C "C:/repo" grep -n x -- ":!exception-rulings.json" > source/exception-rulings.json',
  'git grep --open-files-in-pager=sh x -- ":!exception-rulings.json"',
  'git grep -Osh x -- ":!exception-rulings.json"',
  'git grep -nOsh x -- ":!exception-rulings.json"',
  'git grep --open=sh x -- ":!exception-rulings.json"',
  "rg --pre ./x.sh a source/exception-rulings.json",
  "rg --pre=./x.sh a source/exception-rulings.json",
  "rg -n x source/exception-rulings.json | tee source/exception-rulings.json",
  "git ls-files | sort -o source/exception-rulings.json",
  "git ls-files || cp x source/exception-rulings.json",
  "git ls-files |& cp x source/exception-rulings.json",
  "rg -n x source/exception-rulings.json 2>out.txt",
  "rg -n x source/exception-rulings.json 2>/dev/null > source/exception-rulings.json",
  "rg -n x source/suggestion* source/exception-rulings.json 2>/dev/null | head",
  "cat source/exception-rulings.json | cut -c1-9 > source/exception-rulings.json",
  // Quote tricks: a separator that looks quoted but is not.
  "grep \\' ; cp x source/exception-rulings.json ; echo \\'",
  "grep \"$a\" ; cp x source/exception-rulings.json ; echo \"z\"",
  "grep $'\\'' ; cp x source/exception-rulings.json ; echo ''",
  'grep "$(cp x source/exception-rulings.json)" y',
  // PowerShell: backslash does not escape a quote there.
  ["cat (cp x source/exception-rulings.json)", "PowerShell"],
  ["ls @(cp x source/exception-rulings.json)", "PowerShell"],
  ['grep "a\\"; cp x source/exception-rulings.json; echo \\"b" y', "PowerShell"],
];

// In a cloud run nobody can answer, so what asks elsewhere is refused, and what passes still passes.
const REFUSED_IN_CLOUD = [
  "cp x source/exception-rulings.json",
  // A heredoc stalled the implementer on #200 (2026-11-02) when it asked; retargeted at the rulings file.
  "python3 - <<'EOF'\nfrom pathlib import Path\np=Path('source/exception-rulings.json')\nEOF",
];
const PASSES_IN_CLOUD = ["cat source/exception-rulings.json"];

let failed = 0;
const check = (payload, want, label, cloud = false) => {
  const got = decide(payload, cloud);
  if (got !== want) { failed++; console.log(`FAIL ${label} -> ${got} (expected ${want})`); }
};
for (const c of PASS) check(bash(c), "pass", c);
for (const c of ASK) Array.isArray(c) ? check(bash(c[0], c[1]), "ask", c.join(" @")) : check(bash(c), "ask", c);
for (const tool_name of ["Edit", "Write"]) {
  check({ tool_name, tool_input: { file_path: "C:\\repo\\source\\exception-rulings.json" } }, "ask", `${tool_name} absolute exception-rulings.json`);
  check({ tool_name, tool_input: { file_path: "source\\exception-rulings.json" } }, "ask", `${tool_name} exception-rulings.json`);
}
for (const c of REFUSED_IN_CLOUD) check(bash(c), "deny", `cloud: ${c}`, true);
for (const c of PASSES_IN_CLOUD) check(bash(c), "pass", `cloud: ${c}`, true);
check({ tool_name: "Edit", tool_input: { file_path: "source/exception-rulings.json" } }, "deny", "cloud: Edit exception-rulings.json", true);
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
