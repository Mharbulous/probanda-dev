"""publish-bcsc-form v2 — Deterministic harness.

CLI state machine. Each invocation reads ctx.json, does one action,
writes ctx.json, returns JSON to stdout.

Usage:
    python harness.py <command> [<json_arg>]

Commands:
    init, classify, step, list, resume, abandon, reset, rewind
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent          # scripts/
SKILL_ROOT = HERE.parent                        # publish-bcsc-form/
# Session state lives beside the scripts by default, but the install dir may be
# read-only (Cowork) and is wiped on reinstall, so DRAFT_BCSC_SESSIONS_DIR relocates
# it into the matter's matter-data folder ({matter-data folder}/form-sessions) when set.
SESSIONS_DIR = Path(os.environ["DRAFT_BCSC_SESSIONS_DIR"]) if "DRAFT_BCSC_SESSIONS_DIR" in os.environ else SKILL_ROOT / "sessions"

# ---------------------------------------------------------------------------
# Form Registry (Section 9 parity)
# ---------------------------------------------------------------------------

REGISTRY = {
    "form-32": {
        "name": "Notice of Application (Form 32)",
        "rule": "Rule 8-1",
        "template": "templates/032-noa.dotx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "noa",
        "workflow": None,
        "sources_scope": "router_default",
        "generate_only": False,
    },
    "form-66": {
        "name": "Petition (Form 66)",
        "rule": "Rule 16-1",
        "template": "templates/066-petition.dotx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "petition",
        "workflow": None,
        "sources_scope": "router_default",
        "generate_only": False,
    },
    "form-123": {
        "name": "Offer to Settle Costs (Form 123)",
        "rule": "Rule 9-1(6)",
        "template": "templates/123-otsc.dotx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "otsc",
        "workflow": None,
        "sources_scope": "declared_in_workflow",
        "generate_only": True,
    },
    "form-1": {
        "name": "Notice of Civil Claim (Form 1)",
        "rule": "Rule 3-1",
        "template": "templates/001-nocc.dotx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "nocc",
        "workflow": None,
        "sources_scope": "router_default",
        "generate_only": False,
    },
    "form-4": {
        "name": "Response to Counterclaim (Form 4)",
        "rule": "Rule 3-4",
        "template": "templates/004-rtc.dotx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "rtc",
        "workflow": None,
        "sources_scope": "router_default",
        "generate_only": False,
    },
    "form-17": {
        "name": "Requisition – General (Form 17)",
        "rule": "",
        "template": "templates/form-17.docx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "form-17",
        "workflow": None,
        "sources_scope": None,
        "generate_only": True,
    },
    "form-8": {
        "name": "Default Judgment (Form 8)",
        "rule": "",
        "template": "templates/form-8.docx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "form-8",
        "workflow": None,
        "sources_scope": None,
        "generate_only": True,
    },
    "form-33.01": {
        "name": "Notice of Hearing of Application (Form 33.01)",
        "rule": "Rule 8-1(14.4)(a)",
        "template": "templates/form-33.01.docx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "form-33.01",
        "workflow": None,
        "sources_scope": None,
        "generate_only": True,
    },
    "form-30.001": {
        "name": "Record cover (Form 30.001)",
        "rule": "Rule 8-1(15)",
        "template": "templates/form-30.001.docx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "form-30.001",
        "workflow": None,
        "sources_scope": None,
        "generate_only": True,
    },
    "form-15": {
        "name": "Affidavit of Personal Service (Form 15)",
        "rule": "Rule 4-6(1)",
        "template": "templates/015-afs.docx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "afs",
        "workflow": None,
        "sources_scope": None,
        "generate_only": True,
    },
    "form-16": {
        "name": "Affidavit of Ordinary Service (Form 16)",
        "rule": "Rule 4-6(1)",
        "template": "templates/016-aos.docx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "aos",
        "workflow": None,
        "sources_scope": None,
        "generate_only": True,
    },
    "affidavit": {
        "name": "Affidavit (Form 109, Rule 22-2)",
        "rule": "Rule 22-2",
        "template": "templates/affidavit.dotx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "affidavit",
        "workflow": None,
        "sources_scope": None,
        "generate_only": True,
    },
    "form-33": {
        "name": "Application Response (Form 33)",
        "rule": "Rule 8-1(9)-(10)",
        "template": "templates/form-33.dotx",
        "fill_script": "fill_plain.py",
        "fill_form_arg": "form-33",
        "workflow": None,
        "sources_scope": "router_default",
        "generate_only": True,
    },
}

# ---------------------------------------------------------------------------
# Custom Forms (external registry for forms added at runtime)
# ---------------------------------------------------------------------------

CUSTOM_REGISTRY_PATH = SKILL_ROOT / "custom_forms.json"


def _load_custom_registry():
    if CUSTOM_REGISTRY_PATH.exists():
        try:
            data = json.loads(
                CUSTOM_REGISTRY_PATH.read_bytes().rstrip(b"\x00").decode("utf-8"))
            REGISTRY.update(data)
        except (json.JSONDecodeError, OSError):
            pass


def _save_custom_registry_entry(form_id: str, entry: dict):
    existing = {}
    if CUSTOM_REGISTRY_PATH.exists():
        try:
            existing = json.loads(
                CUSTOM_REGISTRY_PATH.read_bytes().rstrip(b"\x00").decode("utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    existing[form_id] = entry
    CUSTOM_REGISTRY_PATH.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    REGISTRY[form_id] = entry


_load_custom_registry()

# ---------------------------------------------------------------------------
# Step Sequences (Section 5 / Reference Skeleton)
# ---------------------------------------------------------------------------

SEQUENCES = {
    "generate":     ["gen.matter_profile", "gen.scalars", "gen.fill",
                     "shared.verify"],
    # Form 16's substituted-service variant: the entered Rule 4-4 order is read
    # before scalars, because its terms are the source of truth for sections 1
    # and 2 and the practitioner is not asked to retype them.
    "generate-subserv": ["gen.matter_profile", "gen.order", "gen.scalars",
                         "gen.fill", "shared.verify"],
    "draft":        ["gen.matter_profile", "draft.part1", "draft.part2",
                     "draft.part3", "draft.part4"],
    "assemble":     ["gen.matter_profile", "asm.locate_inputs",
                     "asm.assemble_body", "asm.fill", "shared.verify"],
    "asm33":        ["asm33.locate", "asm33.validate",
                     "asm33.transform", "asm33.fill", "shared.verify"],
    "asm32":        ["asm32.locate", "asm32.validate",
                     "asm32.transform", "asm32.fill", "shared.verify"],
    # Form 109 from drafting_forms__emit_affidavit's file (#1488): the caption
    # and jurat are collected as for Generate, the body comes from the file.
    "asmaff":       ["asmaff.locate", "gen.matter_profile", "gen.scalars",
                     "asmaff.fill", "shared.verify"],
    "full":         ["gen.matter_profile", "gen.scalars", "gen.fill",
                     "shared.verify",
                     "draft.part1", "draft.part2", "draft.part3",
                     "draft.part4",
                     "asm.locate_inputs", "asm.assemble_body", "asm.fill",
                     "shared.verify"],
    "amend":        ["amend.identify", "amend.propose", "amend.spec",
                     "amend.run"],
    "new-template": ["nt.inspect_tmpl", "nt.configure", "nt.convert",
                     "nt.validate"],
}

# The fill step that ends each phase. shared.verify reads the step just before
# it to choose its rules: Assemble-phase (strict) after an ASSEMBLY_FILLS step,
# Generate-phase (lenient) after any other. GENERATE_FILLS exists so that
# test_verify_phase fails when a sequence's final fill is in neither set.
ASSEMBLY_FILLS = frozenset({"asm.fill", "asm32.fill", "asm33.fill", "asmaff.fill"})
GENERATE_FILLS = frozenset({"gen.fill"})

# Mode -> sequence mapping for Tier 1 short-circuits
MODE_SEQUENCES = {
    "amend": "amend",
    "new-template": "new-template",
}

# ---------------------------------------------------------------------------
# Step Module Loader
# ---------------------------------------------------------------------------

STEPS: dict[str, dict] = {}


def _load_step_module(step_id: str):
    """Import a step module by dotted step_id and register in STEPS."""
    # step_id like "gen.matter_profile" -> steps/gen/matter_profile.py
    parts = step_id.split(".")
    if len(parts) != 2:
        raise ValueError(f"Invalid step_id format: {step_id}")
    package, module_name = parts
    module_path = f"steps.{package}.{module_name}"
    import importlib
    mod = importlib.import_module(module_path)
    STEPS[step_id] = {
        "id": step_id,
        "precondition": mod.precondition,
        "build_prompt": mod.build_prompt,
        "response_schema": mod.response_schema,
        "validate": mod.validate,
        "apply": mod.apply,
        "calls_script": getattr(mod, "calls_script", None),
        "max_retries": getattr(mod, "max_retries", 2),
        # computed(ctx) -> True: build_prompt returns the finished step_result,
        # so the harness applies it in-process instead of spawning a subagent.
        "computed": getattr(mod, "computed", None),
    }


def load_all_steps():
    """Load all step modules referenced by any sequence."""
    loaded = set()
    for seq in SEQUENCES.values():
        for step_id in seq:
            if step_id not in loaded:
                try:
                    _load_step_module(step_id)
                    loaded.add(step_id)
                except (ImportError, ModuleNotFoundError):
                    pass  # Step module not yet implemented


# ---------------------------------------------------------------------------
# Context helpers
# ---------------------------------------------------------------------------

def _make_session_id(matter_id: str, form_id: str, ts: str) -> str:
    return f"{matter_id}__{form_id}__{ts}"


def _session_dir(session_id: str) -> Path:
    return SESSIONS_DIR / session_id


def _ctx_path(session_id: str) -> Path:
    return _session_dir(session_id) / "ctx.json"


def new_ctx(user_request: str, matter_id: str = "",
            matter_path: str = "", case_data_folder: str = "",
            writing_folder: str = "", out_name: str = "",
            edits_reviewed: bool = False) -> dict:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    session_id = _make_session_id(matter_id or "unknown", "unclassified", ts)
    return {
        "user_request": user_request,
        "matter_id": matter_id,
        "matter_path": matter_path,
        # Supplied by the caller at init: working files go under the matter-data
        # folder, final documents under the Writing's folder in the draft folder
        # (a package) or at the draft folder's root as <out_name>.docx (#1324).
        "case_data_folder": case_data_folder,
        "writing_folder": writing_folder,
        "out_name": out_name,
        # Set by --edits-reviewed: the practitioner has seen the differences in
        # the newest copy (a manual_edits action), so the fill writes anyway.
        "edits_reviewed": edits_reviewed,
        "form_id": None,
        "mode": None,
        "operation": None,
        "sequence": None,
        "step_index": 0,
        "current_step": None,
        "step_answers": [],
        "profile": None,
        "profile_confirmed": False,
        "scalars": None,
        "output_path": None,
        "stale_outputs": [],
        "session_id": session_id,
        "start_ts": ts,
        "attempts": 0,
    }


def save_ctx(ctx: dict) -> None:
    d = _session_dir(ctx["session_id"])
    d.mkdir(parents=True, exist_ok=True)
    _ctx_path(ctx["session_id"]).write_text(
        json.dumps(ctx, indent=2, ensure_ascii=False), encoding="utf-8")


def load_ctx(session_id: str) -> dict:
    p = _ctx_path(session_id)
    return json.loads(p.read_bytes().rstrip(b"\x00").decode("utf-8"))


def find_session_id() -> str | None:
    """Find the most recently modified session."""
    if not SESSIONS_DIR.exists():
        return None
    candidates = []
    for d in SESSIONS_DIR.iterdir():
        ctx_file = d / "ctx.json"
        if ctx_file.exists():
            candidates.append((ctx_file.stat().st_mtime, d.name))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


# ---------------------------------------------------------------------------
# Snapshot helpers (Section 3.2.3)
# ---------------------------------------------------------------------------

def save_snapshot(ctx: dict, step_id: str) -> None:
    """Save pre-step ctx snapshot for rollback."""
    d = _session_dir(ctx["session_id"])
    snap_path = d / f"ctx_before_{step_id}.json"
    snap_path.write_text(
        json.dumps(ctx, indent=2, ensure_ascii=False), encoding="utf-8")


def load_snapshot(session_id: str, step_id: str) -> dict | None:
    d = _session_dir(session_id)
    snap_path = d / f"ctx_before_{step_id}.json"
    if not snap_path.exists():
        return None
    return json.loads(snap_path.read_bytes().rstrip(b"\x00").decode("utf-8"))


def delete_snapshots_from(session_id: str, sequence: list[str],
                          from_index: int) -> list[str]:
    """Delete snapshots for steps at or after from_index.

    Forward snapshots are pure cleanup -- save_snapshot() overwrites each
    step's snapshot when the step re-runs, so a stale undeleted file can
    never be restored out of order. A locked/unremovable file is therefore
    reported, not fatal.
    """
    d = _session_dir(session_id)
    warnings = []
    for step_id in sequence[from_index:]:
        snap_path = d / f"ctx_before_{step_id}.json"
        if snap_path.exists():
            try:
                snap_path.unlink()
            except OSError as e:
                warnings.append(f"could not delete snapshot for "
                                f"'{step_id}': {e}")
    return warnings


# ---------------------------------------------------------------------------
# CLI Commands
# ---------------------------------------------------------------------------

def _emit(action_dict: dict) -> None:
    """Print JSON action to stdout and exit."""
    print(json.dumps(action_dict, ensure_ascii=False))
    sys.exit(0)


def _build_step_action(ctx: dict) -> dict:
    """Build spawn_subagent action for the current step."""
    step_id = ctx["current_step"]
    step = STEPS[step_id]
    ok, msg = step["precondition"](ctx)
    if not ok:
        return {"action": "halt", "reason": "precondition_failed",
                "error": msg, "step_id": step_id}
    try:
        prompt = step["build_prompt"](ctx)
    except (RuntimeError, ValueError, OSError) as e:
        if not (step["computed"] and step["computed"](ctx)):
            raise
        # A computed step's raise is its result, and a retry would raise the same:
        # a malformed form-32.md halts at validate instead of crashing the harness.
        save_ctx(ctx)
        return {"action": "halt", "reason": "step_failed",
                "step_id": step_id, "error": str(e)}
    save_ctx(ctx)  # persist any mutations from build_prompt
    if step["computed"] and step["computed"](ctx):
        # The "prompt" is already the step's result: apply it and advance.
        return cmd_step(ctx["session_id"], prompt)
    return {
        "action": "spawn_subagent",
        "session_id": ctx["session_id"],
        "step_id": step_id,
        "prompt": prompt,
        "schema": step["response_schema"],
        "route_to": "step",
    }


def cmd_init(user_request: str, matter_path: str = "",
             case_data_folder: str = "", writing_folder: str = "",
             out_name: str = "", edits_reviewed: bool = False) -> dict:
    """Create session, return the combined classification prompt."""
    ctx = new_ctx(user_request, matter_path=matter_path,
                  case_data_folder=case_data_folder,
                  writing_folder=writing_folder, out_name=out_name,
                  edits_reviewed=edits_reviewed)
    # Explicit asm32 invocation from /draft: strict Form 32
    # markdown assemble. Deterministic — skip classification entirely. This is
    # gated on an explicit `asm32` token the pipeline injects; it is NEVER
    # triggered by a practitioner's ordinary "assemble Form 32" request (which
    # contains no such token and stays on the Assemble path). Contrast asm33,
    # where assemble-intent alone forces the strict path.
    if "asm32" in user_request.lower():
        ctx["mode"] = "regular"
        ctx["form_id"] = "form-32"
        ctx["form_name"] = REGISTRY["form-32"]["name"]
        ctx["form_registered"] = True
        ctx["operation"] = "asm32"
        ctx["sequence"] = "asm32"
        ctx["step_index"] = 0
        ctx["current_step"] = SEQUENCES["asm32"][0]
        save_ctx(ctx)
        return _build_step_action(ctx)
    # Explicit `asmaff <document_id>` from /draft: Form 109 filled strictly
    # from drafting_forms__emit_affidavit's file. Gated on the token, like asm32.
    if re.search(r"\basmaff\b", user_request, re.I):
        match = re.search(r"\basmaff\s+(\d+)\b", user_request, re.I)
        if not match:
            save_ctx(ctx)
            return {"action": "halt", "session_id": ctx["session_id"],
                    "error": "asmaff needs the affidavit's document id: "
                             "init 'asmaff <document_id>'."}
        ctx["mode"] = "regular"
        ctx["form_id"] = "affidavit"
        ctx["form_name"] = REGISTRY["affidavit"]["name"]
        ctx["form_registered"] = True
        ctx["operation"] = "asmaff"
        ctx["sequence"] = "asmaff"
        ctx["affidavit_document_id"] = int(match.group(1))
        ctx["step_index"] = 0
        ctx["current_step"] = SEQUENCES["asmaff"][0]
        save_ctx(ctx)
        return _build_step_action(ctx)
    save_ctx(ctx)
    from steps.classify.combined import build_classify_prompt, response_schema
    return {
        "action": "spawn_subagent",
        "prompt": build_classify_prompt(user_request),
        "schema": response_schema,
        "session_id": ctx["session_id"],
        "route_to": "classify",
    }


def cmd_classify(session_id: str, result_json: str) -> dict:
    """Validate the combined classification result, select the sequence."""
    ctx = load_ctx(session_id)
    result = json.loads(result_json)

    # Unwrap envelope if present (subagents return {kind, data} wrappers)
    if result.get("kind") == "step_result" and "data" in result:
        result = result["data"]

    from steps.classify.combined import validate as validate_combined
    ok, err = validate_combined(result, ctx)
    if not ok:
        return {"action": "retry", "error": err,
                "step_id": "classify", "attempt": ctx["attempts"]}

    mode = result["mode"]
    ctx["mode"] = mode

    # Short-circuit for amend / new-template
    if mode in MODE_SEQUENCES:
        seq_key = MODE_SEQUENCES[mode]
        ctx["sequence"] = seq_key
        ctx["step_index"] = 0
        ctx["current_step"] = SEQUENCES[seq_key][0]
        save_ctx(ctx)
        return _build_step_action(ctx)

    # --- Ambiguity gate ---
    # A classifier that is unsure must not pick a form. "Affidavit of service"
    # alone does not say whether service was personal (Form 15) or ordinary
    # (Form 16), and the two forms depose to different facts.
    if result.get("ambiguous") or result.get("confidence", 1.0) < 0.8:
        ctx["step_answers"] = []
        save_ctx(ctx)
        proposed = result.get("form_name") or result.get("form_id") or "a form"
        return {
            "action": "ask_user",
            "session_id": ctx["session_id"],
            "route_to": "classify",
            "question": (
                f"I could not tell which form this request needs. The closest "
                f"match is {proposed}, but the request is ambiguous. Which form "
                f"should I use?"),
            "options": sorted(spec["name"] for spec in REGISTRY.values()),
        }

    # Regular mode: form + operation classified in the same pass
    form_id = result["form_id"]
    ctx["form_id"] = form_id
    ctx["form_name"] = result.get("form_name", "")
    ctx["form_registered"] = result.get("registered", True)
    # Rename session directory
    old_sid = ctx["session_id"]
    parts = old_sid.split("__")
    new_sid = f"{parts[0]}__{form_id}__{parts[2]}"
    old_dir = _session_dir(old_sid)
    new_dir = _session_dir(new_sid)
    if old_dir != new_dir and old_dir.exists():
        try:
            old_dir.rename(new_dir)
        except OSError:
            # Collision: append counter
            new_sid = f"{parts[0]}__{form_id}__{parts[2]}_2"
            new_dir = _session_dir(new_sid)
            old_dir.rename(new_dir)
    ctx["session_id"] = new_sid
    # --- Unregistered form detection ---
    if form_id not in REGISTRY:
        form_name = ctx.get("form_name", form_id)
        ctx["original_request"] = ctx["user_request"]
        ctx["pending_form_id"] = form_id
        ctx["mode"] = "new-template"
        ctx["sequence"] = "new-template"
        ctx["step_index"] = 0
        ctx["current_step"] = SEQUENCES["new-template"][0]
        save_ctx(ctx)
        return {
            "action": "missing_template",
            "session_id": ctx["session_id"],
            "form_id": form_id,
            "form_name": form_name,
            "message": (
                f"{form_name} is not yet registered — no template "
                f"exists. I'll guide you through adding one. You'll "
                f"need the official .dotx from LEAP's template library."
            ),
        }
    # --- Template file existence check ---
    form_spec = REGISTRY.get(form_id, {})
    tmpl_path = SKILL_ROOT / form_spec.get("template", "")
    if not tmpl_path.exists():
        save_ctx(ctx)
        return {"action": "halt",
                "error": (f"Registry entry for {form_id} exists but "
                          f"template file missing: {form_spec['template']}")}
    # Form 33's filed-face projection (from /draft) has its own
    # strict markdown assemble path; blank Form 33 remains Generate-only.
    if form_id == "form-33" and result.get("op_id") == "assemble":
        ctx["sequence"] = "asm33"
        ctx["operation"] = "asm33"
        ctx["step_index"] = 0
        ctx["current_step"] = SEQUENCES["asm33"][0]
        save_ctx(ctx)
        return _build_step_action(ctx)
    # Generate-only forms -> generate sequence regardless of other op_ids
    if form_spec.get("generate_only"):
        if form_id == "form-16":
            ctx["service_mode"] = result.get("service_mode", "ordinary")
        ctx["sequence"] = ("generate-subserv"
                           if ctx.get("service_mode") == "substituted"
                           else "generate")
        ctx["operation"] = "generate"
        ctx["step_index"] = 0
        ctx["current_step"] = SEQUENCES[ctx["sequence"]][0]
        save_ctx(ctx)
        return _build_step_action(ctx)
    # Other forms: use the operation classified in the combined pass
    op = result["op_id"]
    ctx["operation"] = op
    seq_key = op if op != "none" else "full"
    ctx["sequence"] = seq_key
    ctx["step_index"] = 0
    ctx["current_step"] = SEQUENCES[seq_key][0]
    save_ctx(ctx)
    return _build_step_action(ctx)


def cmd_step(session_id: str, result_json: str) -> dict:
    """Validate step result, apply, advance or retry."""
    ctx = load_ctx(session_id)
    step_id = ctx["current_step"]
    step = STEPS[step_id]
    result = json.loads(result_json)

    # --- OOW response ---
    if result.get("kind") == "oow_response":
        save_ctx(ctx)
        return {"action": "oow", "session_id": session_id,
                "step_id": step_id,
                "lawyer_question": result.get("lawyer_question", ""),
                "context": result.get("context", "")}

    # --- Subagent requested user input (ask_user sub-loop) ---
    if result.get("kind") == "ask_user" or result.get("needs_input"):
        question = result.get("question", "")
        options = result.get("options", [])
        ctx["step_answers"].append(None)  # placeholder
        save_ctx(ctx)
        return {"action": "ask_user", "session_id": session_id,
                "question": question,
                "options": options, "step_id": step_id}

    # --- User answer routed back ---
    if "user_answer" in result:
        if ctx["step_answers"] and ctx["step_answers"][-1] is None:
            ctx["step_answers"][-1] = result["user_answer"]
        else:
            ctx["step_answers"].append(result["user_answer"])
        save_ctx(ctx)
        prompt = step["build_prompt"](ctx)
        save_ctx(ctx)  # persist any mutations from build_prompt
        return {
            "action": "spawn_subagent",
            "session_id": session_id,
            "step_id": step_id,
            "prompt": prompt,
            "schema": step["response_schema"],
        }

    # --- OOW resolved ---
    if result.get("kind") == "oow_resolved":
        save_ctx(ctx)
        prompt = step["build_prompt"](ctx)
        save_ctx(ctx)  # persist any mutations from build_prompt
        return {
            "action": "spawn_subagent",
            "session_id": session_id,
            "step_id": step_id,
            "prompt": prompt,
            "schema": step["response_schema"],
        }

    # --- Normal step result ---
    # Extract data from envelope if present
    data = result.get("data", result) if result.get("kind") == "step_result" else result

    ok, err = step["validate"](data, ctx)
    if not ok:
        ctx["attempts"] = ctx.get("attempts", 0) + 1
        max_r = step["max_retries"]
        if ctx["attempts"] > max_r:
            save_ctx(ctx)
            return {"action": "halt",
                    "reason": "validation_failure_exhausted",
                    "step_id": step_id, "attempts": ctx["attempts"],
                    "max_retries": max_r, "last_error": err}
        save_ctx(ctx)
        return {"action": "retry", "error": err, "step_id": step_id,
                "attempt": ctx["attempts"],
                "continuation_available": True}

    # Save pre-step snapshot before apply
    save_snapshot(ctx, step_id)

    # Apply
    ctx = step["apply"](ctx, data)
    ctx["step_answers"] = []
    ctx["attempts"] = 0

    # Stay on step if apply() requested it (e.g. pending confirmation)
    if ctx.pop("_stay_on_step", False):
        save_ctx(ctx)
        return _build_step_action(ctx)

    # Run script if defined
    if step["calls_script"]:
        from steps.shared.fingerprint import ManualEdits
        try:
            step["calls_script"](ctx)
        except ManualEdits as e:
            # Nothing was written: the newest copy holds edits the new copy
            # would drop. The caller shows them, carries what the practitioner
            # keeps, abandons this session and inits again with --edits-reviewed.
            save_ctx(ctx)
            return {"action": "manual_edits", "session_id": ctx["session_id"],
                    "step_id": step_id, "copies": e.copies}
        except (RuntimeError, ValueError) as e:
            save_ctx(ctx)
            return {"action": "halt", "reason": "script_failed",
                    "step_id": step_id, "error": str(e)}

    # Advance
    seq = SEQUENCES[ctx["sequence"]]
    ctx["step_index"] += 1
    if ctx["step_index"] >= len(seq):
        # --- Auto-restart after template-addition pivot ---
        if ctx.get("pending_form_id") and ctx["sequence"] == "new-template":
            form_id = ctx["pending_form_id"]
            form_key = ctx.get("form_key", form_id.replace("form-", ""))
            form_name = ctx.get("form_name", form_id)
            entry = {
                "name": form_name,
                "rule": "",
                "template": f"templates/{form_key}.dotx",
                "fill_script": "fill_plain.py",
                "fill_form_arg": form_key,
                "workflow": None,
                "sources_scope": "router_default",
                "generate_only": True,
            }
            _save_custom_registry_entry(form_id, entry)
            ctx["current_step"] = None
            save_ctx(ctx)
            return cmd_reset(ctx["session_id"], ctx["original_request"])

        ctx["current_step"] = None
        save_ctx(ctx)
        result_action = {"action": "done",
                         "output_path": ctx.get("output_path", ""),
                         "session_id": ctx["session_id"]}
        # asm32/asm33 assemble-for-verification result contract: carry the
        # rendered page count, its PDF, and (asm32 only) the assembled tail so
        # the calling application pipeline consumes them from the completion
        # payload rather than rendering or counting anything itself.
        # gen.fill also carries the context.json path, so the practitioner can
        # see where the one handoff to a later asm32 run was written (#1240).
        # An individual form's taken name names the copy passed over (#1324).
        # The verify result rides along: assemble-phase verify warns, never halts.
        fingerprint_error = _record_fingerprints(ctx)
        if fingerprint_error:
            result_action["fingerprint_error"] = fingerprint_error
        # asm32/asm33 carry their warnings and whether the document has a
        # NOT FINAL cover page (assembly-input-contract.md, Publish sidecar).
        for _k in ("page_count", "pdf_path", "tail_text", "compliance_table",
                   "context_path", "versioned_from", "clean_path",
                   "clean_versioned_from", "verify_passed", "verify_warnings",
                   "warnings", "cover", "advisories"):
            if ctx.get(_k) is not None:
                result_action[_k] = ctx[_k]
        # Cleanup session on completion (Section 3.1.3) -- unless the output
        # itself was written inside the session dir (matter_path was empty),
        # in which case cleanup would delete the deliverable.
        output_path = ctx.get("output_path", "")
        in_session_dir = False
        if output_path:
            try:
                session_dir = str(_session_dir(ctx["session_id"]).resolve())
                in_session_dir = str(Path(output_path).resolve()).startswith(
                    session_dir + os.sep)
            except OSError:
                pass
        if in_session_dir:
            result_action["cleanup"] = "skipped — output resides in session dir"
        else:
            cleanup_session(ctx["session_id"])
        return result_action

    ctx["current_step"] = seq[ctx["step_index"]]
    save_ctx(ctx)
    return _build_step_action(ctx)


def _record_fingerprints(ctx: dict) -> str | None:
    """Fingerprint the finished .docx copies, so the next publish can find edits to them.

    Runs at done, after every step that changes the file. The file already
    exists, so a failure is reported in the payload, never a halt.
    """
    copies = [Path(p) for p in (ctx.get("output_path"), ctx.get("clean_path"))
              if p and str(p).lower().endswith(".docx") and Path(p).is_file()]
    if not copies or not ctx.get("matter_path"):
        return None
    try:
        from steps.shared.fingerprint import record
        from steps.shared.paths import _draft_folder, fingerprint_store
        record(fingerprint_store(ctx), _draft_folder(ctx["matter_path"]), copies)
    except Exception as e:  # noqa: BLE001 -- reported in the done payload
        return (f"could not record the fingerprint of {', '.join(p.name for p in copies)}, "
                f"so the next publish cannot check it for edits: {e}")
    return None


def cleanup_session(session_id: str) -> None:
    """Delete session directory on completion."""
    d = _session_dir(session_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


def cmd_list(matter_filter: str = "") -> dict:
    """Return JSON array of active sessions."""
    if not SESSIONS_DIR.exists():
        return []
    sessions = []
    for d in sorted(SESSIONS_DIR.iterdir()):
        ctx_file = d / "ctx.json"
        if not ctx_file.exists():
            continue
        ctx = json.loads(ctx_file.read_bytes().rstrip(b"\x00").decode("utf-8"))
        if matter_filter and ctx.get("matter_id") != matter_filter:
            continue
        seq = ctx.get("sequence")
        total = len(SEQUENCES.get(seq, [])) if seq else 0
        sessions.append({
            "session_id": ctx["session_id"],
            "matter_id": ctx.get("matter_id", ""),
            "form_id": ctx.get("form_id", ""),
            "current_step": ctx.get("current_step"),
            "step_index": ctx.get("step_index", 0),
            "total_steps": total,
            "started": ctx.get("start_ts", ""),
            "last_modified": datetime.fromtimestamp(
                ctx_file.stat().st_mtime, tz=timezone.utc
            ).isoformat(),
        })
    return sessions


def cmd_resume(session_id: str) -> dict:
    """Resume an existing session -- return next action."""
    ctx = load_ctx(session_id)
    if ctx.get("current_step") is None:
        return {"action": "done", "output_path": ctx.get("output_path", ""),
                "session_id": session_id}
    step_id = ctx["current_step"]
    if step_id not in STEPS:
        return {"action": "halt",
                "error": f"Step module not loaded: {step_id}"}
    return _build_step_action(ctx)


def cmd_abandon(session_id: str) -> dict:
    """Delete a session directory."""
    d = _session_dir(session_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    return {"action": "abandoned", "session_id": session_id}


def cmd_reset(session_id: str, new_request: str) -> dict:
    """Re-classify: clear classification, keep session, restart."""
    ctx = load_ctx(session_id)
    # Record stale outputs
    if ctx.get("output_path"):
        ctx["stale_outputs"].append({
            "path": ctx["output_path"],
            "step_id": ctx.get("current_step", ""),
            "produced_at": datetime.now(timezone.utc).isoformat(),
        })
    old_sid = ctx["session_id"]
    # Clear classification and step state
    ctx["user_request"] = new_request
    ctx["form_id"] = None
    ctx["mode"] = None
    ctx["operation"] = None
    ctx["sequence"] = None
    ctx["step_index"] = 0
    ctx["current_step"] = None
    ctx["step_answers"] = []
    ctx["profile"] = None
    ctx["profile_confirmed"] = False
    ctx["scalars"] = None
    ctx["output_path"] = None
    ctx["attempts"] = 0
    ctx.pop("pending_form_id", None)
    ctx.pop("original_request", None)
    ctx.pop("service_mode", None)
    ctx.pop("order_extraction", None)
    # Rename directory back to unclassified
    parts = old_sid.split("__")
    new_sid = f"{parts[0]}__unclassified__{parts[-1]}"
    old_dir = _session_dir(old_sid)
    new_dir = _session_dir(new_sid)
    if old_dir != new_dir and old_dir.exists():
        try:
            old_dir.rename(new_dir)
        except OSError:
            pass  # keep old name if rename fails
        else:
            ctx["session_id"] = new_sid
    save_ctx(ctx)
    # Return the combined classification prompt
    from steps.classify.combined import build_classify_prompt, response_schema
    return {
        "action": "spawn_subagent",
        "prompt": build_classify_prompt(new_request),
        "schema": response_schema,
        "session_id": ctx["session_id"],
        "route_to": "classify",
        "reset_from": old_sid,
        "stale_outputs": ctx["stale_outputs"],
    }


def cmd_clarify(session_id: str, answer: str) -> dict:
    """Re-classify after the ambiguity gate, keeping the original request.

    The answer must not go through `reset` on its own — reset replaces
    user_request wholesale, so "personal" would become the entire request —
    nor through `step`, where current_step is None at classification time.
    """
    ctx = load_ctx(session_id)
    composed = f"{ctx['user_request']} — clarification: {answer}"
    return cmd_reset(session_id, composed)


def cmd_rewind(session_id: str, target_step_id: str) -> dict:
    """Backtrack to a prior step using snapshot."""
    ctx = load_ctx(session_id)
    seq = SEQUENCES.get(ctx.get("sequence", ""), [])
    if target_step_id not in seq:
        return {"action": "halt", "reason": "rewind_invalid",
                "error": f"Cannot rewind to '{target_step_id}': "
                         f"step not in current sequence"}
    target_idx = seq.index(target_step_id)
    if target_idx >= ctx["step_index"]:
        return {"action": "halt", "reason": "rewind_invalid",
                "error": f"Cannot rewind to '{target_step_id}': "
                         f"step not yet completed"}
    # Restore snapshot
    snap = load_snapshot(session_id, target_step_id)
    if snap is None:
        return {"action": "halt", "reason": "rewind_invalid",
                "error": f"No snapshot found for '{target_step_id}'"}
    # Mark stale outputs from target forward
    # (future: track script outputs per step)
    # Delete snapshots from target forward
    warnings = delete_snapshots_from(session_id, seq, target_idx)
    # Restore ctx from snapshot
    ctx = snap
    ctx["step_index"] = target_idx
    ctx["current_step"] = target_step_id
    ctx["step_answers"] = []
    ctx["attempts"] = 0
    save_ctx(ctx)
    action = _build_step_action(ctx)
    if warnings:
        action["warnings"] = warnings
    return action


# ---------------------------------------------------------------------------
# Validate-only entry points (stateless; no session created or touched)
# ---------------------------------------------------------------------------

def _run_validate(parser_fn, path: str) -> None:
    """Hard-validate a Form 32/33 markdown file against the single-owner subset
    parser. Exit 0 on pass; exit 1 printing the exact error on failure. Creates
    no session — this is the pipelines' pre-projection subset gate."""
    try:
        parser_fn(Path(path))
    except (ValueError, OSError) as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    print("valid")
    sys.exit(0)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    # Change working directory to scripts/ so relative imports work
    os.chdir(HERE)
    # Ensure steps/ is importable
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))

    load_all_steps()

    parser = argparse.ArgumentParser(description="v2 harness CLI")
    sub = parser.add_subparsers(dest="command")

    p_init = sub.add_parser("init")
    p_init.add_argument("user_request")
    p_init.add_argument("--matter-path", default="")
    p_init.add_argument("--matter-data-folder", default="")
    p_init.add_argument("--writing-folder", default="")
    p_init.add_argument("--out-name", default="")
    p_init.add_argument("--edits-reviewed", action="store_true")

    p_classify = sub.add_parser("classify")
    p_classify.add_argument("session_id")
    p_classify.add_argument("result_json")

    p_step = sub.add_parser("step")
    p_step.add_argument("session_id")
    p_step.add_argument("result_json")

    p_list = sub.add_parser("list")
    p_list.add_argument("--matter", default="")

    p_resume = sub.add_parser("resume")
    p_resume.add_argument("session_id")

    p_abandon = sub.add_parser("abandon")
    p_abandon.add_argument("session_id")

    p_reset = sub.add_parser("reset")
    p_reset.add_argument("session_id")
    p_reset.add_argument("new_request")

    p_clarify = sub.add_parser("clarify")
    p_clarify.add_argument("session_id")
    p_clarify.add_argument("answer")

    p_rewind = sub.add_parser("rewind")
    p_rewind.add_argument("session_id")
    p_rewind.add_argument("target_step_id")

    p_validate32 = sub.add_parser("validate32")
    p_validate32.add_argument("path")

    p_validate33 = sub.add_parser("validate33")
    p_validate33.add_argument("path")

    args = parser.parse_args()

    if args.command == "validate32":
        from steps.asm32.common import parse_form32
        _run_validate(parse_form32, args.path)
    elif args.command == "validate33":
        from steps.asm33.common import parse_form33
        _run_validate(parse_form33, args.path)
    elif args.command == "init":
        _emit(cmd_init(args.user_request, args.matter_path,
                       args.matter_data_folder, args.writing_folder,
                       args.out_name, args.edits_reviewed))
    elif args.command == "classify":
        _emit(cmd_classify(args.session_id, args.result_json))
    elif args.command == "step":
        _emit(cmd_step(args.session_id, args.result_json))
    elif args.command == "list":
        _emit(cmd_list(args.matter))
    elif args.command == "resume":
        _emit(cmd_resume(args.session_id))
    elif args.command == "abandon":
        _emit(cmd_abandon(args.session_id))
    elif args.command == "reset":
        _emit(cmd_reset(args.session_id, args.new_request))
    elif args.command == "clarify":
        _emit(cmd_clarify(args.session_id, args.answer))
    elif args.command == "rewind":
        _emit(cmd_rewind(args.session_id, args.target_step_id))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
