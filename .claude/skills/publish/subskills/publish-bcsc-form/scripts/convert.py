"""Convert a raw LEAP-exported .docx (or SDT canonical .dotx) to a bracket-placeholder .dotx.

Single-stage replacement for the two-stage SDT pipeline (convert/run.py → simplify.py).
Merges SDT unwrapping, split-run fixing, numId correction, mc:Ignorable sanitization,
and context-based duplicate placeholder disambiguation.

Usage:
    python convert.py <raw.docx> <output.dotx> [--form noa]
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path

from zip_repair import readable_zip

from lxml import etree

# ---------------------------------------------------------------------------
# Namespace helpers
# ---------------------------------------------------------------------------

NS = {
    'w':   'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
    'w15': 'http://schemas.microsoft.com/office/word/2012/wordml',
    'mc':  'http://schemas.openxmlformats.org/markup-compatibility/2006',
}

def W(t: str) -> str:
    return f"{{{NS['w']}}}{t}"

XMLSPACE = '{http://www.w3.org/XML/1998/namespace}space'
PLACEHOLDER_RX = re.compile(r'\[[^\]]{1,60}\]')

# ---------------------------------------------------------------------------
# Form-specific configuration
# ---------------------------------------------------------------------------

NOA_ALIAS_MAP = {
    'COURT_DETAILS.File_number_use_on_form': '[COURT FILE NUMBER]',
    'COURT_DETAILS.Registry':                '[REGISTRY]',
    'COURT_DETAILS.Caption_originating_par': '[PLAINTIFF / PETITIONER NAME(S)]',
    'COURT_DETAILS.Originating_party':       '[PLAINTIFF]',
    'COURT_DETAILS.Caption_responding_part': '[DEFENDANT / RESPONDENT NAME(S)]',
    'COURT_DETAILS.Responding_party':        '[DEFENDANT]',
    'f_FiledByNames':                        '[APPLICANT NAME(S)]',
    'f_ToAffectedPartiesNames':              '[TO AFFECTED PARTIES]',
    'f_CourtLocation':                       '[COURT ADDRESS \u2014 e.g. 800 Smithe Street, Vancouver, BC V6Z 2E1]',
    'CLIENT.File_name_multi':                '[CLIENT NAME]',
    'MATTER.Person_Acting_full_name':        '[LAWYER NAME]',
}

NOA_DISAMBIGUATION = {
    '[date]': [
        # Keep [date] in the TAKE NOTICE paragraph (hearing date)
        {'context_contains': 'TAKE NOTICE', 'rename_to': '[date]'},
        # Rename all other [date] to [judge-date] (court-only, leave-blank)
        {'default_rename': '[judge-date]'},
    ],
}

NOA_LEAVE_BLANK = {'[mmmm d, yyyy]', '[number]', '[judge-date]'}

# numId fixes: paragraph text prefix → target numId
# Part 3 raw template uses numId=4 (restarts at 1), should be numId=2 (continues from Part 2)
NOA_NUMID_FIXES = {
    '[Using paragraphs numbered sequentially from Part 2': 2,
}

# ---------------------------------------------------------------------------
# Petition to the Court (Form 66) configuration
# ---------------------------------------------------------------------------

PETITION_ALIAS_MAP = {
    'COURT_DETAILS.File_number_use_on_form': '[COURT FILE NUMBER]',
    'COURT_DETAILS.Registry':                '[REGISTRY]',
    'COURT_DETAILS.Caption_originating_par': '[PETITIONER NAME(S)]',
    'COURT_DETAILS.Originating_party':       '[PETITIONER]',
    'COURT_DETAILS.Caption_responding_part': '[RESPONDENT NAME(S)]',
    'COURT_DETAILS.Responding_party':        '[RESPONDENT]',
    'RPT fullNameAndAddressInFullDown':       '[RESPONDENT NAME AND ADDRESS]',
    'f_CourtLocation':                       '[COURT ADDRESS \u2014 e.g. 800 Smithe Street, Vancouver, BC V6Z 2E1]',
    'f_ProceedingBrought':                   '[PROCEEDING BROUGHT BY]',
    'CLIENT.Street_address_down':            '[CLIENT ADDRESS]',
    'CLIENT.Fax_number':                     '[CLIENT FAX]',
    'CLIENT.E_Mail_Address':                 '[CLIENT EMAIL]',
    'FIRM_DETAILS.Firm_det_in_full_in_per':  '[LAWYER DETAILS]',
    'CLIENT.File_name':                      '[CLIENT NAME]',
    'matter.personActingFullName':            '[LAWYER NAME]',
}

PETITION_DISAMBIGUATION = {
    '[date]': [
        # Keep [date] in Part 4 affidavit paragraph (lawyer fills in Word)
        {'context_contains': 'Affidavit', 'rename_to': '[date]'},
        # Rename all other [date] to [judge-date] (court-only, leave-blank)
        {'default_rename': '[judge-date]'},
    ],
}

PETITION_LEAVE_BLANK = {'[mmmm d, yyyy]', '[judge-date]', '[date]', '[time estimate]'}

# Part 3 instruction paragraph has no numPr at all — add numId=20 (same as Part 2)
# so filled content continues numbering from Part 2
PETITION_NUMID_FIXES = {
    '[Using paragraphs numbered sequentially from Part 2': 20,
}

# ---------------------------------------------------------------------------
# Offer to Settle Costs configuration
# ---------------------------------------------------------------------------

OTS_ALIAS_MAP = {
    'COURT_DETAILS.File_number_use_on_form': '[COURT FILE NUMBER]',
    'COURT_DETAILS.Registry':                '[REGISTRY]',
    'COURT_DETAILS.Caption_originating_par': '[PLAINTIFF / PETITIONER NAME(S)]',
    'COURT_DETAILS.Originating_party':       '[PLAINTIFF]',
    'COURT_DETAILS.Caption_responding_part': '[DEFENDANT / RESPONDENT NAME(S)]',
    'COURT_DETAILS.Responding_party':        '[DEFENDANT]',
    'f_AddressedTo':                         '[PARTY(IES)]',
    'CLIENT.File_name_multi':               '[CLIENT NAME]',
    'MATTER.Person_Acting_full_name':        '[LAWYER NAME]',
}

# No disambiguation needed — only duplicate is [PARTY(IES)] which is leave-blank
OTS_DISAMBIGUATION = {}

OTS_LEAVE_BLANK = {'[mmmm d, yyyy]', '[PARTY(IES)]', '[amount]', '[type or print name]'}

OTS_NUMID_FIXES = {}  # No numbered lists


# ---------------------------------------------------------------------------
# Response to Counterclaim configuration
# ---------------------------------------------------------------------------

RTC_ALIAS_MAP = {
    'COURT_DETAILS.File_number_use_on_form': '[COURT FILE NUMBER]',
    'COURT_DETAILS.Registry':                '[REGISTRY]',
    'COURT_DETAILS.Caption_originating_par': '[PLAINTIFF / PETITIONER NAME(S)]',
    'COURT_DETAILS.Originating_party':       '[PLAINTIFF]',
    'COURT_DETAILS.Caption_responding_part': '[DEFENDANT / RESPONDENT NAME(S)]',
    'COURT_DETAILS.Responding_party':        '[DEFENDANT]',
    'f_FiledByNames':                        '[RESPONDING PARTY NAME(S)]',
    'FIRM_DETAILS.Street_address':           '[FIRM ADDRESS]',
    'FIRM_DETAILS.Fax':                      '[FIRM FAX]',
    'FIRM_DETAILS.Person_acting_or_firm_e':  '[FIRM EMAIL]',
    'CLIENT.File_name_multi':                '[CLIENT NAME]',
    'MATTER.Person_Acting_full_name':        '[LAWYER NAME]',
}

RTC_DISAMBIGUATION = {}
RTC_LEAVE_BLANK = {'[mmmm d, yyyy]'}
RTC_NUMID_FIXES = {}

# ---------------------------------------------------------------------------
# Affidavit configuration
#
# templates/affidavit.dotx is hand-maintained and NOT regenerable by this
# script; see forms/109-AFF/style-guide.md, "Template provenance".
# ---------------------------------------------------------------------------

AFFIDAVIT_ALIAS_MAP = {
    'COURT_DETAILS.File_number_use_on_form': '[COURT FILE NUMBER]',
    'COURT_DETAILS.Registry':                '[REGISTRY]',
    'COURT_DETAILS.Caption_originating_par': '[PLAINTIFF / PETITIONER NAME(S)]',
    'COURT_DETAILS.Originating_party':       '[PLAINTIFF]',
    'COURT_DETAILS.Caption_responding_part': '[DEFENDANT / RESPONDENT NAME(S)]',
    'COURT_DETAILS.Responding_party':        '[DEFENDANT]',
    'f_DeponentPrint':                       '[DEPONENT NAME]',
    'f_DeponentAddress':                     '[DEPONENT ADDRESS]',
    'f_DeponentOccupation':                  '[DEPONENT OCCUPATION]',
    'f_SwearOrAffirm':                       '[swear or affirm]',
    'q_SwornOrAffirmed':                     '[SWORN OR AFFIRMED]',
    'q_SwornOrAffirmedDate':                 '[date]',
    'COMMISSIONER.Address_Town_City':        '[COMMISSIONER CITY]',
    'f_CommissionerName':                    '[COMMISSIONER NAME]',
}

# No disambiguation needed — all duplicates are handled via allow_repeated.
AFFIDAVIT_DISAMBIGUATION = {}

AFFIDAVIT_LEAVE_BLANK = {'[mmmm d, yyyy]', '[language(s)]', '[name]', '[address]', '[occupation]'}

AFFIDAVIT_NUMID_FIXES = {}

# Repeat counts below describe what this script emits from a LEAP export:
# f_DeponentPrint       → [DEPONENT NAME]    appears 3x: header ordinal, body intro, jurat signature
# f_SwearOrAffirm       → [swear or affirm]  appears 5x: body verb, jurat, interpreter section
# q_SwornOrAffirmedDate → [date]             appears 2x: header date + jurat date (always the same)
# [REGISTRY]                                 in allow_repeated as precaution (standard caption)
AFFIDAVIT_ALLOW_REPEATED = {
    '[DEPONENT NAME]',
    '[swear or affirm]',
    '[SWORN OR AFFIRMED]',
    '[date]',
    '[REGISTRY]',
    '[language(s)]',   # appears 3x in interpreter endorsement section
}

# ---------------------------------------------------------------------------
# Notice of Civil Claim (Form 1) configuration
# ---------------------------------------------------------------------------

NOCC_ALIAS_MAP = {
    'COURT_DETAILS.File_number_use_on_form': '[COURT FILE NUMBER]',
    'COURT_DETAILS.Registry':                '[REGISTRY]',
    'COURT_DETAILS.Caption_originating_par': '[PLAINTIFF NAME(S)]',
    'COURT_DETAILS.Caption_responding_part': '[DEFENDANT NAME(S)]',
    # Originating_party / Responding_party NOT mapped — role labels
    # ("PLAINTIFF", "Plaintiff", "DEFENDANTS") stay as unwrapped text.
    # Form 1 always uses Plaintiff/Defendant; casing varies by position.
    'DEFENDANT.Registered_Office_Stree':     '[DEFENDANT 1 ADDRESS]',
    'DEFENDANT2._Full_name':                 '[DEFENDANT 2 NAME]',
    'DEFENDANT2.Registered_Office_Stree':    '[DEFENDANT 2 ADDRESS]',
    'FIRM_DETAILS.Street_address':           '[FIRM ADDRESS]',
    'FIRM_DETAILS.Fax':                      '[FIRM FAX]',
    'FIRM_DETAILS.Person_acting_or_firm_e':  '[FIRM EMAIL]',
    'f_CourtLocation':                       '[COURT ADDRESS \u2014 e.g. 800 Smithe Street, Vancouver, BC V6Z 2E1]',
    'MATTER.Person_Acting_full_name':        '[LAWYER NAME]',
}

NOCC_DISAMBIGUATION = {}

NOCC_LEAVE_BLANK = {'[mmmm d, yyyy]', '[date]'}

NOCC_NUMID_FIXES = {}

# Placeholders that legitimately appear multiple times with the same value.
# Excluded from duplicate checking but filled programmatically (unlike leave_blank).
NOCC_ALLOW_REPEATED = {'[REGISTRY]', '[DEFENDANT 2 NAME]'}


# ---------------------------------------------------------------------------
# Form-33 configuration (auto-generated by nt.configure)
# ---------------------------------------------------------------------------

FORM_33_ALIAS_MAP = {
    'c_2InchMargin': '[2-INCH MARGIN]',
    'COURT_DETAILS.File_number_use_on_form': '[COURT FILE NUMBER]',
    'COURT_DETAILS.Registry': '[REGISTRY]',
    'c_InTheMatterOf': '[IN THE MATTER OF]',
    # 'c_Heading' is deliberately absent: it is the container for the whole
    # style of cause and wraps the four COURT_DETAILS caption aliases below.
    # Mapping a container erases its nested tokens (see unwrap_sdts).
    'COURT_DETAILS.Caption_originating_par': '[CAPTION ORIGINATING PARTY]',
    'COURT_DETAILS.Originating_party': '[ORIGINATING PARTY]',
    'COURT_DETAILS.Caption_responding_part': '[CAPTION RESPONDING PARTY]',
    'COURT_DETAILS.Responding_party': '[RESPONDING PARTY]',
    'c_FastTrack': '[FAST TRACK]',
    'c_ClassAction': '[CLASS ACTION]',
    'CLIENT.Full_name_multi': '[CLIENT FULL NAME]',
    'OTHER_SIDE.Full_name_multi': '[OTHER SIDE FULL NAME]',
    'c_ServiceCheck': '[SERVICE CHECK]',
    'CLIENT.File_name_multi': '[CLIENT FILE NAME]',
    'matter.personActingFullName': '[PERSON ACTING FULL NAME]',
}

FORM_33_DISAMBIGUATION = {
    "[date]": [
        {
            "context_contains": "sworn",
            "rename_to": "[sworn-date]"
        },
        {
            "context_contains": "affirmed",
            "rename_to": "[affirmed-date]"
        },
        {
            "default_rename": "[date]"
        }
    ]
}

FORM_33_LEAVE_BLANK = {'[mmmm d, yyyy]', '[date]', '[sworn-date]', '[affirmed-date]', '[name]', '[time estimate]', '[list paragraph numbers]', '[sequential number, if any, record in the top right hand corner of the affidavit]', '[set out paragraph numbers and any proposed terms]'}

FORM_33_NUMID_FIXES = {}

FORM_33_ALLOW_REPEATED = {'[COURT FILE NUMBER]', '[REGISTRY]', '[ORIGINATING PARTY]', '[RESPONDING PARTY]', '[CLIENT FULL NAME]', '[OTHER SIDE FULL NAME]'}

FORM_CONFIGS = {
    'noa': {
        'alias_map': NOA_ALIAS_MAP,
        'disambiguation': NOA_DISAMBIGUATION,
        'leave_blank': NOA_LEAVE_BLANK,
        'numid_fixes': NOA_NUMID_FIXES,
    },
    'petition': {
        'alias_map': PETITION_ALIAS_MAP,
        'disambiguation': PETITION_DISAMBIGUATION,
        'leave_blank': PETITION_LEAVE_BLANK,
        'numid_fixes': PETITION_NUMID_FIXES,
    },
    'otsc': {
        'alias_map': OTS_ALIAS_MAP,
        'disambiguation': OTS_DISAMBIGUATION,
        'leave_blank': OTS_LEAVE_BLANK,
        'numid_fixes': OTS_NUMID_FIXES,
    },
    'rtc': {
        'alias_map': RTC_ALIAS_MAP,
        'disambiguation': RTC_DISAMBIGUATION,
        'leave_blank': RTC_LEAVE_BLANK,
        'numid_fixes': RTC_NUMID_FIXES,
    },
    'nocc': {
        'alias_map': NOCC_ALIAS_MAP,
        'disambiguation': NOCC_DISAMBIGUATION,
        'leave_blank': NOCC_LEAVE_BLANK,
        'numid_fixes': NOCC_NUMID_FIXES,
        'allow_repeated': NOCC_ALLOW_REPEATED,
    },
    'affidavit': {
        'alias_map': AFFIDAVIT_ALIAS_MAP,
        'disambiguation': AFFIDAVIT_DISAMBIGUATION,
        'leave_blank': AFFIDAVIT_LEAVE_BLANK,
        'numid_fixes': AFFIDAVIT_NUMID_FIXES,
        'allow_repeated': AFFIDAVIT_ALLOW_REPEATED,
    },
    'form-33': {
        'alias_map': FORM_33_ALIAS_MAP,
        'disambiguation': FORM_33_DISAMBIGUATION,
        'leave_blank': FORM_33_LEAVE_BLANK,
        'numid_fixes': FORM_33_NUMID_FIXES,
        'allow_repeated': FORM_33_ALLOW_REPEATED,
    },
}

# ---------------------------------------------------------------------------
# Phase 1: Unwrap SDTs
# ---------------------------------------------------------------------------

def _overwrite_text(content: etree._Element, new_text: str) -> None:
    """Replace all visible text inside an sdtContent with new_text."""
    runs = list(content.iter(W('r')))
    first_t = None
    for r in runs:
        t = r.find(W('t'))
        if t is not None:
            first_t = t
            break

    if first_t is None:
        r = etree.SubElement(content, W('r'))
        t = etree.SubElement(r, W('t'))
        t.text = new_text
        if new_text != new_text.strip() or '  ' in new_text:
            t.set(XMLSPACE, 'preserve')
        return

    first_t.text = new_text
    if new_text != new_text.strip() or '  ' in new_text:
        first_t.set(XMLSPACE, 'preserve')

    for t in content.iter(W('t')):
        if t is first_t:
            continue
        t.text = ''


def _sdt_alias(sdt: etree._Element) -> str | None:
    """The w:alias value of an SDT, or None if it carries no alias."""
    pr = sdt.find(W('sdtPr'))
    alias_el = pr.find(W('alias')) if pr is not None else None
    return alias_el.get(W('val')) if alias_el is not None else None


def find_alias_containers(
        root: etree._Element,
        alias_map: dict[str, str]) -> dict[str, list[str]]:
    """Alias-mapped SDTs that enclose other alias-mapped SDTs.

    Returns {container alias: [nested aliases in document order]}, at any
    depth.  A container is an aliased content control with an aliased content
    control among its descendants; steps/nt/inspect_tmpl.py's stdlib helper
    uses the same definition.
    """
    containers: dict[str, list[str]] = {}
    for sdt in root.iter(W('sdt')):
        alias = _sdt_alias(sdt)
        if alias not in alias_map:
            continue
        nested = containers.setdefault(alias, [])
        for descendant in sdt.iterdescendants(W('sdt')):
            inner = _sdt_alias(descendant)
            if inner in alias_map and inner not in nested:
                nested.append(inner)
        if not nested:
            del containers[alias]
    return containers


def unwrap_sdts(root: etree._Element, alias_map: dict[str, str]) -> tuple[int, int]:
    """Replace each <w:sdt> with its sdtContent children.

    For SDTs whose alias is in alias_map, overwrite the text first.
    Returns (unwrapped_count, replaced_count).

    Raises ValueError, before touching the tree, if any alias-mapped SDT
    encloses another alias-mapped SDT.  Overwriting the container's text
    blanks the nested tokens and the multi-paragraph collapse then deletes
    the paragraphs holding them, so the nested fields vanish with no other
    trace.  The container alias does not belong in the map.
    """
    containers = find_alias_containers(root, alias_map)
    if containers:
        detail = '; '.join(
            f"{alias!r} wraps " + ', '.join(repr(n) for n in nested)
            for alias, nested in containers.items())
        raise ValueError(
            f"alias_map maps container content control(s): {detail}. "
            f"Overwriting a container erases the nested tokens. Remove the "
            f"container alias(es) from the alias map and keep the nested ones.")

    unwrapped = 0
    replaced = 0
    sdts = list(root.iter(W('sdt')))
    # Process innermost SDTs first (nested SDTs exist in the glossary).
    sdts.sort(key=lambda s: len(list(s.iterancestors(W('sdt')))), reverse=True)

    for sdt in sdts:
        parent = sdt.getparent()
        if parent is None:
            continue
        content = sdt.find(W('sdtContent'))
        pr = sdt.find(W('sdtPr'))
        alias_el = pr.find(W('alias')) if pr is not None else None
        alias = alias_el.get(W('val')) if alias_el is not None else None

        if content is None:
            parent.remove(sdt)
            continue

        if alias in alias_map:
            _overwrite_text(content, alias_map[alias])
            replaced += 1

            # Collapse multi-paragraph SDTs: keep only the paragraph
            # containing the placeholder; remove empty extras.
            paras = [c for c in content if c.tag == W('p')]
            if len(paras) > 1:
                placeholder = alias_map[alias]
                keeper = None
                for p in paras:
                    for t in p.iter(W('t')):
                        if t.text and placeholder in t.text:
                            keeper = p
                            break
                    if keeper is not None:
                        break
                if keeper is None:
                    keeper = paras[0]
                for p in paras:
                    if p is not keeper:
                        content.remove(p)

        idx = parent.index(sdt)
        for i, child in enumerate(list(content)):
            parent.insert(idx + i, child)
        parent.remove(sdt)
        unwrapped += 1

    return unwrapped, replaced


# ---------------------------------------------------------------------------
# Phase 2: Merge split-run placeholders
# ---------------------------------------------------------------------------

def merge_split_run_placeholders(para: etree._Element) -> None:
    """Collapse [ + italic-content + ] split-run sequences into one run.

    Handles both 3-run patterns ([ + label + ]) and N-run patterns where
    the italic label is itself split across multiple runs
    (e.g. [ + d + ate + ] for [date]).

    After merge, the first run carries [label] and the interior/closing
    runs are removed.
    """
    while True:
        runs = [c for c in para if c.tag == W('r')]
        merged = False
        for i in range(len(runs) - 2):
            r0 = runs[i]
            t0 = r0.find(W('t'))
            if t0 is None or t0.text is None or not t0.text.endswith('['):
                continue

            # Collect consecutive italic runs starting at i+1
            italic_parts: list[str] = []
            j = i + 1
            while j < len(runs):
                rj = runs[j]
                tj = rj.find(W('t'))
                if tj is None or tj.text is None:
                    break
                rpr_j = rj.find(W('rPr'))
                if rpr_j is not None and rpr_j.find(W('i')) is not None:
                    italic_parts.append(tj.text)
                    j += 1
                else:
                    break

            if not italic_parts or j >= len(runs):
                continue

            # The run at index j should start with ]
            r_close = runs[j]
            t_close = r_close.find(W('t'))
            if t_close is None or t_close.text is None or not t_close.text.startswith(']'):
                continue

            # Merge: prefix[label]suffix
            prefix = t0.text[:-1]  # everything before the [
            label = ''.join(italic_parts)
            suffix = t_close.text[1:]  # everything after the ]
            t0.text = f'{prefix}[{label}]{suffix}'
            if t0.text != t0.text.strip() or '  ' in t0.text:
                t0.set(XMLSPACE, 'preserve')
            # Remove interior italic runs and closing run
            for k in range(i + 1, j + 1):
                para.remove(runs[k])
            merged = True
            break
        if not merged:
            break


# ---------------------------------------------------------------------------
# Phase 3: Disambiguate duplicate placeholders
# ---------------------------------------------------------------------------

def _para_text(para: etree._Element) -> str:
    return ''.join(t.text or '' for t in para.iter(W('t')))


def disambiguate_duplicates(root: etree._Element, rules: dict) -> int:
    """Rename duplicate bracket placeholders using form-specific context rules.

    For each placeholder that appears more than once, walk paragraphs and apply
    context-based rules to rename occurrences. Errors if no rule matches.
    Returns count of renames performed.
    """
    if not rules:
        return 0

    body = root.find(W('body'))
    if body is None:
        return 0

    renames = 0
    for placeholder, rule_list in rules.items():
        # Find all <w:t> elements containing this exact placeholder
        matches: list[tuple[etree._Element, etree._Element]] = []  # (t_element, paragraph)
        for para in body.iter(W('p')):
            for t_el in para.iter(W('t')):
                if t_el.text and placeholder in t_el.text:
                    matches.append((t_el, para))

        if len(matches) <= 1:
            continue  # no disambiguation needed

        # Apply context rules
        default_rule = None
        context_rules = []
        for rule in rule_list:
            if 'default_rename' in rule:
                default_rule = rule
            else:
                context_rules.append(rule)

        for t_el, para in matches:
            para_txt = _para_text(para)
            matched = False
            for rule in context_rules:
                if 'context_contains' in rule and rule['context_contains'] in para_txt:
                    new_name = rule['rename_to']
                    if new_name != placeholder:
                        t_el.text = t_el.text.replace(placeholder, new_name)
                        renames += 1
                    matched = True
                    break
            if not matched:
                if default_rule is None:
                    raise ValueError(
                        f"No disambiguation rule matched for {placeholder!r} in "
                        f"paragraph: {para_txt[:80]!r}. Add a rule or a default_rename.")
                new_name = default_rule['default_rename']
                t_el.text = t_el.text.replace(placeholder, new_name)
                renames += 1

    return renames


# ---------------------------------------------------------------------------
# Phase 4: Fix numIds
# ---------------------------------------------------------------------------

def fix_numids(root: etree._Element, numid_fixes: dict[str, int]) -> int:
    """Fix or add numId values on Part instruction paragraphs.

    numid_fixes maps paragraph text prefix → target numId.
    If the paragraph already has a numPr with the wrong numId, patches it.
    If the paragraph has no numPr at all, creates one with ilvl=0.
    Returns count of fixes applied.
    """
    if not numid_fixes:
        return 0

    body = root.find(W('body'))
    if body is None:
        return 0

    fixed = 0
    for para in body.iter(W('p')):
        txt = _para_text(para)
        for prefix, target_numid in numid_fixes.items():
            if txt.startswith(prefix):
                ppr = para.find(W('pPr'))
                if ppr is None:
                    ppr = etree.SubElement(para, W('pPr'))
                    para.insert(0, ppr)
                numpr = ppr.find(W('numPr'))
                if numpr is None:
                    # Create numPr with ilvl=0 and target numId
                    numpr = etree.SubElement(ppr, W('numPr'))
                    ilvl_el = etree.SubElement(numpr, W('ilvl'))
                    ilvl_el.set(W('val'), '0')
                    numid_el = etree.SubElement(numpr, W('numId'))
                    numid_el.set(W('val'), str(target_numid))
                    fixed += 1
                else:
                    numid_el = numpr.find(W('numId'))
                    if numid_el is not None:
                        current = numid_el.get(W('val'))
                        if current != str(target_numid):
                            numid_el.set(W('val'), str(target_numid))
                            fixed += 1
    return fixed


# ---------------------------------------------------------------------------
# Phase 5: Sanitize mc:Ignorable
# ---------------------------------------------------------------------------

def sanitize_mc_ignorable(root: etree._Element) -> None:
    """Drop prefixes from mc:Ignorable that aren't declared on the element (T13)."""
    mc_ignorable = f"{{{NS['mc']}}}Ignorable"
    for el in root.iter():
        val = el.get(mc_ignorable)
        if not val:
            continue
        declared: set[str] = set()
        for prefix in el.nsmap:
            if prefix:
                declared.add(prefix)
        anc = el.getparent()
        while anc is not None:
            for p in anc.nsmap:
                if p:
                    declared.add(p)
            anc = anc.getparent()
        kept = [p for p in val.split() if p in declared]
        if kept != val.split():
            el.set(mc_ignorable, ' '.join(kept))


