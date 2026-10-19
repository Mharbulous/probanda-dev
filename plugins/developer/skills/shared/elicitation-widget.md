<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Asking the practitioner — elicitation widget convention

Every point where a skill pauses for practitioner input — data entry, a confirmation,
an acknowledgment, an election, a choice between paths — renders a graphical form.
A plain-text question in chat is never the primary ask: it is easy to miss and does
not signal that the pipeline is blocked on a human.

Carve-out: an approval or sign-off (including approving the skill's own
proposals), and a failed pre-filing check, is not asked through this
convention. It follows `/show-me`: plain text, one decision per turn, the
source presented. Data entry, elections and setup choices keep the widget. A hash-bound review gate (§ 7) keeps its own widget. An on-the-fly revision (`draft/references/revise-on-the-fly.md`) is an approval of one revised paragraph, typed in chat, never asked in a widget.

## 0. Ground rules

Every `data-value` that can reach the transcript must be readable by a human with
no other context — the option's display label or an unambiguous human phrase,
never a bare id, index, or slug.

Identity travels beside the label, never instead of it: a machine key may follow
the label in brackets, e.g. `Response to stay application (filing 1)`, or be kept
in the skill's own label→id map for the turn. A value that is only the key is a
defect.

Two options never share a value; disambiguate with human detail (registry number,
date, party), never with an appended number.

The framing prose enumerates the options by the same labels the widget uses, so
the widget path and the §6 plain-text path produce identical transcript text.

The skill reads the answer by matching the echoed label against the labels it
rendered, and resolves any id only after the match. It never asks the
practitioner to confirm an id.

A widget change is not done until its author has rendered it and read the echoed
line as the practitioner would see it; if that line would not make sense pasted
into an email to a colleague, it fails.

## 1. How to render

1. Once per session, call `mcp__visualize__read_me` with `modules: ["elicitation"]`.
2. Render the ask with `mcp__visualize__show_widget` as a `<form class="elicit">`
   using the locked shell from the elicitation module: `.elicit-header` (the fixed
   File-icon SVG emitted byte-for-byte, title `"[subject] details"`), `.elicit-body`
   of `.elicit-group` blocks (a `.elicit-question` label phrased as a question per
   group), `.elicit-footer` with `.elicit-submit` and — on data forms with declared
   defaults only (§ 3, footer rule) — an `.elicit-skip` button labelled
   `Accept defaults` (`type="button"` on every button). Decision forms render
   no `.elicit-skip` at all. Zero onclick handlers, zero `<script>` — the
   shell auto-wires option toggles, the `data-other` reveal, file upload, and submit. Always pass `show_widget`'s `title` (a short snake_case identifier — required in Cowork) and `loading_messages`.
3. Framing prose goes in the chat response before the widget, never inside it.
4. **Size budget.** The render surface is a fixed viewport, measured at 5000 px
   tall in both Claude Code and Cowork. Content past that does not error or
   truncate visibly — it silently clips with no scrollbar or other cue that more
   exists. Before rendering, estimate height (row count × row height; ~120 short
   rows is the rough ceiling at typical padding) and if one form would exceed
   roughly 4500 px, split it into sequential forms per §4 rather than rendering
   a single form that clips unseen.

## 2. Component selection

Choose per question, per the module's own table — do not render every group as
plain pills:

