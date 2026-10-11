// PreToolUse hook for Bash and PowerShell. Commandment 1: only a human may edit, rename,
// move or delete COMMANDMENTS.md. Deny rules do not see writes made by scripts, Set-Content,
// Move-Item, cp or mv, so this hook refuses any shell command that names the file unless it is
// a single plain command that cannot change a file: reading, or git add, commit, push, pull,
// fetch, status, diff, log or show. --output makes git diff/log/show write a file.
const fs = require("fs");
let input = "";
try { input = fs.readFileSync(0, "utf8"); } catch (e) { /* no stdin */ }
let command = "";
try { command = String(JSON.parse(input).tool_input.command || ""); } catch (e) { /* leave empty */ }
const ALLOWED = /^(?:git(?: -C (?:"[^"\n]*"|'[^'\n]*'|\S+))? (?:add|commit|push|pull|fetch|status|diff|log|show)|cat|head|tail|wc|grep)(?: |$)/;
const CHAINING = /[;&|<>`\n\r]|\$\(|\$\{/;
if (/commandments\.md/i.test(command) && !(ALLOWED.test(command) && !CHAINING.test(command) && !/--output/.test(command))) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Shell commands that name COMMANDMENTS.md may only read it or run a single plain git add, commit, push, pull, fetch, status, diff, log or show (commandment 1). A human makes any change."
    }
  }));
}
