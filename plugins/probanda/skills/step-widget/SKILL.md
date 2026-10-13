---
name: step-widget
disable-model-invocation: true
description: When a reply lays out a multi-step procedure the user will follow in order (setup steps, a runbook, "how do I" instructions, an ordered checklist), always write the complete numbered list in the chat message first, then additionally render the same steps as a step-card widget via show_widget as a supplementary visual. The chat list is the record; the widget is a bonus. Use whenever a reply would otherwise contain only a plain numbered list of steps for the user to follow.
---

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
