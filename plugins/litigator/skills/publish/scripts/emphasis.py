"""The one markdown inline-emphasis parser of the Python writers: /publish's .docx fill scripts
(through docx_helpers) and /draft's write_eml.py. Standard library only, so write_eml.py can load it.
"""
from __future__ import annotations

# The characters a backslash makes literal.
_ESCAPABLE = '\\*_`#>-'


def emphasis_runs(text: str) -> list[tuple[str, bool, bool]]:
    """Markdown inline emphasis as (text, bold, italic) runs.

    `**` toggles bold; `*` or `_` toggles italic at a word edge; a backslash makes the
    next markup character literal. This is the rule of inlineRuns in
    source/lawyer/mcp/src/correspondence/docx.ts, with two safeguards: a marker still
    open at the end of the text prints as itself, and an `_` beside another `_` is
    literal, so a stray asterisk or a blank line `____` keeps its characters.
    """
    runs: list[tuple[str, bool, bool]] = []
    bold = italic = False
    opened = {}  # 'bold' / 'italic' -> where its last marker stands
    buf = ''
    i = 0
    while i < len(text):
        c = text[i]
        prev = text[i - 1] if i else ' '
        nxt = text[i + 1] if i + 1 < len(text) else ' '
        if c == '\\' and i + 1 < len(text) and nxt in _ESCAPABLE:
            buf += nxt
            i += 2
            continue
        marker = None
        if c == '*' and nxt == '*':
            marker = 'bold'
        elif c in '*_' and not (c == '_' and '_' in (prev, nxt)):
            opens = not italic and not nxt.isspace() and (c == '*' or not prev.isalnum())
            closes = italic and not prev.isspace() and (c == '*' or not nxt.isalnum())
            if opens or closes:
                marker = 'italic'
        if marker is None:
            buf += c
            i += 1
            continue
        if buf:
            runs.append((buf, bold, italic))
        buf = ''
        opened[marker] = i
        if marker == 'bold':
            bold = not bold
            i += 2
        else:
            italic = not italic
            i += 1
    if buf:
        runs.append((buf, bold, italic))
    if bold or italic:
        at = opened['bold' if bold else 'italic']
        width = 2 if bold else 1
        return emphasis_runs(text[:at] + '\\' + '\\'.join(text[at:at + width]) + text[at + width:])
    return runs