| Question shape | Component |
|---|---|
| short labels, ≤4 words, single or multi choice | plain pills — `.elicit-pills` (`data-name`, `data-multi`) of `.elicit-pill` buttons, each carrying `data-value` |
| 2+ independent, individually actionable items of the practitioner's own outline read back (jobs they outlined). The skill's own proposals go to `/show-me`, one at a time | multi-select suggestion list — one `.elicit-pills` group with `data-multi="true"`, one pill or card per item, each with a human-readable `data-value` (§ 0, § 2a) |
| options needing an icon or one-line subtitle (elections, positions, scales, open applications) | cards — restyled `.elicit-pill` with a Tabler outline icon and a muted subtitle |
| output/layout choices | preview tiles |
| dates (hearing date, order date) | `<input type="date" class="elicit-date" data-name="…">` |
| quantities and ranges | `<input type="range">` with contextual end labels |
| free text (verbatim order text, reasons, corrections, answers) | `.elicit-textarea` |
| documents the practitioner supplies (CSV, client answers) | `.elicit-files` dropzone (fixed Upload-icon SVG byte-for-byte), always paired with a `.elicit-textarea` fallback in the same group |
| an answer we may not have listed | last option carries `data-other` with a paired `.elicit-other` input |

Selection state stays blue. Use `data-accent="warning|danger|success"` only with a
real semantic (risk, destructive choice, cost, confirmation); never inline
background/border styles on a pill.

## 2a. Multi-select suggestion list

When a skill puts **two or more independent items** to the practitioner to
accept or decline individually from the practitioner's own outline read back
(jobs they outlined), render them as one `.elicit-pills` group with
`data-multi="true"`, one option per item. Use the card shape when an item
needs a one-line subtitle (a job's intent); plain pills when a short label
suffices. Items read back from the practitioner's outline carry their words, not the skill's
rewording, and selecting one means "write it", not "accept my suggestion".
The skill's own proposals (proposed renames, proposed edits) are never put this
way: they go to `/show-me`, one at a time.

- **Selection is the decision.** Never pair the list with a separate "approve
  all / something should change" binary. Submitting proceeds with exactly the
  selected items. Submitting with nothing selected is a valid answer and means
  decline all. This is a decision form: `.elicit-submit` only, no
  `.elicit-skip`, nothing preselected.
- **Unselected items are never silently discarded.** The framing prose before
  the widget states, in one sentence, what happens to an item left unselected
  (dropped, deferred, captured to a backlog, left as it was). The calling skill
  owns that sentence; this convention only requires that it exist.
- **Readable values.** Each `data-value` is the item's display label (its title
  text), optionally followed by its machine key in brackets. The skill maps the
  echoed label back to the item. A `data-value` that is only an id, index, or
  slug is a defect: the host echoes `data-value` into the transcript, and that
  echo is the only thing the practitioner sees. Keep commas out of labels, since
  multi-select answers arrive comma-joined (see "Reading the answer" below).
- **One item is not a list.** With exactly one proposed item, keep the ordinary
  approve/change decision form. This pattern starts at two.
- **Relationship to § 4.** § 4's one-decision-per-form rule governs asks the
  skill defines as one-at-a-time acts (consent per order, one cut per
  acknowledgment). A batch of independent suggestions is not that: each pill is
  its own decision, all taken in one submit. Where a skill mandates
  one-at-a-time discipline, § 4 still wins and this pattern does not apply.
- **Reading the answer.** Multi-select values arrive comma-joined under the
  group's humanized `data-name` (§ 5). An absent or empty value for the group
  means nothing was selected.
- **Size budget.** § 1's fold rule applies: card rows are tall, so a list of
  more than roughly twenty cards splits into sequential forms.