# ---------------------------------------------------------------------------
# Phase 6: Detect remaining duplicates
# ---------------------------------------------------------------------------

def check_no_duplicate_placeholders(
    root: etree._Element,
    leave_blank: set[str],
    allow_repeated: set[str] | None = None,
) -> None:
    """Error hard if any bracket placeholder appears more than once.

    leave_blank: placeholders the lawyer fills manually (excluded from check).
    allow_repeated: placeholders that legitimately repeat with the same value
                    (excluded from check, but filled programmatically).
    """
    body = root.find(W('body'))
    if body is None:
        return

    excluded = leave_blank | (allow_repeated or set())
    counts: dict[str, int] = {}
    for t_el in body.iter(W('t')):
        if not t_el.text:
            continue
        for m in PLACEHOLDER_RX.finditer(t_el.text):
            ph = m.group()
            if ph in excluded:
                continue
            counts[ph] = counts.get(ph, 0) + 1

    duplicates = {ph: n for ph, n in counts.items() if n > 1}
    if duplicates:
        msg = '; '.join(f'{ph!r} appears {n} times' for ph, n in duplicates.items())
        raise ValueError(f"Duplicate placeholders survived disambiguation: {msg}")


# ---------------------------------------------------------------------------
# Phase 7: Set template content type
# ---------------------------------------------------------------------------

