"""rewrite_jurat finds and rewrites the city and date lines of the /publish Form 109 jurat
(the Rule 22-2(5) layout), the LEAP Form 109 idiom and the Form 15/16 jurat, with a written
or a blank date, and a failure names the check that failed (#1377). Pages are built with
PyMuPDF at the positions measured on the converted /publish template. The last test is an
integration test across skills: it fills the real template with publish-bcsc-form's
fill_plain, converts it, and skips when neither Word nor LibreOffice is available."""
from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / 'scripts'))
import assemble  # noqa: E402

BODY_FONT = str(SKILL / 'assets' / 'fonts' / 'LiberationSans-Regular.ttf')
PUBLISH = SKILL.parents[2] / 'publish' / 'subskills' / 'publish-bcsc-form'
WRITTEN, BLANK = 'October 2, 2026', '____________, 2026'
SIGNED = {'signing_date': '2026-10-05'}
# Line tops measured on the converted /publish Form 109; the ")" column sits at x 332.5.
TOPS = [558.8, 572.6, 586.4]
BRACKET_X = 332.5
BRACKETS = len(TOPS) + 4


def jurat_page(path: Path, lines, x=72, right=(), tops=TOPS, body=()) -> fitz.Document:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    for y0, text in body:
        page.insert_text((x, y0 + 11), text, fontsize=12)
    for y0, text in zip(tops, lines):
        page.insert_text((x, y0 + 11), text, fontsize=12)
    for y0 in tops + [tops[-1] + 13.8 * k for k in range(1, 5)]:
        page.insert_text((BRACKET_X, y0 + 11), ')', fontsize=12)
    for y0, text in right:
        page.insert_text((400, y0 + 11), text, fontsize=12)
    page.insert_text((74.4, 666), 'A Commissioner for taking Affidavits for British Columbia',
                     fontsize=10)
    doc.save(path)
    doc.close()
    return fitz.open(path)


def rewrite(tmp_path, verb, lines, **page):
    doc = jurat_page(tmp_path / 'jurat.pdf', lines, **page)
    result = assemble.rewrite_jurat(doc, {'jurat_verb': verb, **SIGNED}, BODY_FONT)
    text = doc[0].get_text().replace('\xa0', ' ')
    words = doc[0].get_text('words')
    doc.close()
    return result, text, words


def city_and_date_words(words):
    """The words other than ")" on the city and date lines' y-band."""
    return [w for w in words if TOPS[1] - 3 < (w[1] + w[3]) / 2 < TOPS[2] + 16
            and w[4] != ')']


@pytest.mark.parametrize('verb', ['AFFIRMED', 'SWORN'])
@pytest.mark.parametrize('date', [WRITTEN, BLANK])
@pytest.mark.parametrize('form, lines, city, rewritten', [
    ('109 /publish', ['{verb} BEFORE ME', 'at Vancouver,', 'British Columbia on {date}.'],
     'at ______________,', 'British Columbia on October 5, 2026.'),
    ('15/16', ['{verb} BEFORE ME', 'at Vancouver, British Columbia', 'on {date}.'],
     'at ______________,', 'British Columbia on October 5, 2026.'),
])
def test_prescribed_jurat_rewrites_with_a_written_or_blank_date(
        tmp_path, verb, date, form, lines, city, rewritten):
    result, text, _ = rewrite(tmp_path, verb,
                              [l.format(verb=verb, date=date) for l in lines])
    assert result == {'success': True}, form
    assert city in text and rewritten in text
    assert 'Vancouver' not in text and date not in text and 'day of' not in text
    assert text.count(')') == BRACKETS  # #1429: the redactions keep the bracket column


@pytest.mark.parametrize('date_line', ['this ____ day of ____________, 2026.',
                                       'this 1st day of June, 2026.'])
def test_leap_idiom_still_rewrites(tmp_path, date_line):
    result, text, _ = rewrite(tmp_path, 'AFFIRMED', [
        'AFFIRMED BEFORE ME at', 'Vancouver, Province of British Columbia,', date_line])
    assert result == {'success': True}
    assert '______________, Province of British Columbia,' in text
    assert 'this 5th day of October, 2026.' in text and date_line not in text
    assert text.count(')') == BRACKETS


# A short body can push the jurat to the top of its page (#1430).
@pytest.mark.parametrize('verb', ['AFFIRMED', 'SWORN'])
def test_jurat_at_the_top_of_its_page_rewrites(tmp_path, verb):
    result, text, _ = rewrite(tmp_path, verb, [
        f'{verb} BEFORE ME', 'at Vancouver,', f'British Columbia on {WRITTEN}.'],
        tops=[72, 85.8, 99.6])
    assert result == {'success': True}
    assert 'at ______________,' in text and 'British Columbia on October 5, 2026.' in text
    assert 'Vancouver' not in text and WRITTEN not in text


# The jurat verb in a body paragraph is not the jurat (#1430).
def test_jurat_verb_in_the_body_is_not_the_anchor(tmp_path):
    body = ['5. I rely on my affidavit sworn March 1, 2026.',
            '6. The meeting was at Vancouver, as stated.']
    result, text, _ = rewrite(tmp_path, 'SWORN', [
        'SWORN BEFORE ME', 'at Vancouver,', f'British Columbia on {WRITTEN}.'],
        body=list(zip([298, 312], body)))
    assert result == {'success': True}
    assert all(line in text for line in body)
    assert text.count('Vancouver') == 1
    assert 'at ______________,' in text and 'British Columbia on October 5, 2026.' in text


