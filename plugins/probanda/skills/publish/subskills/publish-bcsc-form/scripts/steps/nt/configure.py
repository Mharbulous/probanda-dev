"""nt.configure -- Configure FORM_CONFIGS for a new form type.

Builds the alias_map, disambiguation, leave_blank, and numid_fixes
for convert.py's FORM_CONFIGS dict. The subagent proposes the config;
calls_script appends it to convert.py.

This is the only step that writes to a production script file.
"""
from __future__ import annotations

import json
from pathlib import Path

from steps.nt.inspect_tmpl import _extract_alias_containers, _format_containers

SCRIPTS = Path(__file__).resolve().parent.parent.parent  # scripts/
CONVERT_SCRIPT = SCRIPTS / "convert.py"

max_retries = 3

response_schema = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["step_result", "ask_user"]},
        "data": {
            "type": "object",
            "properties": {
                "alias_map": {
                    "type": "object",
                    "additionalProperties": {"type": "string"},
                },
                "disambiguation": {"type": "object"},
                "leave_blank": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "numid_fixes": {
                    "type": "object",
                    "additionalProperties": {"type": "integer"},
                },
                "allow_repeated": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": ["alias_map", "leave_blank"],
        },
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["kind"],
}


def precondition(ctx: dict) -> tuple[bool, str]:
    if not ctx.get("sdt_aliases"):
        return False, "SDT aliases must be extracted before configuring"
    if not ctx.get("form_key"):
        return False, "Form key must be set before configuring"
    # The container check reads nesting from the raw file, never from model
    # output, so without the path it would silently pass everything.
    if not ctx.get("raw_docx_path"):
        return False, ("Raw .docx path must be in the context before "
                       "configuring: the container-alias check reads nesting "
                       "from the raw file")
    return True, ""


def build_prompt(ctx: dict) -> str:
    aliases = ctx.get("sdt_aliases", [])
    placeholders = ctx.get("existing_placeholders", [])
    form_key = ctx.get("form_key", "")
    answers = ctx.get("step_answers", [])

    # Read existing FORM_CONFIGS keys for reference
    existing_keys = []
    try:
        text = CONVERT_SCRIPT.read_text(encoding="utf-8")
        import re
        for m in re.finditer(r"'(\w+)':\s*\{", text):
            if m.group(1) not in existing_keys:
                existing_keys.append(m.group(1))
    except OSError:
        pass

    containers = _extract_alias_containers(ctx.get("raw_docx_path", ""))
    container_list = _format_containers(containers)

    alias_list = "\n".join(f"  - `{a}`" for a in aliases)
    ph_list = "\n".join(f"  - `{p}`" for p in sorted(set(placeholders)))

    # Show existing form configs as examples
    existing_text = ", ".join(f"`{k}`" for k in existing_keys) if existing_keys else "(none)"

    return f"""You are a template configuration agent for a BC Supreme Court form drafting system.

Build the FORM_CONFIGS entry for a new form type based on the SDT alias inventory below.

## Form Key
`{form_key}`

## SDT Aliases Found
{alias_list}

## Container Aliases -- LEAVE THESE OUT OF alias_map
{container_list}

Each alias listed above wraps the aliases named beside it. The converter
overwrites a mapped control's text, which blanks every nested token and
deletes the paragraphs holding them, so mapping a container silently
destroys the fields inside it. Map the nested aliases, never the container.
A configuration that maps a container together with any alias it wraps is
rejected.

## Existing Bracket Placeholders (already in the raw document)
{ph_list if ph_list else "(none)"}

## Existing Form Configs (for reference)
{existing_text}

## Configuration Fields

1. **alias_map** (required): Maps each SDT alias to a bracket placeholder name.
   - Every SDT alias that should become a bracket placeholder must be included.
   - Missing aliases pass through as unwrapped plain text (which may be wrong).
   - Use UPPERCASE bracket names like `[COURT FILE NUMBER]`, `[REGISTRY]`, etc.
   - Follow existing naming conventions from other form configs.

2. **disambiguation** (optional): Rules for placeholders that appear more than once.
   - Each entry is a placeholder name mapping to a list of rules.
   - Rules have either `context_contains` + `rename_to`, or `default_rename`.
   - Example: `{{"[date]": [{{"context_contains": "TAKE NOTICE", "rename_to": "[date]"}}, {{"default_rename": "[judge-date]"}}]}}`

3. **leave_blank** (required): Placeholders the lawyer fills in Word, not programmatically.
   - Always include `[mmmm d, yyyy]` (standard date placeholder).
   - Include any date/time/name fields the court clerk fills in.

4. **numid_fixes** (optional): Paragraph text prefix -> target numId corrections.
   - Only needed if numbered list numbering is wrong in the raw export.

5. **allow_repeated** (optional): Placeholders that legitimately appear multiple times with the same value.

## Instructions
Propose a complete configuration. For each SDT alias, decide:
- If it maps to case data (file number, registry, party names): add to alias_map.
- If it is a court/clerk field (date, judge name): add to alias_map AND leave_blank.
- If it appears multiple times with different meanings: add disambiguation rules.
- If it appears multiple times with the same meaning: add to allow_repeated.

Return:
{{"kind": "step_result", "data": {{"alias_map": {{...}}, "disambiguation": {{...}}, "leave_blank": [...], "numid_fixes": {{...}}, "allow_repeated": [...]}}}}

## Constraints
- Return ONLY the JSON object specified above. Do not call Read, Bash, Grep, Glob, or any file-access tools.
- All information you need is provided in this prompt."""