def ensure_template_content_type(members: dict[str, bytes]) -> bool:
    """Ensure [Content_Types].xml says .dotx (template), not .docx (document).

    Returns True if a change was made.
    """
    ct_key = '[Content_Types].xml'
    ct = members[ct_key].decode('utf-8')
    doc_ct = ('application/vnd.openxmlformats-officedocument'
              '.wordprocessingml.document.main+xml')
    tmpl_ct = ('application/vnd.openxmlformats-officedocument'
               '.wordprocessingml.template.main+xml')
    if doc_ct in ct:
        members[ct_key] = ct.replace(doc_ct, tmpl_ct).encode('utf-8')
        return True
    return False


# ---------------------------------------------------------------------------
# Main conversion
# ---------------------------------------------------------------------------

def convert(src: Path, dst: Path, form: str) -> None:
    config = FORM_CONFIGS.get(form)
    if config is None:
        print(f"Unknown form type: {form!r}. Available: {list(FORM_CONFIGS)}", file=sys.stderr)
        sys.exit(2)

    alias_map = config['alias_map']
    disambiguation = config['disambiguation']
    leave_blank = config['leave_blank']
    numid_fixes = config['numid_fixes']
    allow_repeated = config.get('allow_repeated', set())

    with readable_zip(src) as zin:
        members = {n: zin.read(n) for n in zin.namelist()}

    # Strip vendor-specific XML parts (LEAP customXml, webextensions)
    strip_prefixes = ('customXml/', 'word/webextensions/')
    stripped = [n for n in members if any(n.startswith(p) for p in strip_prefixes)]
    for n in stripped:
        del members[n]
    if stripped:
        print(f"  stripped {len(stripped)} vendor-specific member(s)")

        # Clean Content_Types: remove Override entries for stripped members
        ct_key = '[Content_Types].xml'
        ct_ns = 'http://schemas.openxmlformats.org/package/2006/content-types'
        ct_root = etree.fromstring(members[ct_key])
        for override in list(ct_root.findall(f'{{{ct_ns}}}Override')):
            part_name = override.get('PartName', '').lstrip('/')
            if any(part_name.startswith(p) for p in strip_prefixes):
                ct_root.remove(override)
        members[ct_key] = etree.tostring(
            ct_root, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Clean .rels files: remove Relationship entries targeting stripped members
        rels_ns = 'http://schemas.openxmlformats.org/package/2006/relationships'
        for rels_name in list(members):
            if not rels_name.endswith('.rels'):
                continue
            try:
                rels_root = etree.fromstring(members[rels_name])
            except etree.XMLSyntaxError:
                continue
            changed = False
            for rel in list(rels_root.findall(f'{{{rels_ns}}}Relationship')):
                target = rel.get('Target', '')
                if not target.startswith('/'):
                    rels_dir = rels_name.rsplit('/', 1)[0].replace(
                        '_rels', '').rstrip('/')
                    if rels_dir:
                        target = rels_dir + '/' + target
                target = target.lstrip('/')
                if any(target.startswith(p) for p in strip_prefixes):
                    rels_root.remove(rel)
                    changed = True
            if changed:
                members[rels_name] = etree.tostring(
                    rels_root, xml_declaration=True, encoding='UTF-8',
                    standalone=True)

    total_unwrapped = 0
    total_replaced = 0

    # Transform document.xml, headers, footers, and glossary
    for name in list(members):
        if not name.endswith('.xml'):
            continue
        if not (name.startswith('word/') and
                (name.endswith('document.xml') or
                 name.startswith('word/header') or
                 name.startswith('word/footer') or
                 name == 'word/glossary/document.xml')):
            continue

        xml_bytes = members[name]

        # Phase 1: Unwrap SDTs
        if b'<w:sdt' in xml_bytes:
            root = etree.fromstring(xml_bytes)
            u, r = unwrap_sdts(root, alias_map)
            total_unwrapped += u
            total_replaced += r
        else:
            try:
                root = etree.fromstring(xml_bytes)
            except etree.XMLSyntaxError:
                continue

        # Phase 2: Merge split-run placeholders (main document only)
        if name.endswith('document.xml') and name != 'word/glossary/document.xml':
            for para in root.iter(W('p')):
                merge_split_run_placeholders(para)

            # Phase 3: Disambiguate duplicates (main document only)
            renames = disambiguate_duplicates(root, disambiguation)
            if renames:
                print(f"  disambiguated {renames} duplicate placeholder(s)")

            # Phase 4: Fix numIds (main document only)
            fixes = fix_numids(root, numid_fixes)
            if fixes:
                print(f"  fixed {fixes} numId value(s)")

            # Phase 6: Check for remaining duplicates (main document only)
            check_no_duplicate_placeholders(root, leave_blank, allow_repeated)

        # Phase 5: Sanitize mc:Ignorable (all parts)
        sanitize_mc_ignorable(root)

        members[name] = etree.tostring(
            root, xml_declaration=True, encoding='UTF-8', standalone=True)

    # Phase 7: Set template content type
    ct_changed = ensure_template_content_type(members)

    # Write output
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in members.items():
            zout.writestr(name, data)

    print(f"Wrote {dst}")
    print(f"  unwrapped {total_unwrapped} SDT(s), replaced {total_replaced} alias-bound text block(s)")
    if ct_changed:
        print("  content type set to template (.dotx)")
    print(f"  source size: {src.stat().st_size:,} bytes")
    print(f"  output size: {dst.stat().st_size:,} bytes")

    # Residual SDT check (main document only)
    with zipfile.ZipFile(dst) as zin:
        doc = zin.read('word/document.xml')
    residual = doc.count(b'<w:sdt ') + doc.count(b'<w:sdt>')
    if residual:
        print(f"  WARNING: {residual} <w:sdt> still present in document.xml",
              file=sys.stderr)
        sys.exit(1)
    print("  document.xml: no residual <w:sdt> elements")


def main() -> int:
    p = argparse.ArgumentParser(
        description='Convert LEAP export to bracket-placeholder .dotx template.')
    p.add_argument('source', help='Raw LEAP .docx or SDT canonical .dotx')
    p.add_argument('output', help='Output bracket-placeholder .dotx path')
    p.add_argument('--form', default='noa',
                   help=f'Form type (default: noa). Available: {list(FORM_CONFIGS)}')
    args = p.parse_args()

    convert(Path(args.source), Path(args.output), args.form)
    return 0


if __name__ == '__main__':
    sys.exit(main())
