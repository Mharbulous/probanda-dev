// PreToolUse hook for Bash and PowerShell. Commandment 1: only a human may edit, rename,
// move or delete COMMANDMENTS.md. Deny rules do not see writes made by scripts, Set-Content,
// Move-Item, cp or mv, so this hook refuses a shell command that could change the file. It
// looks only at the statements that name the file. Such a statement must be a read-only
// command, or a git command that lands the file as it is, optionally piped into read-only
// filters. A redirect into the file, a command substitution and --output (which makes git
// diff/log/show write a file) are refused. Operators inside quotes are ignored, so a commit
// message may mention the file and span several lines. Also refused: an unquoted ( or a
// script block { (PowerShell runs them), git -c, git grep -O, rg --pre, and sort or uniq
// naming the file (their output operand).
// Do not restrict: commands that only read the file or copy it elsewhere. sed -n with a
// line-range print, jq, find without -delete/-exec/-fprint, cp with the file as source and
// no options, git grep/ls-files, and printf or echo of a payload piped into this hook to
// replay it. None of them can change the file, so commandment 1 does not cover them.
const fs = require("fs");
let input = "";
try { input = fs.readFileSync(0, "utf8"); } catch (e) { /* no stdin */ }
let command = "";
try { command = String(JSON.parse(input).tool_input.command || ""); } catch (e) { /* leave empty */ }

const NAME = /commandments\.md/i;
const READ = "cat|head|tail|wc|grep|rg|ls|less|more|file|stat|diff|cmp|sha256sum|md5sum|type|findstr|jq|Get-Content|Get-Item|Get-ChildItem|Get-FileHash|Select-String|Test-Path";
const GIT = "add|commit|push|pull|fetch|merge|status|diff|log|show|blame|grep|ls-files|rev-parse|cat-file";
const FILTER = "head|tail|wc|grep|rg|sort|uniq|cut|less|more|findstr|Select-String|Select-Object|Measure-Object";
const GIT_PREFIX = `git(?: -C (?:"[^"\\n]*"|'[^'\\n]*'|\\S+))?`;
const ALLOWED = new RegExp(`^(?:${READ})(?: |$)`, "i");
const GIT_ALLOWED = new RegExp(`^${GIT_PREFIX} (?:${GIT})(?: |$)`); // case-sensitive, so -C never matches -c
const GIT_GREP = new RegExp(`^${GIT_PREFIX} grep(?: |$)`);
const SED_PRINT = /^sed -n (?:'[\d,$]+p'|"[\d,$]+p"|[\d,$]+p)(?: [^-\s]\S*)*$/;
const FIND_WRITE = / -(?:delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)\b/;
const REPLAY = /^node (?:\S*[\\/])?guard-commandments\.js$/;
const FILTERS = new RegExp(`^(?:${FILTER})(?: |$)`, "i");
const REDIRECT = />\s*(?:"[^"]*|'[^']*|\S*)commandments\.md/i;
const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;

// cp may copy the file elsewhere: no options (-l, -s, -t), and the last operand is not the file.
function copiesOut(first) {
  const tokens = first.split(/\s+/);
  return tokens[0] === "cp" && tokens.length >= 3 && tokens.every((t) => !t.startsWith("-")) && !NAME.test(tokens[tokens.length - 1]);
}

function readOnly(first) {
  return ALLOWED.test(first) || GIT_ALLOWED.test(first) || SED_PRINT.test(first) ||
    (/^find /.test(first) && !FIND_WRITE.test(first)) || copiesOut(first);
}

// Options that let a reading command or filter write a file or run a program.
function writes(part) {
  if (/^rg /i.test(part) && /(?:^| )--(?:pre|hostname-bin)(?:[= ]|$)/.test(part)) return true;
  if (/^sort /i.test(part) && / --co/.test(part)) return true;
  if (GIT_GREP.test(part) && part.split(/\s+/).some((t) => /^-[^-]*O|^--op/.test(t))) return true;
  return /^(?:sort|uniq) /i.test(part) && NAME.test(part);
}

// Blank the operator characters inside quotes, so a quoted commit message is not split.
function maskQuoted(text) {
  let out = "";
  let quote = "";
  let escaped = false;
  for (const ch of text) {
    if (!quote) {
      if (ch === '"' || ch === "'") quote = ch;
      out += ch;
    } else if (escaped) {
      escaped = false;
      out += ch;
    } else if (ch === "\\" && quote === '"') {
      escaped = true;
      out += ch;
    } else {
      if (ch === quote) quote = "";
      out += /[;&|<>\n\r]/.test(ch) ? " " : ch;
    }
  }
  return out;
}

const statements = maskQuoted(command)
  .replace(/\d?>&\d|\d?>\s*(?:\/dev\/null|\$null)/g, " ")
  .split(/&&|\|\||[;&\n\r]/);
const unsafe = statements.some((statement) => {
  if (!NAME.test(statement)) return false;
  if (/`|\$\(|--output/.test(statement) || REDIRECT.test(statement)) return true;
  if (/\(|(?:^|[^$@])\{/.test(statement.replace(QUOTED, ""))) return true;
  const parts = statement.split("|").map((part) => part.trim());
  if (parts.some(writes)) return true;
  // printf or echo of a payload into this hook only prints the name: treat it as a read.
  if (/^(?:printf|echo)(?: |$)/.test(parts[0]) && REPLAY.test(parts[1] || "")) parts.splice(0, 2, "cat");
  const [first, ...rest] = parts;
  return !readOnly(first) || rest.some((part) => !FILTERS.test(part));
});
if (unsafe) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "A shell command that names COMMANDMENTS.md may only read it or run git add, commit, push, pull, fetch, merge, status, diff, log, show or blame on it (commandment 1). A human makes any change."
    }
  }));
}
