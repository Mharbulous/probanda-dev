"""Shared substitution maps and builders for Forms 32, 1, 4, 66, 123, 17 and 8."""
from __future__ import annotations

from fill_subserv import _join_names


# ---------------------------------------------------------------------------
# Substitution maps
# ---------------------------------------------------------------------------

def _subs_if_present(ctx: dict, mappings: dict[str, str]) -> dict[str, str]:
    """Build substitution map, only including keys present in ctx."""
    return {placeholder: ctx[key] for placeholder, key in mappings.items()
            if key in ctx and ctx[key]}


# Per-form placeholder → context-key mappings.
# Only placeholders that actually appear in each .dotx template are listed.

_COMMON = {
    '[COURT FILE NUMBER]': 'court_file_number',
    '[REGISTRY]': 'registry',
    '[LAWYER NAME]': 'lawyer_name',
}

_STANDARD_PARTIES = {
    '[PLAINTIFF / PETITIONER NAME(S)]': 'plaintiff_caption',
    '[PLAINTIFF]': 'plaintiff_role',
    '[DEFENDANT / RESPONDENT NAME(S)]': 'defendant_caption',
    '[DEFENDANT]': 'defendant_role',
}

_COURT_ADDRESS = {
    # em-dash U+2014 is the actual character in the template XML
    '[COURT ADDRESS \u2014 e.g. 800 Smithe Street, Vancouver, BC V6Z 2E1]': 'court_location',
}

_FIRM = {
    '[FIRM ADDRESS]': 'firm_address',
    '[FIRM EMAIL]': 'firm_email',
    '[FIRM FAX]': 'firm_fax',
}


def _firm_subs(ctx: dict) -> dict[str, str]:
    """Firm details for the address-for-service block on Forms 1 and 4.

    The e-mail and fax lines read "(if any)", so an empty value is a
    deliberate blank -- a firm with no fax -- and substitutes to nothing;
    _subs_if_present would drop the key and leave the token standing instead.
    The address for service is mandatory, so an empty one keeps its token for
    the verifier to catch rather than filing a blank address. A context with
    no firm block at all leaves all three tokens alone.
    """
    if not any(key in ctx for key in _FIRM.values()):
        return {}
    subs = {ph: str(ctx.get(key, '') or '') for ph, key in _FIRM.items()}
    if not subs['[FIRM ADDRESS]']:
        del subs['[FIRM ADDRESS]']
    return subs


def _time_estimate(hours, minutes) -> str:
    """Form 32's estimate as counsel writes it: "30 minutes", "1 hour 30 minutes"."""
    hours, minutes = str(hours).strip(), str(minutes).strip()
    parts = []
    if hours not in ('', '0'):
        parts.append(f"{hours} hour{'' if hours == '1' else 's'}")
    if minutes not in ('', '0') or not parts:
        parts.append(f"{minutes or '0'} minute{'' if minutes == '1' else 's'}")
    return ' '.join(parts)


_ASSOCIATE_JUDGE_SENTENCE = 'This matter is within the jurisdiction of an associate judge.'
_NOT_ASSOCIATE_JUDGE_SENTENCE = 'This matter is not within the jurisdiction of an associate judge.'


def _registry_name(registry: str) -> str:
    """The stored bare registry ("Vancouver") as the style of proceeding prints it
    ("Vancouver Registry"). A value already ending in "Registry" would print
    "Registry Registry", so it is refused, as Form 33 refuses it (#985)."""
    words = registry.split()
    if words and words[-1].casefold() == 'registry':
        raise ValueError(
            f"registry must be a bare place name (e.g. 'Vancouver'), got {registry!r}")
    return registry + ' Registry'


def build_subs(ctx: dict) -> dict[str, str]:
    """NOA (Form 32) substitutions."""
    associate_judge = str(ctx.get('associate_judge', 'yes')).strip()
    is_associate_judge = associate_judge.lower() in ('yes', 'y', 'true', '1')
    # asm32's lenient emit sends a bracketed placeholder while the jurisdiction is undetermined;
    # it prints in the sentence's place.
    undetermined = associate_judge.startswith('[') and associate_judge.endswith(']')
    subs = _subs_if_present(ctx, {**_COMMON, **_STANDARD_PARTIES, **_COURT_ADDRESS})
    if '[REGISTRY]' in subs:
        subs['[REGISTRY]'] = _registry_name(subs['[REGISTRY]'])
    return {
        **subs,
        '[APPLICANT NAME(S)]': ctx['applicant_names'],
        '[TO AFFECTED PARTIES]': ctx['to_affected_parties'],
        '[proposed hearing]': ctx['proposed_hearing'],
        '[time estimate]': _time_estimate(ctx['duration_hours'], ctx['duration_minutes']),
        '[CLIENT NAME]': ctx.get('client_name', ''),
        _ASSOCIATE_JUDGE_SENTENCE: (associate_judge if undetermined
                                    else _ASSOCIATE_JUDGE_SENTENCE if is_associate_judge
                                    else _NOT_ASSOCIATE_JUDGE_SENTENCE),
    }


