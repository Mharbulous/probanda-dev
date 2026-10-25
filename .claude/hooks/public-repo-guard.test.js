// Run: node .claude/hooks/public-repo-guard.test.js
const { spawnSync } = require("child_process");
const path = require("path");
const HOOK = path.join(__dirname, "public-repo-guard.js");
const CWD = path.join(__dirname, "..", "..");

function decide(payload) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
  if (!r.stdout) return "pass";
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
}
const bash = (command, tool_name = "Bash") => ({ tool_name, tool_input: { command }, cwd: CWD });

const PASS = [
  'git -C "C:/Users/Brahm/Git/probanda-plugins" grep -nE "\\"research\\"|plugins/research\\b" -- . ":!plugins" ":!docs" ":!*.js" ":!public-approved.json"',
  'git grep -n "a|b" -- ":!public-approved.json"',
  'git grep -n "a;b" -- ":!public-approved.json"',
  'rg -n "foo" public/public-approved.json',
  "rg -n approve_public scripts",
  "jq . public/public-approved.json",
  "jq -r 'keys[]' public/public-approved.json",
  "git ls-files public-approved.json",
  'git -C "C:/Users/Brahm/Git/probanda-plugins" ls-files public/public-approved.json',
  'git -C "C:/Users/Brahm/Git/probanda-plugins" blame public/public-approved.json',
  "git ls-files | grep approve_public",
  "git log -p -- public/public-approved.json | head -50",
  "ls -la public/public-approved.json",
  "python -m pytest scripts/tests/test_approve_public.py -k x",
  "python -m pytest -q scripts/tests/test_approve_public.py -v",
  "python scripts/approve_public.py",
  "cat public/public-approved.json",
  "git log --pretty=oneline -- public/public-approved.json",
  "sed -n 1,20p public/public-approved.json",
  "echo --- ; cat public/public-approved.json",
  "ls scripts ; grep -n x scripts/approve_public.py | head -5",
  // The two commands that stalled the first /triage-issue pilots (2026-10-25).
  'sed -n 60,70p scripts/build_plugin.py; sed -n 278,292p scripts/build_plugin.py; grep -n "is_cutover\|cutover\|None\|SINGLE" scripts/check_layering.py scripts/check_plugin.py scripts/approve_public.py scripts/check_plugin_*.py | sort -u | head -60',
  'grep -rn "is_cutover\|--out" scripts/*.py .github/workflows/* | head -30; echo ---; sed -n 25,110p scripts/check_plugin.py; echo ---; grep -n "def load_script\|spec_from_file_location" scripts/check_public_tree.py scripts/approve_public.py',
];

const ASK = [
  "sed -n 1p -i public/public-approved.json",
  "sed -n 1p --in-place public/public-approved.json",
  "sed -n 1w public/public-approved.json x",
  "cat public/public-approved.json ; cp x public/public-approved.json",
  "grep -n x scripts/approve_public.py ; python scripts/approve_public.py --yes",
  "ls ; git grep --output=public/public-approved.json x",
  "echo ok && cp x public/public-approved.json",
  "cat public/public-approved.json ;",
  "python scripts/approve_public.py --yes",
  "python scripts/approve_public.py public/foo.md",
  "echo {} > public/public-approved.json",
  "cp x public/public-approved.json",
  "jq '.a=1' public/public-approved.json > t && mv t public/public-approved.json",
  "sed -i 's/a/b/' public/public-approved.json",
  "python -c \"open('public/public-approved.json','w').write('{}')\"",
  "git checkout -- public/public-approved.json",
  "git restore public/public-approved.json",
  "git diff --output=x.txt public/public-approved.json",
  'git -C "C:/Users/Brahm/Git/probanda-plugins" grep -n x -- ":!public-approved.json" > public/public-approved.json',
  'git grep --open-files-in-pager=sh x -- ":!public-approved.json"',
  'git grep -Osh x -- ":!public-approved.json"',
  'git grep -nOsh x -- ":!public-approved.json"',
  'git grep --open=sh x -- ":!public-approved.json"',
  "rg --pre ./x.sh a public/public-approved.json",
  "rg --pre=./x.sh a public/public-approved.json",
  "rg -n x public/public-approved.json | tee public/public-approved.json",
  "git ls-files | sort -o public/public-approved.json",
  "git ls-files || cp x public/public-approved.json",
  "git ls-files |& cp x public/public-approved.json",
  // Quote tricks: a separator that looks quoted but is not.
  "grep \\' ; cp x public/public-approved.json ; echo \\'",
  "grep \"$a\" ; cp x public/public-approved.json ; echo \"z\"",
  "grep $'\\'' ; cp x public/public-approved.json ; echo ''",
  'grep "$(cp x public/public-approved.json)" y',
  // PowerShell: backslash does not escape a quote there.
  ["cat (cp x public/public-approved.json)", "PowerShell"],
  ["ls @(cp x public/public-approved.json)", "PowerShell"],
  ['grep "a\\"; cp x public/public-approved.json; echo \\"b" y', "PowerShell"],
  "gh workflow run publish-public",
  "git push https://github.com/Probanda-app/Probanda HEAD:main",
  "git push https://github.com/Probanda-app/Legal HEAD:main",
];

let failed = 0;
const check = (payload, want, label) => {
  const got = decide(payload);
  if (got !== want) { failed++; console.log(`FAIL ${label} -> ${got} (expected ${want})`); }
};
for (const c of PASS) check(bash(c), "pass", c);
for (const c of ASK) Array.isArray(c) ? check(bash(c[0], c[1]), "ask", c.join(" @")) : check(bash(c), "ask", c);
for (const tool_name of ["Edit", "Write"]) {
  check({ tool_name, tool_input: { file_path: "C:\\Users\\Brahm\\Git\\probanda-plugins\\public\\public-approved.json" } }, "ask", `${tool_name} public-approved.json`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
