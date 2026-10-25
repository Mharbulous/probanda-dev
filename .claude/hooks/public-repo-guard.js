// PreToolUse hook for Bash, PowerShell and the file-writing tools. Publication cannot be
// reliably undone, so a person confirms each approval and each publication. The hook does
// not refuse: it makes the app ask the person to approve the one tool call. It asks for:
//   - a write to the public repository: a push or remote change that names it, a gh command
//     that changes it, or a git push from a checkout whose remote is it;
//   - starting the publish-public workflow;
//   - a write to public-approved.json, or running approve_public.py. A shell command that
//     names either passes without asking only if it reads it or runs a single plain git add,
//     commit, push, pull, fetch, status, diff, log, show, grep, ls-files, ls-tree or blame. Such
//     commands may be joined by ; when each part would pass alone. Two more single commands pass:
//     scripts/approve_public.py with no arguments, which shows the changes and writes
//     nothing without a terminal, and a pytest run of its test file.
// Reading the public repository (gh repo view, git ls-remote, git clone) passes without asking.
// Do not restrict: reads of either file neither approve nor publish, so these pass without asking:
// git ls-files, ls-tree and blame; rg (but not --pre or --pre-glob, which run a program); jq with
// no redirect (it cannot write a file); ls; echo; sed -n printing a line range (N,Mp) with no
// other option; a pipe into grep, head, tail, wc or sort (but not -o,
// which writes); pytest of the test file with -q, -v or -k <word>; and a ; or | inside a quoted
// Bash argument such as a grep pattern, which the shell takes literally.
const fs = require("fs");
const { spawnSync } = require("child_process");
let data = {};
try { data = JSON.parse(fs.readFileSync(0, "utf8")); } catch (e) { /* leave empty */ }
const input = data.tool_input || {};

function ask(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason }
  }));
  process.exit(0);
}

