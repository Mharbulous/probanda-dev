// PreToolUse hook for Bash and PowerShell. Commandment 1: only a human may edit, rename,
// move or delete COMMANDMENTS.md. Deny rules do not see writes made by scripts, Set-Content,
// Move-Item, cp or mv, so this hook refuses a shell command that could change the file. It
// looks only at the statements that name the file. Such a statement must be a read-only
// command, or a git command that lands the file as it is, optionally piped into read-only
// filters. A redirect into the file, a command substitution and --output (which makes git
// diff/log/show write a file) are refused. Operators inside quotes are ignored, so a commit
// message may mention the file and span several lines.
const fs = require("fs");
let input = "";
try { input = fs.readFileSync(0, "utf8"); } catch (e) { /* no stdin */ }
let command = "";
try { command = String(JSON.parse(input).tool_input.command || ""); } catch (e) { /* leave empty */ }

const NAME = /commandments\.md/i;
const READ = "cat|head|tail|wc|grep|rg|ls|less|more|file|stat|diff|cmp|sha256sum|md5sum|type|findstr|Get-Content|Get-Item|Get-ChildItem|Get-FileHash|Select-String|Test-Path";
const GIT = "add|commit|push|pull|fetch|merge|status|diff|log|show|blame|grep|ls-files|rev-parse|cat-file";
const FILTER = "head|tail|wc|grep|rg|sort|uniq|cut|less|more|findstr|Select-String|Select-Object|Measure-Object";
const ALLOWED = new RegExp(`^(?:git(?: -C (?:"[^"\\n]*"|'[^'\\n]*'|\\S+))? (?:${GIT})|${READ})(?: |$)`, "i");
const FILTERS = new RegExp(`^(?:${FILTER})(?: |$)`, "i");
const REDIRECT = />\s*(?:"[^"]*|'[^']*|\S*)commandments\.md/i;

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
  const [first, ...rest] = statement.split("|").map((part) => part.trim());
  return !ALLOWED.test(first) || rest.some((part) => !FILTERS.test(part));
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
