---
name: step-widget
disable-model-invocation: true
description: When a reply lays out a multi-step procedure the user will follow in order (setup steps, a runbook, "how do I" instructions, an ordered checklist), always write the complete numbered list in the chat message first, then additionally render the same steps as a step-card widget via show_widget as a supplementary visual. The chat list is the record; the widget is a bonus. Use whenever a reply would otherwise contain only a plain numbered list of steps for the user to follow.
---

<!-- probanda v0.1.6 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# Step widget

When a reply lays out a procedure the practitioner will follow in order (three or more steps), do the following, in this order.

1. **Write the full numbered list in the chat message itself.** Every step, complete, with everything the practitioner needs to act on it (commands, paths, names). This is the record of what was shown and it never depends on the widget. The widget render surface is a fixed frame of about 5000 px that silently clips anything past it, with no scrollbar, error, or cue (`.claude/skills/shared/elicitation-widget.md` §1 item 4 and §6). `/draft` already applies this rule to plan approval: a practitioner who approves a plan they were never shown in chat has approved nothing.

2. **Then render the same steps as a step-card widget**, after the list, as a supplementary visual only.
   - Once per session, before the first render, call `read_me` with `modules: ["mockup"]` on the visualize server. (The tool's full name is prefixed by a server ID that differs per host — find `read_me` and `show_widget` by name.)
   - Call `show_widget` with `title: "step_card_display_v0"`, one to four `loading_messages`, and `widget_code` built from the template below: one card per step, the same numbering and the same step titles as the chat list, and one short gist line per card (two lines at most). Full commands, paths, and detail stay in the chat list. Never put a step in the widget that is not in the chat list.
   - **Skip the widget entirely** and rely on the chat list alone when the procedure has more than 12 steps or any step needs more than a two-line gist. Twelve cards at roughly 110 px each is about 1300 px, well inside the 4500 px budget in `.claude/skills/shared/elicitation-widget.md` §1; a longer procedure risks the fold, and the chat list already carries everything.

3. **Never treat the widget as the record.** If the render errors, renders blank, or the practitioner says it is missing content, do not re-render and do not repeat the list: the chat list already stands (`.claude/skills/shared/elicitation-widget.md` §6 fallback ladder).

## Card template

Repeat the inner card once per step. Colors must be CSS variables (dark mode is automatic), no emoji, sentence case, font weights 400 and 500 only, no headings or prose paragraphs inside the widget, no `<script>`.

```html
<h2 class="sr-only">Step-by-step procedure, N steps</h2>
<div style="display: flex; flex-direction: column; gap: 8px;">
  <div style="display: flex; gap: 12px; align-items: flex-start; background: var(--surface-2); border: 0.5px solid var(--border); border-radius: 12px; padding: 12px 16px;">
    <div style="flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--bg-accent); color: var(--text-accent); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 500;">1</div>
    <div style="min-width: 0;">
      <p style="margin: 0; font-size: 15px; font-weight: 500; color: var(--text-primary);">Step title in sentence case</p>
      <p style="margin: 2px 0 0; font-size: 13px; color: var(--text-secondary);">One-line gist of the step.</p>
    </div>
  </div>
</div>
```
