"""Form 33 substitution builder."""
from __future__ import annotations


def _format_party_list(caption: str) -> str:
    """Convert ALL-CAPS newline-separated party list to natural language.

    E.g. "NORTHFIELD CLOTHING CORPORATION\nANDREW MARLOWE\nJESSE MARLOWE"
      -> "Northfield Clothing Corporation, Andrew Marlowe and Jesse Marlowe"
    """
    parts = [p.strip() for p in caption.split('\n') if p.strip()]
    if not parts:
        return caption
    cased = []
    for p in parts:
        # Preserve known initialisms; title-case the rest
        words = []
        for word in p.split():
            if word in ('AS', 'IN', 'AND', 'OF', 'THE', 'A', 'AN',
                        'A.K.A.', 'INC.', 'LTD.', 'CORP.', 'CO.'):
                words.append(word.lower() if word not in ('INC.', 'LTD.', 'CORP.', 'CO.', 'A.K.A.') else word)
            else:
                words.append(word.title())
        cased.append(' '.join(words))
    if len(cased) == 1:
        return cased[0]
    return ', '.join(cased[:-1]) + ' and ' + cased[-1]


def build_subs_form33(ctx: dict) -> dict[str, str]:
    """Application Response (Form 33) substitutions."""
    # The stored registry is a bare place name (#962). A value already
    # ending in the word "Registry" is malformed data that every other
    # caption prints as "Registry Registry", so refuse it rather than
    # silently accept it here (#985). Blank stays blank.
    registry = ctx.get('registry', '')
    words = registry.split()
    if words and words[-1].casefold() == 'registry':
        raise ValueError(
            f"registry must be a bare place name (e.g. 'Vancouver'), got {registry!r}")
    if registry:
        registry = registry + ' Registry'

    defendant_caption = ctx.get('defendant_caption', '')
    plaintiff_caption = ctx.get('plaintiff_caption', '')

    plaintiff_role = ctx.get('plaintiff_role', 'Plaintiff')
    defendant_role = ctx.get('defendant_role', 'Defendant')
    if plaintiff_caption.count('\n') >= 1 and not plaintiff_role.casefold().endswith('s'):
        plaintiff_role += 's'
    if defendant_caption.count('\n') >= 1 and not defendant_role.casefold().endswith('s'):
        defendant_role += 's'

    # The application respondent (the client) is not always the defendant —
    # a plaintiff may respond to a defence application. Match client_name
    # against the caption party lists to pick the client's side; absent or
    # unmatched falls back to the defendant side.
    def _caption_names(caption: str) -> set[str]:
        return {' '.join(n.split()) for n in caption.upper().split('\n') if n.strip()}

    client_name = ' '.join(ctx.get('client_name', '').upper().split())
    on_plaintiff_side = (client_name and client_name in _caption_names(plaintiff_caption)
                         and client_name not in _caption_names(defendant_caption))
    if on_plaintiff_side:
        client_caption, client_role, other_caption = (
            plaintiff_caption, plaintiff_role, defendant_caption)
    else:
        client_caption, client_role, other_caption = (
            defendant_caption, defendant_role, plaintiff_caption)

    opposed = ctx.get('opposed_order_numbers', 'Nil')
    no_position = ctx.get('no_position_order_numbers', 'Nil')
    oppose_sentence = (
        'The application respondent(s) oppose(s) the granting of the orders '
        f'set out in paragraphs {opposed} of Part 1 of the notice of application.'
    )
    no_position_sentence = (
        'The application respondent(s) take(s) no position on the granting of '
        f'the orders set out in paragraphs {no_position} of Part 1 of the notice of application.'
    )

    return {
        '[COURT FILE NUMBER]': ctx.get('court_file_number', ''),
        '[REGISTRY]': registry,
        '[2-INCH MARGIN]': '',
        '[IN THE MATTER OF]': '',
        '[FAST TRACK]': '',
        '[CLASS ACTION]': '',
        '[CAPTION ORIGINATING PARTY]': plaintiff_caption,
        '[CAPTION RESPONDING PARTY]': defendant_caption,
        '[ORIGINATING PARTY]': plaintiff_role,
        '[RESPONDING PARTY]': defendant_role,
        '[CLIENT FULL NAME]': _format_party_list(client_caption),
        '[OTHER SIDE FULL NAME]': _format_party_list(other_caption),
        '[SERVICE CHECK]': '',
        '[CLIENT FILE NAME]': f'the {client_role.title()}' if client_role else '',
        '[PERSON ACTING FULL NAME]': ctx.get('lawyer_name', ''),
        '[date]': ctx.get('notice_filed', ''),
        '[time estimate]': ctx.get('time_estimate', ''),
        ('The application respondent(s) oppose(s) the granting of the orders set '
         'out in paragraphs [list paragraph numbers] of Part 1 of the notice of application.'):
            oppose_sentence,
        ('The application respondent(s) take(s) no position on the granting of the '
         'orders set out in paragraphs [list paragraph numbers] of Part 1 of the notice of application.'):
            no_position_sentence,
    }