@pytest.mark.parametrize('lines', [
    ['AFFIRMED BEFORE ME', 'at Vancouver,', 'British Columbia on October 2, 2026.'],
    ['AFFIRMED BEFORE ME at', 'Vancouver, Province of British Columbia,',
     'this 1st day of June, 2026.'],
])
def test_right_column_text_on_the_rewritten_lines_survives(tmp_path, lines):
    result, text, _ = rewrite(tmp_path, 'AFFIRMED', lines,
                              right=[(TOPS[1], 'Signature of'), (TOPS[2], 'Jane Doe')])
    assert result == {'success': True}
    assert 'Signature of' in text and 'Jane Doe' in text
    assert text.count(')') == BRACKETS


# x 80 pushes the LEAP city line's rewrite (254pt at 12pt) past the bracket unless it is
# fitted, and the fit is reported as a warning.
@pytest.mark.parametrize('x, lines', [
    (72, ['AFFIRMED BEFORE ME', 'at Vancouver,', 'British Columbia on ____________, 2026.']),
    (72, ['AFFIRMED BEFORE ME at', 'Vancouver, Province of British Columbia,',
          'this ____ day of ____________, 2026.']),
    (80, ['AFFIRMED BEFORE ME at', 'Vancouver, Province of British Columbia,',
          'this 1st day of June, 2026.']),
])
def test_rewritten_text_ends_left_of_the_bracket(tmp_path, x, lines):
    result, text, words = rewrite(tmp_path, 'AFFIRMED', lines, x=x)
    assert result['success']
    assert ('jurat city line set at' in result.get('warning', '')) == (x == 80)
    rewritten = city_and_date_words(words)
    assert rewritten and min(w[0] for w in rewritten) == pytest.approx(x, abs=1)
    assert max(w[2] for w in rewritten) < BRACKET_X
    assert text.count(')') == BRACKETS


@pytest.mark.parametrize('verb, lines, check', [
    ('SWORN', ['AFFIRMED BEFORE ME', 'at Vancouver,', 'British Columbia on October 2, 2026.'],
     'verb'),
    ('AFFIRMED', ['AFFIRMED BEFORE ME'], 'city'),
    # The /publish Form 109 jurat before #1377: neither a "day of" nor an "on <date>" line.
    ('AFFIRMED', ['AFFIRMED BEFORE ME at the City of',
                  'Vancouver, Province of British Columbia,', 'this October 2, 2026.'], 'date'),
])
def test_failure_names_the_check(tmp_path, verb, lines, check):
    result, _, _ = rewrite(tmp_path, verb, lines)
    assert result == {'success': False, 'error': 'bbox_validation_failed',
                      'which': 'jurat', 'check': check}


@pytest.mark.parametrize('verb', ['AFFIRMED', 'SWORN'])
@pytest.mark.parametrize('date', [WRITTEN, BLANK])
def test_publish_form109_assembles(tmp_path, verb, date):
    pytest.importorskip('lxml')
    sys.path.insert(0, str(PUBLISH / 'scripts'))
    import fill_plain
    context = {
        'court_file_number': 'S-999999', 'registry': 'Vancouver',
        'plaintiff_caption': 'JANE DOE', 'plaintiff_role': 'PLAINTIFF',
        'defendant_caption': 'JOHN ROE', 'defendant_role': 'DEFENDANT',
        'deponent_name': 'Jane Doe', 'deponent_address': '1 Main Street, Vancouver, BC',
        'swear_or_affirm': 'SWEAR' if verb == 'SWORN' else 'AFFIRM',
        'sworn_or_affirmed': verb, 'affidavit_date': date,
        'commissioner_city': 'North Vancouver', 'affidavit_ordinal': '1st',
    }
    docx = tmp_path / 'affidavit.docx'
    fill_plain.fill(PUBLISH / 'templates' / 'affidavit.dotx', context, '', docx,
                    form='affidavit')
    probed = assemble.probe(str(docx))
    if probed.get('error') == 'docx_conversion_failed':
        pytest.skip(f"no Word or LibreOffice converter: {probed['detail']}")
    result = assemble.run_pipeline({
        'affiant_name': 'Jane Doe', 'affidavit_number': 1, 'jurat_verb': verb, **SIGNED,
        'affidavit_pdf': probed['converted_pdf'], 'header_bbox': probed['header_bbox'],
        'jurat_bbox': [72, 325, 340, 370], 'exhibits': [],
        'output_path': str(tmp_path / 'draft.pdf')})
    assert result['success'], result
    doc = fitz.open(result['output_path'])
    text = ' '.join(page.get_text() for page in doc).replace('\xa0', ' ')
    jurat = doc[assemble._find_jurat_page(doc, verb)]
    date_rect = jurat.search_for('British Columbia on October 5, 2026.')[0]
    brackets = [w for w in jurat.get_text('words') if w[4] == ')']
    doc.close()
    assert 'and was made on October 5, 2026' in text
    assert 'at ______________,' in text and 'British Columbia on October 5, 2026.' in text
    assert 'North Vancouver' not in text and date not in text
    assert any(date_rect.y0 < (w[1] + w[3]) / 2 < date_rect.y1 for w in brackets)
