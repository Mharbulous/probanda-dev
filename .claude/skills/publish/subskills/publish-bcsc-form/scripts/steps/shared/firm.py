"""Firm details for the address-for-service block on Forms 1 and 4.

The firm's address, e-mail and fax are firm-wide constants, not matter data,
so they live beside the other device-level settings in the Roaming
probanda.json (legacy name coclerk.json) that /practice-data documents. Reading them here keeps the
practitioner from retyping the same three values on every filing.
"""
from __future__ import annotations

import json
import os
from pathlib import Path


def config_path() -> Path:
    """Locate the settings file the MCP runtime reads (mcp/src/config-path.ts): the
    file COCLERK_CONFIG_PATH names when set, which must exist, else the Roaming
    probanda.json when it exists, else the legacy coclerk.json."""
    override = os.environ.get('COCLERK_CONFIG_PATH')
    if override:
        if not Path(override).is_file():
            raise RuntimeError(f'COCLERK_CONFIG_PATH names {override}, which does not exist. '
                               'Create it, or unset the variable to read the live probanda.json.')
        return Path(override)
    app_data = os.environ.get('APPDATA') or Path.home() / 'AppData' / 'Roaming'
    folder = Path(app_data) / 'Coclerk'
    current = folder / 'probanda.json'
    legacy = folder / 'coclerk.json'
    return current if current.is_file() or not legacy.is_file() else legacy


def firm_context_fields() -> dict[str, str]:
    """Return the three firm_* context keys, or {} when the block is absent.

    An absent block is not an error here: only Forms 1 and 4 carry the
    address-for-service placeholders, so the caller decides whether its form
    needs them. A present block with an empty value is a deliberate blank --
    a firm with no fax -- and comes back as the empty string.
    """
    path = config_path()
    if not path.exists():
        return {}
    try:
        config = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as err:
        raise RuntimeError(f'{path} is not valid JSON: {err}') from err
    firm = config.get('firm')
    if not isinstance(firm, dict):
        return {}
    return {f'firm_{key}': str(firm.get(key, '') or '')
            for key in ('address', 'email', 'fax')}
