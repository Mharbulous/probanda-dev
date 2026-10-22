"""Forms 33.01 (Notice of Hearing of Application) and 30.001 (record cover).

Both templates keep the official form's own wording, one Word run per line
below. A builder replaces a whole line with the line filled from the context,
so a field the context does not give leaves the form's own instruction text
or blank. Nothing here computes or infers a date, a time or an estimate: each
is the practitioner's content, passed through as given.

A check box is a run holding "☐" alone, followed by the run holding its label
(Form 32's convention, `fill_appendix.py`). `mark_boxes` turns the boxes whose
labels a `boxes_*` function names into "☒", before any substitution runs.
"""
from __future__ import annotations

from fill_ooxml import WN
from fill_subs import _STANDARD_PARTIES, _subs_if_present

UNCHECKED, CHECKED = '☐', '☒'

_CAPTION = {
    '[COURT FILE NUMBER]': 'court_file_number',
    '[REGISTRY]': 'registry',
    **_STANDARD_PARTIES,
}


def _yes(value) -> bool:
    return str(value).strip().lower() in ('yes', 'y', 'true', '1')


def _fill_line(line: str, ctx: dict, mapping: dict[str, str]) -> dict[str, str]:
    """{line: filled line} when the context gives any of the line's fields."""
    filled = line
    for placeholder, key in mapping.items():
        value = ctx.get(key)
        if value is not None and str(value).strip():
            value = str(value).strip()
            # "9:45 a.m." ends the sentence itself: no second full stop.
            if value.endswith('.'):
                filled = filled.replace(placeholder + '.', value)
            filled = filled.replace(placeholder, value)
    return {line: filled} if filled != line else {}


def mark_boxes(body, labels: set[str]) -> None:
    """Check each box whose label run, stripped, is in *labels*."""
    for para in body.iter(WN('p')):
        texts = list(para.iter(WN('t')))
        for box, label in zip(texts, texts[1:]):
            if box.text == UNCHECKED and (label.text or '').strip() in labels:
                box.text = CHECKED


# ---------------------------------------------------------------------------
# Form 33.01, Notice of Hearing of Application (Rule 8-1 (14.4) (a))
# ---------------------------------------------------------------------------

NOHA_TO = 'To: [name(s) of application respondent(s), if any]'
NOHA_NOTICE = ('TAKE NOTICE that the notice of application of [party(ies)] '
               'dated [date] will be heard at the courthouse at [address]')
NOHA_WHEN = ' on [date] at [time of day].'
NOHA_NOA_SERVED = 'The notice of application was served on [date(s)]'
NOHA_AR_SERVED = 'The application response(s) was(were) served on [date(s)]'
NOHA_NO_RESPONSE = ('No application response has been served and the time to '
                    'serve a response has expired.')
NOHA_DATE_AGREED = ('The parties have agreed as to the date of the hearing of '
                    'the application.')
NOHA_DATE_NOT_AGREED = (
    'The parties have been unable to agree as to the date of the hearing but '
    'notice of the hearing will be given to the application respondents in '
    'accordance with Rule 8-1 (14.5) of the Supreme Court Civil Rules.')
NOHA_DATE_UNOPPOSED = 'The application is unopposed, by consent or without notice.'
NOHA_DURATION_AGREED = ('It has been agreed by the parties that the hearing '
                        'will take [time estimate].')
NOHA_DURATION_NOT_AGREED = ('The parties have been unable to agree as to how '
                            'long the hearing will take and')
NOHA_APPLICANT_ESTIMATE = ('(a) the time estimate of the applicant(s) is '
                           '_______ minutes, and')
NOHA_RESPONDENT_ESTIMATE = ('the time estimate of the application '
                            'respondent(s) is _______ minutes.')
NOHA_RESPONDENT_NONE = ('the application respondent(s) has(ve) not given a '
                        'time estimate.')
NOHA_ASSOCIATE_JUDGE = 'This matter is within the jurisdiction of an associate judge.'
NOHA_NOT_ASSOCIATE_JUDGE = ('This matter is not within the jurisdiction of an '
                            'associate judge.')
NOHA_SUMMARY_TRIAL = 'The application is a summary trial brought under Rule 9-7.'
NOHA_FINAL_ORDER = 'The application is seeking a final order.'
NOHA_INJUNCTION = 'The application is seeking injunctive relief.'
NOHA_ORDERS_LEAD = ('The orders being sought are as set out in the Notice of '
                    'Application dated [date]:')
