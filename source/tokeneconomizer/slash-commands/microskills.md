---
description: Show the repository facts (micro-skills) TokenEconomizer learned and injects at session start, or turn micro-skills on or off
argument-hint: "[on | off]"
---
The arguments I typed after the command are: "$ARGUMENTS".
Run this exact command with the Bash tool, then show me its output verbatim in a code block, with no commentary:

```
te="${CLAUDE_PLUGIN_ROOT}/scripts/te"; [ -x "$te" ] || te="${TOKENECONOMIZER_HOME:-$HOME/.tokeneconomizer}/bin/te"; "$te" --cwd "$(pwd)" microskills $ARGUMENTS
```

It changes the setting only when I typed `on` or `off` in those arguments; never add them yourself.