def build_subs_nocc(ctx: dict) -> dict[str, str]:
    """NOCC (Form 1) substitutions."""
    return {
        **_subs_if_present(ctx, {
            **_COMMON, **_COURT_ADDRESS,
            '[PLAINTIFF NAME(S)]': 'plaintiff_caption',
            '[DEFENDANT NAME(S)]': 'defendant_caption',
        }),
        **_firm_subs(ctx),
    }


def build_subs_rtc(ctx: dict) -> dict[str, str]:
    """Response to Counterclaim (Form 4) substitutions."""
    return {
        **_subs_if_present(ctx, {
            **_COMMON, **_STANDARD_PARTIES,
            '[CLIENT NAME]': 'client_name',
            '[RESPONDING PARTY NAME(S)]': 'defendant_caption',
        }),
        **_firm_subs(ctx),
    }


def build_subs_petition(ctx: dict) -> dict[str, str]:
    """Petition (Form 66) substitutions."""
    return _subs_if_present(ctx, {
        **_COMMON, **_COURT_ADDRESS,
        '[PETITIONER NAME(S)]': 'plaintiff_caption',
        '[PETITIONER]': 'plaintiff_role',
        '[RESPONDENT NAME(S)]': 'defendant_caption',
        '[RESPONDENT]': 'defendant_role',
        '[CLIENT NAME]': 'client_name',
        '[CLIENT ADDRESS]': 'client_address',
        '[CLIENT EMAIL]': 'client_email',
        '[CLIENT FAX]': 'client_fax',
        '[LAWYER DETAILS]': 'lawyer_details',
        '[RESPONDENT NAME AND ADDRESS]': 'respondent_name_and_address',
        '[PROCEEDING BROUGHT BY]': 'proceeding_brought_by',
    })


def build_subs_otsc(ctx: dict) -> dict[str, str]:
    """Offer to Settle Costs (Form 123) substitutions."""
    return _subs_if_present(ctx, {
        **_COMMON, **_STANDARD_PARTIES,
        '[CLIENT NAME]': 'client_name',
        '[PARTY(IES)]': 'parties_description',
    })


_FORM17_AFFIDAVIT_LINE = (
    'Affidavit # [number] of [deponent name], made [mmmm d, yyyy].'
)
_FORM8_DAMAGES_SENTENCE = (
    'THIS COURT ORDERS that the Defendant, [DEFENDANT], pay to the Plaintiff '
    'damages to be assessed;'
)
_FORM8_COSTS_SENTENCE = (
    'THIS COURT FURTHER ORDERS that the Defendant [DEFENDANT] pay to the Plaintiff'
)


def build_subs_form17(ctx: dict) -> dict[str, str]:
    """Requisition — General (Form 17) substitutions."""
    return _subs_if_present(ctx, {
        **_COMMON,
        **_STANDARD_PARTIES,
        '[FILED BY]': 'filed_by',
        '[REQUIRED — order or relief sought]': 'required_text',
        _FORM17_AFFIDAVIT_LINE: 'affidavit_description',
        '[CLIENT NAME]': 'client_name',
    })


def build_subs_form8(ctx: dict) -> dict[str, str]:
    """Default Judgment (Form 8) substitutions."""
    subs = _subs_if_present(ctx, {
        '[COURT FILE NUMBER]': 'court_file_number',
        '[REGISTRY]': 'registry',
        **_STANDARD_PARTIES,
        '[AMOUNT]': 'amount',
    })
    defendant_caption = str(ctx.get('defendant_caption', '')).strip()
    if defendant_caption:
        defendant_name = _join_names([
            name.strip() for name in defendant_caption.splitlines() if name.strip()
        ])
        subs[_FORM8_DAMAGES_SENTENCE] = _FORM8_DAMAGES_SENTENCE.replace(
            '[DEFENDANT]', defendant_name)
        subs[_FORM8_COSTS_SENTENCE] = _FORM8_COSTS_SENTENCE.replace(
            '[DEFENDANT]', defendant_name)
    return subs