NOHA_ORDERS = ('[set out paragraph numbers of orders from the Notice of '
               'Application and any additional proposed terms sought by consent]')
NOHA_SIGN_APPLICANT = 'applicant'
NOHA_SIGN_LAWYER = 'lawyer for applicant(s)'
NOHA_TYPED_NAME = '[type or print name]'

_DATE_BOXES = {
    'agreed': NOHA_DATE_AGREED,
    'not_agreed': NOHA_DATE_NOT_AGREED,
    'unopposed': NOHA_DATE_UNOPPOSED,
}
_SIGNATORY_BOXES = {'applicant': NOHA_SIGN_APPLICANT, 'lawyer': NOHA_SIGN_LAWYER}


def build_subs_form33_01(ctx: dict) -> dict[str, str]:
    """Notice of Hearing of Application (Form 33.01) substitutions."""
    subs = _subs_if_present(ctx, _CAPTION)
    lines = {
        NOHA_TO: {'[name(s) of application respondent(s), if any]':
                  'application_respondents'},
        NOHA_NOTICE: {'[party(ies)]': 'applicant_parties',
                      '[date]': 'notice_dated',
                      '[address]': 'hearing_place'},
        NOHA_WHEN: {'[date]': 'hearing_day', '[time of day]': 'hearing_time'},
        NOHA_NOA_SERVED: {'[date(s)]': 'notice_served_dates'},
        NOHA_AR_SERVED: {'[date(s)]': 'response_served_dates'},
        NOHA_DURATION_AGREED: {'[time estimate]': 'agreed_time_estimate'},
        NOHA_APPLICANT_ESTIMATE: {'_______': 'applicant_estimate_minutes'},
        NOHA_RESPONDENT_ESTIMATE: {'_______': 'respondent_estimate_minutes'},
        NOHA_ORDERS_LEAD: {'[date]': 'notice_dated'},
        NOHA_ORDERS: {NOHA_ORDERS: 'orders_sought'},
        NOHA_TYPED_NAME: {NOHA_TYPED_NAME: 'signatory_name'},
    }
    for line, mapping in lines.items():
        subs.update(_fill_line(line, ctx, mapping))
    return subs


def boxes_form33_01(ctx: dict) -> set[str]:
    """The labels of the boxes the context checks. A box the context says
    nothing about stays unchecked."""
    boxes = set()
    if str(ctx.get('notice_served_dates', '')).strip():
        boxes.add(NOHA_NOA_SERVED)
    if str(ctx.get('response_served_dates', '')).strip():
        boxes.add(NOHA_AR_SERVED)
    if _yes(ctx.get('no_response_time_expired', '')):
        boxes.add(NOHA_NO_RESPONSE)

    basis = str(ctx.get('hearing_date_basis', '')).strip().lower()
    if basis:
        if basis not in _DATE_BOXES:
            raise ValueError(f"hearing_date_basis must be one of "
                             f"{sorted(_DATE_BOXES)}, got {basis!r}")
        boxes.add(_DATE_BOXES[basis])

    if str(ctx.get('agreed_time_estimate', '')).strip():
        boxes.add(NOHA_DURATION_AGREED)
    respondent_none = _yes(ctx.get('respondent_gave_no_estimate', ''))
    respondent_minutes = str(ctx.get('respondent_estimate_minutes', '')).strip()
    if (str(ctx.get('applicant_estimate_minutes', '')).strip()
            or respondent_minutes or respondent_none):
        boxes.add(NOHA_DURATION_NOT_AGREED)
    if respondent_minutes:
        boxes.add(NOHA_RESPONDENT_ESTIMATE)
    if respondent_none:
        boxes.add(NOHA_RESPONDENT_NONE)

    if 'associate_judge' in ctx and str(ctx['associate_judge']).strip():
        boxes.add(NOHA_ASSOCIATE_JUDGE if _yes(ctx['associate_judge'])
                  else NOHA_NOT_ASSOCIATE_JUDGE)
    for key, label in (('summary_trial', NOHA_SUMMARY_TRIAL),
                       ('final_order', NOHA_FINAL_ORDER),
                       ('injunctive_relief', NOHA_INJUNCTION)):
        if _yes(ctx.get(key, '')):
            boxes.add(label)

    signatory = str(ctx.get('signatory', '')).strip().lower()
    if signatory:
        if signatory not in _SIGNATORY_BOXES:
            raise ValueError(f"signatory must be one of "
                             f"{sorted(_SIGNATORY_BOXES)}, got {signatory!r}")
        boxes.add(_SIGNATORY_BOXES[signatory])
    return boxes


