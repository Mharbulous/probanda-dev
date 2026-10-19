---
name: publish-bcsc-form
description: >
  Fill BC Supreme Court .dotx form templates: generate a blank form, assemble drafted substance
  into the final .docx, convert a LEAP template, or amend a filed pleading. Covers notices of
  application, petitions, affidavits (including affidavits of service and substituted service)
  and Forms 1/8/15/16/17/32/66. Routed to by the explicit publish-bcsc-form token, with asm32,
  asm33 or asmaff after it for the strict Form 32/33/109 paths. Bill of costs -> publish-boc.
---

# publish-bcsc-form

You are a **content-blind shuttle**. You do not draft substance, classify legal content, or make routing decisions. You move opaque payloads between the harness (via Bash) and subagents (via Task). Follow this protocol exactly.

## Operations

| Operation | What it does | Invoked by |
|-----------|-------------|------------|
| **Generate** | Fill blank form with proceedings/party info; write it at the top of the matter's draft folder, or into the package's Writing folder for Form 32 or 33 | Practitioner |
| **Assemble** | Merge substance part files (`part-*.md`) into final `.docx` | `/polish-substance` or practitioner |
| **Assemble Form 33 (`asm33`)** | Hard-validate `form-33.md`, transform Parts 1-6, fill final `.docx`; the caption comes from the emitter's publish sidecar, and a NOT FINAL cover page goes in front while any warning stands (contract, Publish sidecar) | `/draft`'s Form 33 filed-face emitter (see `references/assembly-input-contract.md`) |
| **Assemble Form 32 (`asm32`)** | Hard-validate `form-32.md`, render Part 1 from frontmatter, transform Parts 2-4, fill final `.docx`; the caption comes from the emitter's publish sidecar, never a Generate run, and a NOT FINAL cover page goes in front while any warning stands (contract, Publish sidecar) | `/draft`'s Form 32 filed-face emitter (explicit `asm32` token only; a practitioner's ordinary "assemble Form 32" stays on Assemble) |
| **Assemble affidavit (`asmaff`)** | Hard-validate `affidavit-<document_id>.md`, collect the caption and jurat as Generate does, fill Form 109 with the file's paragraphs, bold exhibit references, deponent and affidavit number; the ordinal is never asked | `/draft`, for a supporting affidavit of a Form 32 or 33 it holds: init `asmaff <document_id>` with the package's Writing folder (explicit token only; contract in `references/assembly-input-contract.md`) |
| **Amend** | Amend a filed pleading per Rule 6-1 | Practitioner |
| **New Template** | Convert LEAP-exported `.dotx` to canonical bracket-placeholder format | Practitioner |
| **Validate Form 32/33 markdown** (`validate32` / `validate33`) | Hard-validate a `form-32.md` / `form-33.md` against the subset rules only — no session, no output file; exit 0 on pass, non-zero printing the exact error | No live caller — each pipeline delegates the whole `asm32`/`asm33` operation, which hard-validates through the same parser. Kept as the acceptance oracle for emitter test suites (`references/assembly-input-contract.md`). |

**Not handled here:**
- Substance drafting (Orders, Facts, Law) -> Form 32/33: use `/draft` (it emits `form-32.md`/`form-33.md` and calls `asm32`/`asm33`). Petition, NOCC, RTC: `/solver`, `/bcsc-legal-basis`, `/narrator`, or this subskill's own `draft` operation.
- Renumbering a draft affidavit -> the sibling subskill `renumber-affidavit`
- Bill of Costs (Form 62) -> the sibling subskill `publish-boc`, after `/calculate` has gathered, itemized and totalled the bill
- Default Judgment Bill of Costs (Form 63, Rule 14-1 (20)) -> also `publish-boc`, which runs the deterministic Schedule 1 engine
- If a referenced skill is not invokable in this session, read its source with `skill_source__read` at `<name>/SKILL.md` and follow it.

## Form style-guide routing

Form-specific drafting and formatting rules live outside this file. In regular
mode, after classification resolves to a registered form and before continuing
the form workflow:

1. Read `forms/000-SOP/style-guide.md`.
2. Read exactly the selected form's guide from the table below.
3. Do not read any other form directory.

Resolve the paths relative to this subskill's folder.

| Form ID | Style guide |
|---|---|
| `form-1` | `forms/001-NOCC/style-guide.md` |
| `form-2` | `forms/002-RNOCC/style-guide.md` (reserved; Form 2 is not registered) |
| `form-4` | `forms/004-RCC/style-guide.md` |
| `form-8` | `forms/008-DJ/style-guide.md` |
| `form-17` | `forms/017-REQ/style-guide.md` |
| `form-32` | `forms/032-NOA/style-guide.md` |
| `form-33` | `forms/033-AR/style-guide.md` |
| `form-66` | `forms/066-PET/style-guide.md` |
| `form-15` | `forms/015-AFS/style-guide.md` |
| `form-16` | `forms/016-AOS/style-guide.md` |
| `affidavit` | `forms/109-AFF/style-guide.md` |
| `form-123` | `forms/123-OTSC/style-guide.md` |

Forms 62 and 63 are excluded from this routing and from this subskill
altogether: a bill of costs belongs to the sibling subskill `publish-boc`,
which is neither a bracket-placeholder template shuttled through
Generate/Assemble (Form 62 takes a computed context file) nor a form at all in
Form 63's case (a deterministic Schedule 1 engine).
An unregistered or custom form with no listed guide does not cause other
guides to be loaded.

## Shuttle Protocol

```
# --- Resolve the harness inputs (before init) ---
# {matter}: the matter folder.
# {matter-data folder}: the folder probanda.json's case_data_dir names. It must already
# exist; if it does not, STOP and tell the practitioner to run /matter-data initialize.
# Never create it. In a Code-tab (PC) session whose shell cannot yet reach it, first
# request access to the matter-data folder itself (never a parent or the firm root),
# then use the path the session sees. If access is not granted, STOP: never build
# stand-in copies of the matter or matter-data folders in scratch (#1240).
# In Cowork, make no such request: the sandbox sees neither the matter folder nor the
# matter-data folder (#1241), and the host tool in the Cowork branch below derives the
# matter-data folder itself.
# A package is Form 32 or Form 33, or an affidavit (Form 109, 15 or 16) the caller says
# is sworn for one. Every other form is an individual form.
# {stem}: an individual form's file name stem. Compose it under /file-naming's grammar
# (no " vN", no extension) and run its gate on it before init. On a fail, or a date or
# code you cannot pin down, ask the practitioner; never fall back to the title. The
# finished .docx is saved as {stem}.docx at the top of the matter's draft folder.
# {writing folder}: a package's own folder under the draft folder, one path segment.
# The caller passes it: /draft, the folder its mockup presentation copy was rendered
# into; for an affidavit sworn for a package, that package's folder. For a Form 32 or
# 33 with no Writing, name a `{CODE} {description}` folder by /file-naming's grammar.
# Working files go under {matter-data folder}; a package's finished .docx goes under
# {writing folder}.
# Never infer an affidavit ordinal into user_request.

# --- Resolve the harness (environment-aware) ---
# Local (repo checkout), run from repo root:
HARNESS = "python .claude/skills/publish/subskills/publish-bcsc-form/scripts/harness.py"
#
# Cowork: never run the harness in the sandbox shell, which cannot see the matter
# folder or the matter-data folder (#1267, ADR 0025). Each BASH("{HARNESS} <command> ...")
# below is instead one call to the tool drafting_forms__bcsc_form_harness, which runs
# the harness on the host and returns its JSON output unchanged:
#   matter_root    = the matter folder's host path, as drafting_forms__open_session takes it
#   command        = <command>, with harness_session = <session_id> for every command but list and init:
#                    the session_id of the most recent response that carries one, not one held
#                    from earlier (classify, reset and clarify rename the session; Key Rule 4)
#   its text arg   = user_request (init), result_json (classify, step), new_request (reset),
#                    answer (clarify) or target_step_id (rewind)
#   out_name       = {stem} (init only, an individual form)
#   writing_folder = {writing folder} (init only, a package; never with out_name)
#   edits_reviewed = true (init only, and only after a manual_edits action; see below)
# There is no matter-data folder argument: the server derives it from probanda.json and keeps
# session state in its form-sessions folder. A done payload's context_path is then a host
# path in the real matter-data folder.
# If the tool refuses (new-template, a path outside the matter) or times out, tell the
# practitioner its message, which says what to do next.
# Two operations are Code-tab (PC) jobs in Cowork, because a subagent must reach a host
# file itself: Amend (its identify step reads the practitioner's .docx, and its spec
# subagent writes a file on the host) and Form 16's substituted-service Generate (gen.order
# has a subagent read the entered order in the matter folder). For either, tell the
# practitioner to run it in a Claude Code (PC) session, and stop before init. If only
# classification reveals it (an amend.* step or gen.order), abandon the session and stop.
# If no matter folder is attached (in Cowork: if the matter folder's host path is not
# known), STOP and ask for one before init — sessions are matter state.

# --- Session discovery ---
sessions = BASH("{HARNESS} list")
if a session in sessions matches user_request:
    session_id = that session's session_id
    response = BASH("{HARNESS} resume <session_id>")
else:
    # An individual form passes --out-name '{stem}'; a package passes
    # --writing-folder '{writing folder}' in its place. The harness refuses both or neither.
    response = BASH("{HARNESS} init '<user_request>' --matter-path '{matter}' --matter-data-folder '{matter-data folder}' --out-name '{stem}'")

# --- Session id: carried forward from every response ---
# classify, reset and clarify rename the session and return the new id; the old id
# then fails with session_not_found. So <session_id> below is always the latest
# response's session_id. retry and halt carry none: keep the one you hold, but a
# classify that halts may already have renamed the session. If the id is unknown or
# rejected as session_not_found, call list and take it from there.

# --- Classification loop ---
# After init, harness returns spawn_subagent for classification.
# Shuttle the result back via: BASH("{HARNESS} classify <session_id> '<result>'")
# Repeat until harness returns a step (not classify) action.

# --- Standard shuttle loop ---
while response.action != "done":
    if response.session_id:
        session_id = response.session_id

    if response.action == "spawn_subagent":
        subagent_result = TASK(prompt=response.prompt, schema=response.schema)
        if response.route_to == "classify":
            response = BASH("{HARNESS} classify <session_id> '<subagent_result>'")
        else:
            response = BASH("{HARNESS} step <session_id> '<subagent_result>'")

    elif response.action == "retry":
        subagent_result = TASK_CONTINUE(error=response.error)
        response = BASH("{HARNESS} step <session_id> '<subagent_result>'")

    elif response.action == "ask_user":
        answer = ASK_USER(question=response.question, options=response.options)

        # Detection priority (check in order):
        # 1. Re-classification: user wants a different form/mode entirely
        if IS_RECLASS(answer):
            response = BASH("{HARNESS} reset <session_id> '<answer>'")

        # 2. Backtracking: user wants to revise a prior step
        elif IS_BACKTRACK(answer):
            target = IDENTIFY_STEP(answer)
            response = BASH("{HARNESS} rewind <session_id> '<target>'")

        # 3. Ambiguous classification: the harness could not pick a form.
        #    Its answer goes to `clarify`, never to `step` -- current_step is
        #    None at classification time, and `reset` would replace the
        #    original request with the one-word answer.
        elif response.route_to == "classify":
            response = BASH("{HARNESS} clarify <session_id> '<answer>'")

        # 4. Normal answer
        else:
            response = BASH("{HARNESS} step <session_id> '{\"user_answer\": \"<answer>\"}'")

    elif response.action == "oow":
        handle_side_conversation(response.lawyer_question, response.context)
        response = BASH("{HARNESS} step <session_id> '{\"kind\": \"oow_resolved\"}'")

    elif response.action == "missing_template":
        TELL_USER(response.message)
        response = BASH("{HARNESS} resume <session_id>")

    elif response.action == "manual_edits":
        # Nothing was written. See "Manual edits to the last copy" below.
        SHOW_MANUAL_EDITS(response.copies)
        BASH("{HARNESS} abandon <session_id>")
        # After the practitioner's answer (and any carry), re-emit if anything was
        # carried, then init again with the same arguments plus --edits-reviewed.
        break

    elif response.action == "halt":
        TELL_USER(response.error)
        break
```

A step whose result the harness computes itself runs inside the same call, so an `asm32`, `asm33` or `asmaff` run can return `done` with no subagent at all. After an assemble fill, verify warns and never halts, because the file already exists. When `done` carries `verify_passed: false`, list each entry of `verify_warnings` to the practitioner, one line each, and never call the document final.

## Generate Handoff

After Generate completes (blank form produced), end with:

> "Blank form saved to `{output_path}` (at the top of the matter's draft folder, or in the `{writing folder}` folder for a package). Handoff file saved to `{context_path}`. Start a new session and run `/solver` to draft the orders sought."

Before saying so, check that `{context_path}` exists in the real matter-data folder,
the one `probanda.json`'s `case_data_dir` names, and not in a scratch or `/tmp` copy.
A later Assemble run reads that file, and it cannot see a sandbox copy (#1240).
If the file is anywhere else, or the matter-data folder was never reachable, do not
report success: never build stand-in copies of the matter or matter-data folders to get
past it. Stop and tell the practitioner what was written and where, and that access to
the real matter-data folder is needed.

In Cowork, the host tool's `done` payload is that check: the server wrote
`{context_path}` in the real matter-data folder, the one it derived from `probanda.json`.
The sandbox cannot see that folder, so do not look for the file there.

**Service affidavits (Forms 15 and 16) are complete at Generate** — there are no
substance parts and no `/solver` handoff. End with:

> "Affidavit saved to `{output_path}`. Review it, then arrange swearing or affirming."

When the completion payload carries a `compliance_table` (the substituted-service
variant), display that table verbatim in chat above the handoff line, and say:

> "Review the compliance table against the order, then arrange affirmation."

The table is chat-only — never write it into the document or a file.

If the practitioner names a folder for the form, pass that name as `{writing folder}` at init. Otherwise an individual form is saved at the top of the draft folder as `{stem}.docx`; only Form 32, Form 33 and an affidavit sworn for a package go into a `{writing folder}`.

**Never overwrite.** A taken name gets the next ` vN`: when the `done` payload carries `versioned_from` (after Amend, also `clean_versioned_from` for the clean copy), it names the copy passed over. Tell the practitioner, in case it is another document's, then present the new copy (`shared/present-files.md`) as current per the workspace output rule. A ` vN` is taken when either its `.docx` or its `.pdf` exists, so a new Word copy never sits beside a PDF of the same ` vN` made from other content; the harness renders each PDF afresh from its own `.docx`.

## Manual edits to the last copy

Each finished run records a fingerprint of every Word copy it wrote: each paragraph's text, and a hash of its text and format, in `fingerprints.json` in the matter-data folder's `bcsc-form-substance` folder. When `done` carries `fingerprint_error`, tell the practitioner in one line that the next publish cannot check that copy for edits.

Before the fill writes the next copy of the same series, the harness compares the series' newest copy with the last copy it generated. A newer copy it did not write (a session's patch, a copy saved from Word) or an edit made to its own copy returns `manual_edits` instead of writing anything, with `copies`: one entry per series, each with `newest` (the copy read), `generated` (the copy it was compared with) and `changes`. Each change has `kind` and `paragraph`, the paragraph's number in the newest copy (none for a removed paragraph):

- `kind: "text"`: the words differ. `generated` is the paragraph as the harness wrote it, `current` as the newest copy holds it; either is empty for an added or removed paragraph.
- `kind: "format"`: the same words with a different format, or an empty paragraph added or removed. `text` is the paragraph.

Show the practitioner every change, one line each, naming the newest copy. Say plainly that the next copy is regenerated from the drafting database, so a text change is lost unless it is carried, and a format change is lost in any case: list each format change as "will not carry". A text change the practitioner wants kept is carried into the drafting database by `/draft`'s on-the-fly revision, one paragraph per approval, with the paragraph's `generated` text as the text as rendered and its `current` text as the revised wording. Nothing is written to the database without that approval. Then re-emit the substance if anything was carried, and init again with the same arguments plus `--edits-reviewed` (in Cowork, `edits_reviewed: true`), which writes the next copy without checking again. A copy written before fingerprints were recorded has none, so its edits are not detected.

## User Communication

**Rule:** All reasoning, file-inspection findings, and "let me check X" narration stays inside `<thinking>` blocks or tool-call description text. It never appears as plain response prose visible to the user.

**Between tool calls, emit only:** outcome of the last step + what's next -- one or two sentences max.

Format: `[Outcome -- success/failure + one-line result]. [Next action, named concisely].`

If a step fails, say what failed and what you'll try instead. Do not narrate "I noticed that..." or "Let me now..." or "Got the inventory."

## Confirmation Mode

**Rule:** Never use `AskUserQuestion` to confirm matter data, profile details, or any information that requires surrounding prose for context. In Cowork mode, prose written before an `AskUserQuestion` widget is not visible to the practitioner — only the widget itself appears.

Instead, display the data as plain text in the chat and ask the practitioner to confirm by replying in chat (e.g., "Does this look correct? Reply yes to proceed or tell me what to change.").

`AskUserQuestion` is permitted only for self-contained choices where the question text alone provides full context (e.g., the Draft Existence Check below).

## Draft Existence Check

After classification resolves and the form type is known, if the matter workspace path is available, look for an already-filled `.docx` of the same form type in `{location}`: for an individual form, the top of the matter's draft folder (resolved by matching `0. DRAFT*`), where the stem's series is `{stem}.docx` and `{stem} vN.docx`; for a package, the Writing folder (`{writing folder}` under the draft folder). If a matching draft file is found:

```
choice = ASK_USER(
    question="A draft [form name] already exists in {location}. Create a new [form name] or amend the existing draft?",
    options=["Create a new [form name]", "Amend the existing draft"]
)
if choice == "Amend the existing draft":
    response = BASH("{HARNESS} reset <session_id> 'amend the [form name] in {location}'")
```

Run this check once, immediately after the classification loop exits. Skip if the matter workspace path is not yet known.

In Cowork, skip this check: the sandbox cannot see the draft folder. The harness, running on the host, still never overwrites an existing `.docx`: it writes a new `vN` copy beside it.

## Detection Rules

**IS_RECLASS(answer):** The answer contains language naming a different form or mode than the one in progress -- e.g. "actually let's do an NOCC", "switch to an amendment instead." If uncertain, use ASK_USER to clarify before calling reset.

**IS_BACKTRACK(answer):** The answer contains revision language referencing a prior step -- e.g. "I got the party name wrong." Map natural language to a step_id. If ambiguous, use ASK_USER to clarify: "Which step would you like to revise?"

## Key Rules

1. **Never read subagent prompts.** Copy `response.prompt` into the Task tool's prompt field verbatim.
2. **Never parse subagent results.** Copy the subagent's return text into the harness step command verbatim.
3. **Task tool = fresh subagent.** Every `TASK(...)` is a Task-tool spawn with a fresh context window, not an inline LLM turn. A step whose result is fixed runs inside the harness and is never returned as `spawn_subagent`: `asm32` and `asm33` run from locate to verify that way, so their `init` (or `classify`) can return `done` directly.
4. **Session ID tracking.** Pass each command the `session_id` from the most recent harness response that carries one, not one you held from earlier, such as `init`'s: `classify`, `reset` and `clarify` rename the session, and the old id then fails with `session_not_found`. If you no longer hold a valid id (after a timeout, or a `session_not_found`), call `list` and take the session's id from there.
5. **Abandon dead sessions.** If a session is dead (halted, superseded, or the practitioner moves on), run `BASH("{HARNESS} abandon <session_id>")` to delete it.
6. **Matter path.** Answer a matter-path `ask_user` from `{matter}` yourself; never re-ask.

## Form Registry

| Form | Rule | Asset | Fill script | Notes |
|------|------|-------|-------------|-------|
| Notice of Application (Form 32) | Rule 8-1 | `subskills/publish-bcsc-form/templates/032-noa.dotx` | `fill_plain.py` | Generate + Assemble |
| Petition (Form 66) | Rule 16-1 | `subskills/publish-bcsc-form/templates/066-petition.dotx` | `fill_plain.py --form petition` | Generate + Assemble |
| Notice of Civil Claim (Form 1) | Rule 3-1 | `subskills/publish-bcsc-form/templates/001-nocc.dotx` | `fill_plain.py --form nocc` | Generate + Assemble |
| Response to Counterclaim (Form 4) | Rule 3-4 | `subskills/publish-bcsc-form/templates/004-rtc.dotx` | `fill_plain.py --form rtc` | Generate + Assemble |
| Requisition – General (Form 17) | — | `subskills/publish-bcsc-form/templates/form-17.docx` | `fill_plain.py --form form-17` | Generate only |
| Default Judgment (Form 8) | — | `subskills/publish-bcsc-form/templates/form-8.docx` | `fill_plain.py --form form-8` | Generate only |
| Offer to Settle Costs (Form 123) | Rule 9-1(6) | `subskills/publish-bcsc-form/templates/123-otsc.dotx` | `fill_plain.py --form otsc` | Generate only |
| Affidavit of Personal Service (Form 15) | Rule 4-6(1) | `subskills/publish-bcsc-form/templates/015-afs.docx` | `fill_plain.py --form afs` | Generate only |
| Affidavit of Ordinary Service (Form 16) | Rule 4-6(1) | `subskills/publish-bcsc-form/templates/016-aos.docx` | `fill_plain.py --form aos` | Generate only; substituted-service variant (Rule 4-4 + 22-3(1)) requires the entered order |
| Affidavit (Form 109) | Rule 22-2 | `subskills/publish-bcsc-form/templates/affidavit.dotx` | `fill_plain.py --form affidavit` | A supporting affidavit of a Form 32 or 33 `/draft` holds: `asmaff` fills its text from `/draft`'s emitted file. An affidavit with no host filing `/draft` holds: Generate only, its substance hand-authored into document.xml using the template's LEAPBCParaNum styles (#1371's interim route) |
| Application Response (Form 33) | Rule 8-1(6) | `subskills/publish-bcsc-form/templates/form-33.dotx` | `fill_plain.py --form form-33` | Generate + `asm33` Assemble |

Each form's version, and the amending regulations its template, emitter and type file conform to (`conformed_to:`), are recorded on its identity file in `/publish`'s knowledge tree, as `/publish`'s "Form identity" section describes. A form is conformed to an amendment only in a plugin release. A session that meets a `form_currency` warning says it, and the practitioner can ask for the release with `/lawyer:suggestion` naming the form and the amending regulation.

**Not listed:** Bill of Costs (Form 62) and Default Judgment Bill of Costs (Form 63) -- both are the sibling subskill `publish-boc`.

**Runtime additions:** Forms added via the missing-template workflow are stored in `custom_forms.json` and merged into the registry at startup. They appear as `generate_only: true` by default.

## Constraints

- Uses `lxml` only (not stdlib `xml.etree`) -- required to preserve `mc:Ignorable` namespace declarations.
- No script named `inspect.py` inside any sub-package -- shadows stdlib `inspect`, breaking `lxml` imports.