Canonical markup (header SVG byte-for-byte per § 1; card style per the
module's own card shape):

```html
<form class="elicit">
  <div class="elicit-header">
    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M11.586 2a1.5 1.5 0 0 1 1.06.44l2.914 2.914a1.5 1.5 0 0 1 .44 1.06V16.5a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.492-1.347L4 16.5v-13A1.5 1.5 0 0 1 5.5 2zM5.5 3a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7h-2.5A1.5 1.5 0 0 1 11 5.5V3zm7.04 10.304a.5.5 0 0 1 .92.392c-.295.69-.871 1.304-1.66 1.304-.487 0-.892-.234-1.2-.574-.309.34-.713.574-1.2.574-.486 0-.892-.233-1.2-.574-.31.34-.714.574-1.2.574a.5.5 0 0 1 0-1c.212 0 .52-.18.74-.696l.034-.067a.5.5 0 0 1 .886.067c.221.516.528.696.74.696.213 0 .52-.18.74-.696l.035-.067a.5.5 0 0 1 .885.067c.22.516.527.696.74.696s.519-.18.74-.696m0-4a.5.5 0 0 1 .92.392c-.295.69-.871 1.304-1.66 1.304-.487 0-.892-.234-1.2-.574-.309.34-.713.574-1.2.574-.486 0-.892-.233-1.2-.574-.31.34-.714.574-1.2.574a.5.5 0 0 1 0-1c.212 0 .52-.18.74-.696l.034-.067a.5.5 0 0 1 .886.067c.221.516.528.696.74.696.213 0 .52-.18.74-.696l.035-.067a.5.5 0 0 1 .885.067c.22.516.527.696.74.696s.519-.18.74-.696M12 5.5a.5.5 0 0 0 .5.5h2.293L12 3.207z"/></svg>
    <span>Job details</span>
  </div>
  <div class="elicit-body">
    <div class="elicit-group">
      <label class="elicit-question">Which of the jobs you outlined should I write?</label>
      <div class="elicit-pills" data-name="jobs" data-multi="true">
        <!-- his answer: "I need to audit the memos, reply on attornment, and reconcile the exhibit list." -->
        <button type="button" class="elicit-pill" data-value="audit the memos"
          style="border-radius:12px; padding:14px 16px; display:flex; gap:12px; align-items:flex-start; text-align:left; min-width:180px; box-shadow:0 1px 2px rgba(0,0,0,0.04)">
          <i class="ti ti-book" style="font-size:20px" aria-hidden="true"></i>
          <span>
            <span style="font-size:13px; font-weight:500">audit the memos</span><br>
            <span style="font-size:11px; color:var(--text-muted)">Record verified propositions with pinpoints</span>
          </span>
        </button>
        <button type="button" class="elicit-pill" data-value="reply on attornment"
          style="border-radius:12px; padding:14px 16px; display:flex; gap:12px; align-items:flex-start; text-align:left; min-width:180px; box-shadow:0 1px 2px rgba(0,0,0,0.04)">
          <i class="ti ti-pencil" style="font-size:20px" aria-hidden="true"></i>
          <span>
            <span style="font-size:13px; font-weight:500">reply on attornment</span><br>
            <span style="font-size:11px; color:var(--text-muted)">Waiting on the memo audit</span>
          </span>
        </button>
        <button type="button" class="elicit-pill" data-value="reconcile the exhibit list"
          style="border-radius:12px; padding:14px 16px; display:flex; gap:12px; align-items:flex-start; text-align:left; min-width:180px; box-shadow:0 1px 2px rgba(0,0,0,0.04)">
          <i class="ti ti-list-check" style="font-size:20px" aria-hidden="true"></i>
          <span>
            <span style="font-size:13px; font-weight:500">reconcile the exhibit list</span><br>
            <span style="font-size:11px; color:var(--text-muted)">Against the disclosure log</span>
          </span>
        </button>
      </div>
    </div>
  </div>
  <div class="elicit-footer">
    <button type="button" class="elicit-submit">Outline selected</button>
  </div>
</form>
```

The answer arrives as `Job details — Jobs: audit the memos, reconcile the exhibit list`.

## 3. Phrasing and inference

- Phrase every `.elicit-question` as a question from you, not a field label.
- **Infer first — for data, never for decisions.** If the conversation or an
  attachment already answers a data question, drop that group (or the whole form).
  But a confirmation, approval, acknowledgment, or election the skill defines as a
  practitioner act is never inferred, skipped, or preselected into effect — it
  always renders, and the affirmative option is never preselected. An approval
  under the carve-out at the top is asked per `/show-me` instead, in plain
  text. A preselected safe *default value* (e.g. `oppose`, `with_notice`) is allowed where the skill
  names one; a preselected *approval* is not.
- **Name the form's class when you render it.** Every form is either a **data**
  form or a **decision** form. Say which in the framing prose before the widget.
  For a data form with declared defaults, enumerate the defaults there too —
  e.g. "This is a data form. Accept defaults submits: notice mode = with
  notice." Classifying at render time puts the answer in the transcript before
  the reply arrives, and the enumeration is what an Accept-defaults return
  resolves against (§ 5). The class still matters on the § 6 plain-text rung:
  prose has no button to omit, so a decision ask there must offer no
  "skip"/"defaults" option and must state that not answering records nothing,
  while a data ask may offer "Accept defaults (<the named values>)".

- **Name the mechanism behind an option that dispatches work.** An option
  whose selection dispatches an agent, drives a browser, calls a cloud or paid
  service, or runs a paid tier of `shared/research-priority.md` (Westlaw)
  states that mechanism before the practitioner chooses. An option that only
  confirms, or only reads and writes local data, needs no mechanism line. The
  line names, in this order and in one line of free wording, what runs, the
  external system it reaches, and the table's cost for that tier when the
  option runs one, e.g.
  `research-paralegal · Westlaw Deep Research via Chrome · subscription`. The
  framing prose must state the line after that option's label, set apart from
  the label. The option also needs a subtitle, so it renders as a card (§ 2),
  never a pill, with the same line as its subtitle. The line never goes in
  `data-value`, and the skill matches the label alone.

- **Every ask survives a failed widget.** The framing prose must leave the ask
  answerable in chat in the same turn: name the decision or data sought, and its
  options, plainly enough that a practitioner whose widget did not render — or
  whose buttons did not register — can answer in plain text with nothing further
  from us.

- **Footer rule — when the second button exists.**
  - **Decision form** (a confirmation, approval, acknowledgment, or election
    the skill defines as a practitioner act, except the approvals the carve-out
    at the top sends to `/show-me`): render `.elicit-footer` with the
    `.elicit-submit` button only. There is nothing to skip — the only exits
    are an actual selection plus Submit, or leaving the pipeline blocked.
  - **Data form** (facts: dates, estimates, values with a named default): the
    footer may include `.elicit-skip` **only when every group on the form has
    a declared default**. Declare each default three ways: (a) enumerated in
    the framing prose, (b) preselected/prefilled on the group's control, and
    (c) mirrored as `data-default="<value>"` on the group's `.elicit-pills` /
    input element. Label the button `Accept defaults`:
    `<button type="button" class="elicit-skip">Accept defaults</button>`.
  - A data form where any group has **no** declarable default omits the button
    too — an "Accept defaults" that cannot name all its values is the old
    ambiguous Skip with a new label.

## 4. One decision per form

Where a skill mandates one-at-a-time discipline (orders confirmed one at a time;
consent/no-position approved per order; one page-pressure cut per acknowledgment),
render **one form per decision**, sequentially. Never widen a one-at-a-time
decision into a batched multi-group form — the widget must not become the bulk
approval the skill's text forbids.

## 5. Reading the answer

Answers arrive as a single compact line (`data-name`s humanized, `·`-separated),
with values over 200 chars repeated under a `--- Full content ---` fold. Parse and
proceed. Match each echoed value against the labels you rendered; resolve any id
only after the match. If the reply is `(Skipped the form — proceed with defaults or ask me in
plain text)`:

That reply can only come from a data form's **Accept defaults** button —
decision forms render no `.elicit-skip` (§ 3, footer rule). Resolve it against
the defaults you enumerated in the framing prose at render time: record those
declared values as the submitted answers, named field by field, exactly as if
the practitioner had selected each one and pressed Submit. Never treat it as
"nothing answered" and never substitute values you did not declare.

If the string arrives from a form you classified as a **decision** form, a
stale or non-conforming render slipped through: it records nothing — no
approval, confirmation, election, or discard exists. Say so and re-render the
form without the `.elicit-skip` button, or fall to the next rung of § 6. A
skip is never an approval.

## 6. Fallback ladder

Widget delivery is unreliable in some environments: a render call can error, and
a rendered form can fail to register its submission. Chat prose delivered as
your own visible reply is the fallback rung — text merely written between tool
calls is not guaranteed to reach the practitioner in every runtime, so confirm
it does, or use whatever mechanism here delivers it, before relying on it:

1. **Elicitation form** via `mcp__visualize__show_widget` — the default and only
   primary method.
2. **Plain text** — triggered by any of: the visualize tools are unavailable in
   this session, the render call errors, a reply names a field from an earlier
   form, not the current one (treat as a render error), **or the practitioner's
   reply says the form did not render or is missing content the framing prose
   described** (e.g. "I don't see it", a described option or row absent).
   Neither a § 1 fold-clip nor a transient blank render produces an error or an
   incomplete tool result — both can return the same success result as a normal
   render — so the practitioner's own report is the only signal either failure
   produces. Treat it the same as a render error: fall straight to text,
   prefixed `INPUT REQUIRED:`, enumerating the options plainly. Never bury the
   ask mid-paragraph, and never re-render the same ask hoping the widget works
   the second time. A platform hook also permits `AskUserQuestion` here for one
   ad-hoc clarification. It holds at most 4 options: an ask with more goes to
   plain text, never a trimmed menu.

A chat reply is always a valid answer. A practitioner who answers a rendered
form in plain chat — because a control did not register, or by preference — has
answered: read the reply against the options the framing prose enumerated and
record it exactly as a widget submission. Never re-render to demand the widget
be used.

Falling back is per-render, detected fresh — never cached across sessions, and
never chosen for convenience.

## 7. Custom gate widgets

A skill's hash-bound review gates are a **sanctioned specialization** of this
convention: they are already graphical `show_widget` renders, but they use the `interactive`
module and a one-submit `sendPrompt` payload contract because they must show the
exact court paper being approved and bind the approval to its hash. Do not convert
them to the `.elicit` shell — an approval collected through an `.elicit` form or
plain confirmation is void and records nothing. Nor borrow the `.elicit-*` class
names — the host auto-wires them and custom handlers stop firing. And do not use
their custom pattern for ordinary data
collection — everything that is not such a gate uses the `.elicit` form above.
Their fallback ladder is § 6 unchanged.

The gates' own widgets carry no `.elicit-skip` and are unaffected by the
data/decision footer rule; their only controls remain their payload contract's
Approve/Revise (and gate-specific) actions.

A skill's **display-only progress render** is likewise a
**sanctioned `show_widget` render**, but a *display-only* one: it shows state and
collects nothing, records nothing, and is neither an `.elicit` form nor a gate.
The data/decision footer rule, the skip semantics of §§ 3 and 5, and the gate
approve semantics all do not apply to it — it has no control that records state,
so there is nothing to skip or approve. Its fallback ladder is § 6, but with only
the chat-prose rung: when `show_widget` is unavailable or errors, render the
state as prose (there is nothing to *ask*).

## 8. Conformance checklist

Before rendering an elicitation form, every answer must be yes:

- Is every `data-value` readable by a human with no other context (a display label
  or an unambiguous phrase, not a bare id, index, or slug)?
- Does any machine key travel beside the label (in brackets, or in the skill's own
  label→id map), never instead of it?
- Do all options carry distinct values, disambiguated by human detail rather than
  an appended number?
- Does the framing prose enumerate the options by the same labels the widget uses?
- Does every option that dispatches work (§ 3) name its mechanism in the
  framing prose and in its card subtitle, and nowhere in `data-value`?
- Will the skill read the answer by matching the echoed label against the labels
  it rendered, resolving any id only after the match, and never asking the
  practitioner to confirm an id?
- Has the author rendered the widget and read the echoed line as the practitioner
  would see it, and would that line make sense pasted into an email to a colleague?
- Write the expected echo line for every option before rendering and read it back.
