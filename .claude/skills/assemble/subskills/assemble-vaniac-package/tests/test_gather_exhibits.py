"""gather_exhibits.py: page-range extraction, relative and absolute traces,
the named stops, and the no-op rerun."""
from __future__ import annotations

import json

import fitz
import pytest

from gather_exhibits import GatherError, exhibit_name, gather, parse_trace


def _run(p):
    return gather(p['index_json'], p['trace'], p['matter'], p['package'])


def test_parse_trace_reads_both_page_range_forms():
    traces = parse_trace('## Source trace\n\n'
                         '- Ex. 5 — a\\Notice.pdf (PDF pp. 6–84) <!-- document_id 3 -->\n'
                         '- Ex. 1 — b.pdf, PDF pp. 1-12 <!-- document_id 1 -->\n'
                         '- Ex. 2 — c.pdf, PDF p. 4\n'
                         '- Ex. 3 — d.pdf\n')
    assert traces == {5: ('a\\Notice.pdf', (6, 84)), 1: ('b.pdf', (1, 12)),
                      2: ('c.pdf', (4, 4)), 3: ('d.pdf', None)}


def test_parse_trace_ignores_lines_outside_the_section():
    assert parse_trace('- Ex. 1 — x.pdf\n\n## Source trace\n\n- Ex. 2 — y.pdf\n') == {2: ('y.pdf', None)}


def test_exhibit_name_drops_characters_windows_forbids():
    assert exhibit_name(3, 'Letter: "final" demand?', '.PDF') == 'Exhibit 3 - Letter final demand.pdf'


def test_exhibit_name_cuts_a_long_description_at_a_word():
    name = exhibit_name(12, 'Letter from counsel to the Respondent, enclosing the statement of account', '.pdf', 50)
    assert name == 'Exhibit 12 - Letter from counsel to the.pdf'
    assert len(name) <= 50
    with pytest.raises(GatherError) as err:
        exhibit_name(12, 'Letter', '.pdf', 15)
    assert err.value.code == 'path_too_long'


def test_gather_copies_and_extracts(published):
    steps = _run(published)
    assert [s['action'] for s in steps] == ['extract', 'copy', 'copy', 'extract']
    names = sorted(p.name for p in published['package'].glob('Exhibit *'))
    assert names == ['Exhibit 1 - The signed agreement, s. 2.3 at issue.pdf',
                     'Exhibit 2 - (not recorded).pdf',
                     'Exhibit 3 - Daily entries for the final week of the project.png',
                     'Exhibit 4 - Delivery log for the final week of the project.pdf']
    with fitz.open(published['package'] / names[0]) as doc:
        assert [p.get_text().strip() for p in doc] == ['AGREEMENT-P3', 'AGREEMENT-P4', 'AGREEMENT-P5']


def test_gather_again_is_a_no_op(published):
    _run(published)
    before = {p.name: p.stat().st_mtime_ns for p in published['package'].iterdir()}
    steps = _run(published)
    assert {s['action'] for s in steps} == {'already_present'}
    assert {p.name: p.stat().st_mtime_ns for p in published['package'].iterdir()} == before


def test_trace_inside_package_is_left_in_place(published):
    package = published['package']
    moved = package / 'Exhibit 2 - Notice as sent.pdf'
    (published['matter'] / '3. DISCLOSURE' / 'Notice.pdf').rename(moved)
    trace = published['trace']
    trace.write_text(trace.read_text(encoding='utf-8').replace('3. DISCLOSURE\\Notice.pdf', str(moved)),
                     encoding='utf-8')
    steps = _run(published)
    assert steps[1] == {'number': 2, 'action': 'already_present', 'path': str(moved)}
    assert not list(package.glob('Exhibit 2 - (not recorded)*'))


def test_missing_trace_stops_and_names_the_exhibit(published):
    trace = published['trace']
    text = trace.read_text(encoding='utf-8').splitlines()
    trace.write_text('\n'.join(line for line in text if not line.startswith('- Ex. 3')) + '\n', encoding='utf-8')
    with pytest.raises(GatherError) as err:
        _run(published)
    assert err.value.code == 'exhibit_unresolved'
    assert 'Ex. 3: no traced path' in err.value.detail
    assert not list(published['package'].glob('Exhibit *'))


def test_bad_page_range_and_missing_file_stop(published):
    trace = published['trace']
    trace.write_text(trace.read_text(encoding='utf-8')
                     .replace('(PDF pp. 3–5)', '(PDF pp. 10–20)')
                     .replace('Notice.pdf', 'Gone.pdf')
                     .replace('Photo.png', 'Photo.png, PDF pp. 1-2'), encoding='utf-8')
    with pytest.raises(GatherError) as err:
        _run(published)
    assert 'Ex. 1: pages 10-20 of Agreement.pdf, which has 12' in err.value.detail
    assert 'Ex. 2:' in err.value.detail and 'Gone.pdf does not exist' in err.value.detail
    assert 'Ex. 3: a page range on a non-PDF file' in err.value.detail


def test_unlisted_trace_is_refused(published):
    trace = published['trace']
    trace.write_text(trace.read_text(encoding='utf-8') + '- Ex. 9 — 3. DISCLOSURE\\Log.pdf\n', encoding='utf-8')
    with pytest.raises(GatherError) as err:
        _run(published)
    assert err.value.code == 'trace_not_in_index'
    assert json.loads(published['index_json'].read_text(encoding='utf-8'))['exhibits'][-1]['number'] == 4