// The old names still reach the public repository: GitHub redirects them after a rename.
const PUBLIC_REPO = /probanda-app[\\/](?:probanda(?:-legal)?|legal|plugins|litigation)\b/i;
const APPROVAL = /public-approved\.json|approve_public/i;
const ALLOWED = /^(?:git(?: -C (?:"[^"\n]*"|'[^'\n]*'|\S+))? (?:add|commit|push|pull|fetch|status|diff|log|show|grep|ls-files|ls-tree|blame)|cat|head|tail|wc|grep|rg|jq|ls|echo)(?: |$)/;
// sed can write (-i, w) and run commands (e), so it passes only as sed -n N,Mp followed by literal
// file names: no option, quote, wildcard or $ that could expand into an option such as -i.
const SED_PRINT = /^sed -n \d+(?:,\d+)?p(?: +[^\s\-*?[$'"][^\s*?[$'"]*)* *$/;
// git and rg take options that write a file or run a program, and an unquoted wildcard or $ could
// expand into one (a file named --pre=x), so their parts may hold neither.
const EXPANDS = /[*?[$]/;
// Options that write a file or run a program: git --output and -O/--open-files-in-pager (git
// takes abbreviations such as --op, and -O inside a cluster such as -nO), rg --pre/--pre-glob.
const OPTION_RUNS = /--o(?:p|ut)|--pre(?:-glob)?(?:[=\s]|$)|(?:^|\s)-[A-Za-z]*O/;
// A pipe may feed only these readers, with no -o/--output/--compress-program (sort -o writes).
const PIPE_TAIL = /^ *(?:grep|head|tail|wc|sort)(?: +(?!-\S*o|--(?:o|comp))\S+)* *$/;
const quoted = (file) => `(?:"(?:[^"\\n]*[\\\\/])?${file}"|'(?:[^'\\n]*[\\\\/])?${file}'|(?:\\S*[\\\\/])?${file})`;
const SHOW_ONLY = new RegExp(`^python3? ${quoted("scripts[\\\\/]approve_public\\.py")}$`);
const PYTEST_OPT = "(?: (?:-[qv]+|-k \\w+))*";
const TEST_RUN = new RegExp(`^python3? -m pytest${PYTEST_OPT} ${quoted("scripts[\\\\/]tests[\\\\/]test_approve_public\\.py")}${PYTEST_OPT}$`);
// PowerShell also runs a bracketed command anywhere in a line (`cat (cp x public-approved.json)`),
// so for it `(` chains too. Gotcha: a Bash `(` is a subshell only at the start, which ALLOWED refuses.
// A ; between parts is checked part by part instead (partHarmless below).
const CHAINING = data.tool_name === "Bash" ? /[&<>`\n\r]|\$\(|\$\{/ : /[&<>`\n\r(]|\$\{/;
// For Bash only, blank what the shell takes literally: backslash escapes, '...' and $'...' spans,
// and "..." spans with no $ or backtick, so a ; or | inside a quoted grep pattern is not a separator.
// PowerShell quotes differently (backslash does not escape), so its commands are tested raw.
function literalBlanked(command) {
  if (data.tool_name !== "Bash") return command;
  return command.replace(/\\[\s\S]|\$'(?:[^'\\]|\\[\s\S])*'|'[^']*'|"(?:[^"\\]|\\[\s\S])*"/g,
    (m) => m[0] === "\\" ? "__" : m[0] === '"' && /[$`]/.test(m) ? m : '""');
}
const REPO_WRITE = /\bpush\b|\bremote\s+(?:add|set-url)\b|\bgh\s+(?:repo\s+(?:edit|delete|rename|archive|create|sync)|release|workflow|secret|variable)\b|\bgh\s+api\b.*(?:\s-X|--method|\s-f|\s-F|--field|--input)\b/i;

if (typeof input.command === "string") {
  const command = input.command;
  if (PUBLIC_REPO.test(command) && REPO_WRITE.test(command)) {
    ask("This command changes the public repository Probanda-app/Legal. Approve it only if you want this change made.");
  }
  if (/\bgh\b/.test(command) && /publish-public/i.test(command) && /workflow\s+run|dispatches/i.test(command)) {
    ask("This command starts the publish-public workflow, which publishes public/ to the public repository. Publication cannot be reliably undone.");
  }
  if (/\bgit\b/.test(command) && /\bpush\b/.test(command)) {
    const at = command.match(/ -C (?:"([^"\n]*)"|'([^'\n]*)'|(\S+))/);
    const dir = (at && (at[1] || at[2] || at[3])) || data.cwd || ".";
    const remotes = spawnSync("git", ["-C", dir, "remote", "-v"], { encoding: "utf8" });
    if (PUBLIC_REPO.test(String(remotes.stdout || ""))) {
      ask("This checkout's remote is Probanda-app/Legal, so this push publishes to the public repository.");
    }
  }
  const plain = literalBlanked(command);
  const parts = plain.split(";").map((part) => part.trim());
  const partHarmless = (part) => {
    const [first, ...piped] = part.split("|");
    if (/^(?:git|rg)\b/.test(first) && EXPANDS.test(first)) return false;
    return (ALLOWED.test(first) || SED_PRINT.test(first.trim())) && piped.every((s) => PIPE_TAIL.test(s));
  };
  // OPTION_RUNS names git and rg options, so a grep pattern such as "--out" does not trip it.
  const runsGitOrRg = parts.some((part) => /^(?:git|rg)\b/.test(part));
  const harmless = (parts.every(partHarmless) && !(runsGitOrRg && OPTION_RUNS.test(command))) || SHOW_ONLY.test(command) || TEST_RUN.test(command);
  if (APPROVAL.test(command) && !(harmless && !CHAINING.test(plain))) {
    ask("This command names public-approved.json or approve_public.py and may approve files for publication.");
  }
} else {
  const target = String(input.file_path || input.notebook_path || "").replace(/\\/g, "/");
  if (/(?:^|\/)public-approved\.json$/i.test(target)) {
    ask("This write changes public-approved.json, the list of files approved for publication.");
  }
}
