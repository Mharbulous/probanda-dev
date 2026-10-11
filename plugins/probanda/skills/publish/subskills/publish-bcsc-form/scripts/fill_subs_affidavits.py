"""Substitution builders for Forms 109, 15 and 16."""
from __future__ import annotations

from fill_subserv import (
    _AOS_TITLE, _AOS_TITLE_SUBSTITUTED, _AOS_SECTION1_LEAD, _AOS_SECTION2_LEAD,
    _AOS_SECTION2_LEAD_SUBSTITUTED, is_substituted_service, _join_names,
    validate_substituted_service,
)


def build_subs_affidavit(ctx: dict) -> dict[str, str]:
    return {
        '[COURT FILE NUMBER]':              ctx['court_file_number'],
        '[REGISTRY]':                       ctx['registry'],
        '[PLAINTIFF / PETITIONER NAME(S)]': ctx['plaintiff_caption'],
        '[PLAINTIFF]':                      ctx['plaintiff_role'],
        '[DEFENDANT / RESPONDENT NAME(S)]': ctx['defendant_caption'],
        '[DEFENDANT]':                      ctx['defendant_role'],
        '[DEPONENT NAME]':                  ctx['deponent_name'],
        '[DEPONENT ADDRESS]':               ctx['deponent_address'],
        '[DEPONENT OCCUPATION]':            ctx.get('deponent_occupation', ''),
        '[swear or affirm]':                ctx['swear_or_affirm'],
        '[SWORN OR AFFIRMED]':              ctx['sworn_or_affirmed'],
        '[date]':                           ctx['affidavit_date'],
        '[COMMISSIONER CITY]':              ctx['commissioner_city'],
        '[COMMISSIONER NAME]':              ctx.get('commissioner_name', ''),
        '[ORDINAL]':                        ctx['affidavit_ordinal'],
    }


def _subs_service_affidavit_common(ctx: dict) -> dict[str, str]:
    """Style of proceeding, deponent line and jurat — shared by Forms 15 and 16.

    The commissioner's name is always blank: the commissioner's stamp supplies
    it, and pre-printing a name constrains who can take the affidavit.
    """
    return {
        '[COURT FILE NUMBER]':              ctx['court_file_number'],
        '[REGISTRY]':                       ctx['registry'],
        '[PLAINTIFF / PETITIONER NAME(S)]': ctx['plaintiff_caption'],
        '[PLAINTIFF]':                      ctx['plaintiff_role'],
        '[DEFENDANT / RESPONDENT NAME(S)]': ctx['defendant_caption'],
        '[DEFENDANT]':                      ctx['defendant_role'],
        '[DEPONENT NAME]':                  ctx['deponent_name'],
        '[DEPONENT ADDRESS]':               ctx['deponent_address'],
        '[DEPONENT OCCUPATION]':            ctx.get('deponent_occupation', ''),
        # The prescribed forms read "SWEAR (OR AFFIRM) THAT:" in capitals.
        '[SWEAR OR AFFIRM]':                str(ctx['swear_or_affirm']).upper(),
        '[SWORN OR AFFIRMED]':              ctx['sworn_or_affirmed'],
        '[date]':                           ctx['affidavit_date'],
        '[COMMISSIONER CITY]':              ctx['commissioner_city'],
        '[COMMISSIONER NAME]':              '',
    }


def _subs_service_facts(ctx: dict) -> dict[str, str]:
    """The single-act service facts of the base Forms 15 and 16."""
    return {
        '[PERSON SERVED]': ctx['person_served'],
        '[SERVICE DATE]':  ctx['service_date'],
        '[SERVICE TIME]':  ctx['service_time'],
    }


def build_subs_afs(ctx: dict) -> dict[str, str]:
    """Affidavit of Personal Service (Form 15) substitutions."""
    if str(ctx.get('served_party_type', 'individual')).strip().lower() != 'individual':
        raise ValueError(
            "Form 15 here covers personal service on an individual only. "
            "Service on a company (Rule 4-3 / Business Corporations Act) is not "
            "yet modelled — draft that affidavit as a Form 109.")
    return {
        **_subs_service_affidavit_common(ctx),
        **_subs_service_facts(ctx),
        '[SERVICE CITY]':          ctx['service_city'],
        '[IDENTIFICATION DETAIL]': ctx.get('identification_detail', ''),
    }


def build_subs_aos(ctx: dict) -> dict[str, str]:
    """Affidavit of Ordinary Service (Form 16) substitutions.

    In the substituted-service variant the three fixed sentences the base form
    fills by placeholder — the title, the section 1 lead and the section 2 lead
    — are replaced whole, because the variant deposes to several acts on
    several parties and the base sentences name exactly one of each.
    """
    if not is_substituted_service(ctx):
        return {
            **_subs_service_affidavit_common(ctx),
            **_subs_service_facts(ctx),
            '[SERVICE ADDRESS]': ctx.get('service_address', ''),
            '[SERVICE FAX]':     ctx.get('service_fax', ''),
            '[SERVICE EMAIL]':   ctx.get('service_email', ''),
        }

    validate_substituted_service(ctx)
    parties = _join_names([p['name'] for p in ctx['parties_served']])
    when = f"On {ctx['service_date']}"
    if ctx.get('service_time'):
        when += f", at {ctx['service_time']}"
    return {
        **_subs_service_affidavit_common(ctx),
        _AOS_TITLE: _AOS_TITLE_SUBSTITUTED,
        _AOS_SECTION1_LEAD: f'{when}, I served {parties} with',
        _AOS_SECTION2_LEAD: _AOS_SECTION2_LEAD_SUBSTITUTED,
    }