# ---------------------------------------------------------------------------
# Form 30.001, record cover (Rules 8-1 (15), 12-3 (1), 16-1 (11), 23-6)
# ---------------------------------------------------------------------------

REC_TYPE = '[TYPE OF RECORD]'
REC_RULE = ('[Include the applicable Rule reference as follows: '
            '"(RULE [8-1 (15), 12-3 (1), 16-1 (11), 23-6 (3.1), or 23-6 (8.8)] )"]')
REC_PARTY_NAME = '[name of party]'
REC_PARTY_COUNSEL = '[name of counsel if applicable]'
REC_PARTY_ADDRESS = '[address for delivery]'
REC_PARTY_CONTACT = '[telephone and fax/e-mail]'
REC_WHEN = 'Date and Time of [indicate appearance type]: ________________'
REC_WHERE = 'Place of [indicate appearance type]: ________________'
REC_PLAINTIFF_ESTIMATE = 'Time estimate of the Plaintiff: ________________'
REC_DEFENDANT_ESTIMATE = 'Time estimate of the Defendant: ________________'
REC_HEARD_JUDGE = 'Judge'
REC_HEARD_ASSOCIATE = 'Associate Judge'
REC_HEARD_REGISTRAR = 'Registrar'
REC_PROVIDED_BY = '[Type of Record] provided by: ________________'

_HEARD_BEFORE_BOXES = {
    'judge': REC_HEARD_JUDGE,
    'associate_judge': REC_HEARD_ASSOCIATE,
    'registrar': REC_HEARD_REGISTRAR,
}
_PARTY_FIELDS = {
    REC_PARTY_NAME: 'name',
    REC_PARTY_COUNSEL: 'counsel',
    REC_PARTY_ADDRESS: 'address',
    REC_PARTY_CONTACT: 'contact',
}
_BLANK = '________________'


def build_subs_form30_001(ctx: dict) -> dict[str, str]:
    """Record cover (Form 30.001) substitutions."""
    subs = _subs_if_present(ctx, _CAPTION)
    record_type = str(ctx.get('record_type', '')).strip()
    lines = {
        REC_TYPE: {REC_TYPE: 'record_type'},
        REC_RULE: {REC_RULE: 'rule_reference'},
        REC_WHEN: {'[indicate appearance type]': 'appearance_type',
                   _BLANK: 'appearance_date_time'},
        REC_WHERE: {'[indicate appearance type]': 'appearance_type',
                    _BLANK: 'appearance_place'},
        REC_PLAINTIFF_ESTIMATE: {_BLANK: 'plaintiff_time_estimate'},
        REC_DEFENDANT_ESTIMATE: {_BLANK: 'defendant_time_estimate'},
        REC_PROVIDED_BY: {_BLANK: 'provided_by'},
    }
    for line, mapping in lines.items():
        subs.update(_fill_line(line, ctx, mapping))
    if record_type:
        line = subs.get(REC_PROVIDED_BY, REC_PROVIDED_BY)
        subs[REC_PROVIDED_BY] = line.replace('[Type of Record]', record_type.title())
    return subs


def boxes_form30_001(ctx: dict) -> set[str]:
    heard_before = str(ctx.get('heard_before', '')).strip().lower()
    if not heard_before:
        return set()
    if heard_before not in _HEARD_BEFORE_BOXES:
        raise ValueError(f"heard_before must be one of "
                         f"{sorted(_HEARD_BEFORE_BOXES)}, got {heard_before!r}")
    return {_HEARD_BEFORE_BOXES[heard_before]}


def party_rows_form30_001(ctx: dict) -> list[dict[str, str]]:
    """One party block per party the context gives. A field the party entry
    holds, even empty, replaces its line's instruction; one it lacks keeps it.
    With no parties given the form's own two blank blocks stay."""
    if not ctx.get('parties'):
        return [{}, {}]
    return [{placeholder: str(party[key]).strip()
             for placeholder, key in _PARTY_FIELDS.items() if key in party}
            for party in ctx['parties']]