def validate(result: dict, ctx: dict) -> tuple[bool, str]:
    alias_map = result.get("alias_map", {})
    if not alias_map:
        return False, "alias_map must not be empty"

    # Reject container aliases mapped alongside the aliases they wrap.
    # Nesting comes from the raw file, never from the proposed map.
    raw_path = ctx.get("raw_docx_path")
    if not raw_path:
        return False, ("Cannot check for container aliases: 'raw_docx_path' "
                       "is missing from the context")
    offenders = []
    for container, nested in _extract_alias_containers(raw_path).items():
        if container not in alias_map:
            continue
        mapped_nested = [n for n in nested if n in alias_map]
        if mapped_nested:
            offenders.append(
                f"'{container}' wraps " +
                ", ".join(f"'{n}'" for n in mapped_nested))
    if offenders:
        return False, (
            "alias_map maps container alias(es) together with the aliases "
            "they wrap: " + "; ".join(offenders) + ". Mapping a container "
            "erases the nested tokens at conversion time. Leave the "
            "container out of alias_map and keep the nested aliases.")

    # Check all alias_map values are bracket placeholders
    for alias, placeholder in alias_map.items():
        if not placeholder.startswith("[") or not placeholder.endswith("]"):
            return False, (f"alias_map value for '{alias}' must be a bracket "
                           f"placeholder: got '{placeholder}'")

    leave_blank = result.get("leave_blank", [])
    for lb in leave_blank:
        if not lb.startswith("[") or not lb.endswith("]"):
            return False, (f"leave_blank entry must be a bracket placeholder: "
                           f"got '{lb}'")

    # Check disambiguation rules structure
    disambiguation = result.get("disambiguation", {})
    for ph, rules in disambiguation.items():
        if not isinstance(rules, list):
            return False, (f"disambiguation['{ph}'] must be a list of rules, "
                           f"got {type(rules).__name__}")
        has_default = False
        for rule in rules:
            if "default_rename" in rule:
                has_default = True
            elif "context_contains" not in rule or "rename_to" not in rule:
                return False, (f"disambiguation['{ph}']: each rule must have "
                               f"either 'context_contains'+'rename_to' or "
                               f"'default_rename'")
        if not has_default and len(rules) > 0:
            return False, (f"disambiguation['{ph}']: must include a "
                           f"'default_rename' rule as fallback")

    # Check for contradictions: disambiguation + allow_repeated
    allow_repeated = set(result.get("allow_repeated", []))
    for ph in disambiguation:
        if ph in allow_repeated:
            return False, (f"'{ph}' cannot be in both 'disambiguation' and "
                           f"'allow_repeated' — disambiguation renames duplicates "
                           f"while allow_repeated permits them")

    return True, ""


def apply(ctx: dict, result: dict) -> dict:
    ctx["nt_config"] = {
        "alias_map": result["alias_map"],
        "disambiguation": result.get("disambiguation", {}),
        "leave_blank": result.get("leave_blank", []),
        "numid_fixes": result.get("numid_fixes", {}),
        "allow_repeated": result.get("allow_repeated", []),
    }
    return ctx


