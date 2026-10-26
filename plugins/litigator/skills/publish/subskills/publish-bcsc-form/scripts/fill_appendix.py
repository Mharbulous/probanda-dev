"""Tick Form 32's Appendix boxes (B.C. Reg. 105/2026) for an asm32 fill."""
from __future__ import annotations

from fill_ooxml import WN

UNCHECKED, CHECKED = '☐', '☒'
NONE_OF_THE_ABOVE = 'none of the above'


def mark_appendix_boxes(body, types: list[str]) -> None:
    """Check each Appendix box whose label is in `types`; an empty list checks
    "none of the above". A box paragraph is the template's: a run holding the
    box alone, then the label."""
    wanted = set(types) or {NONE_OF_THE_ABOVE}
    for para in body.iter(WN('p')):
        texts = list(para.iter(WN('t')))
        if len(texts) < 2 or texts[0].text != UNCHECKED:
            continue
        if ''.join(t.text or '' for t in texts[1:]) in wanted:
            texts[0].text = CHECKED