def calls_script(ctx: dict) -> None:
    """Append the new FORM_CONFIGS entry to convert.py.

    This is the only step that modifies a production script file.
    """
    config = ctx["nt_config"]
    form_key = ctx["form_key"]

    # Read current convert.py
    text = CONVERT_SCRIPT.read_text(encoding="utf-8")

    # Check if form_key already exists
    if f"'{form_key}':" in text:
        raise RuntimeError(
            f"FORM_CONFIGS already contains key '{form_key}'. "
            f"To update an existing config, edit convert.py manually.")

    # Build the config dict variables
    upper_key = form_key.upper()
    alias_var = f"{upper_key}_ALIAS_MAP"
    disambig_var = f"{upper_key}_DISAMBIGUATION"
    leave_var = f"{upper_key}_LEAVE_BLANK"
    numid_var = f"{upper_key}_NUMID_FIXES"

    lines = []
    lines.append(f"\n# ---------------------------------------------------------------------------")
    lines.append(f"# {form_key.title()} configuration (auto-generated by nt.configure)")
    lines.append(f"# ---------------------------------------------------------------------------")
    lines.append(f"")

    # Alias map
    lines.append(f"{alias_var} = {{")
    for alias, placeholder in config["alias_map"].items():
        lines.append(f"    {alias!r}: {placeholder!r},")
    lines.append(f"}}")
    lines.append(f"")

    # Disambiguation
    lines.append(f"{disambig_var} = {json.dumps(config['disambiguation'], indent=4)}")
    lines.append(f"")

    # Leave blank
    lb_items = ", ".join(repr(x) for x in config["leave_blank"])
    lines.append(f"{leave_var} = {{{lb_items}}}")
    lines.append(f"")

    # NumId fixes
    lines.append(f"{numid_var} = {json.dumps(config['numid_fixes'])}")
    lines.append(f"")

    config_block = "\n".join(lines)

    # Find the FORM_CONFIGS dict and add entry before the closing }
    # Insert the variable definitions before FORM_CONFIGS
    form_configs_marker = "FORM_CONFIGS = {"
    marker_pos = text.find(form_configs_marker)
    if marker_pos == -1:
        raise RuntimeError("Could not find FORM_CONFIGS = { in convert.py")

    # Insert variable definitions before FORM_CONFIGS
    text = text[:marker_pos] + config_block + "\n" + text[marker_pos:]

    # Now add the entry to FORM_CONFIGS dict
    # Find the closing } of FORM_CONFIGS (last } before next section)
    new_marker_pos = text.find(form_configs_marker)
    closing_brace = text.rfind("}", new_marker_pos,
                                text.find("\n# ---", new_marker_pos + 100))
    if closing_brace == -1:
        # Fallback: find the } that closes FORM_CONFIGS
        import re
        m = re.search(r'^}', text[new_marker_pos:], re.MULTILINE)
        if m:
            closing_brace = new_marker_pos + m.start()
        else:
            raise RuntimeError("Could not find closing } of FORM_CONFIGS")

    # Build entry
    entry_parts = [
        f"    '{form_key}': {{",
        f"        'alias_map': {alias_var},",
        f"        'disambiguation': {disambig_var},",
        f"        'leave_blank': {leave_var},",
        f"        'numid_fixes': {numid_var},",
    ]
    if config.get("allow_repeated"):
        ar_var = f"{upper_key}_ALLOW_REPEATED"
        # Add allow_repeated variable definition
        ar_items = ", ".join(repr(x) for x in config["allow_repeated"])
        extra_def = f"\n{ar_var} = {{{ar_items}}}\n"
        # Insert before the config_block we already added
        text = text.replace(config_block,
                            config_block + extra_def)
        entry_parts.append(f"        'allow_repeated': {ar_var},")
    entry_parts.append(f"    }},")

    entry_text = "\n".join(entry_parts)

    # Insert before the closing brace
    # Recalculate closing_brace position after text modifications
    new_marker_pos = text.find(form_configs_marker)
    import re
    m = re.search(r'^}', text[new_marker_pos:], re.MULTILINE)
    if m:
        closing_brace = new_marker_pos + m.start()
    else:
        raise RuntimeError("Could not find closing } of FORM_CONFIGS after modifications")

    text = text[:closing_brace] + entry_text + "\n" + text[closing_brace:]

    CONVERT_SCRIPT.write_text(text, encoding="utf-8")
    ctx["convert_py_modified"] = True
