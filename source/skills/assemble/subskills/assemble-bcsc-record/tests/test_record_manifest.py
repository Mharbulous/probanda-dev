"""record_manifest.py: the Rule 8-1 (15) (b) order, and the refusals."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

from record_manifest import ManifestError, build_manifest  # noqa: E402

SCRIPT = Path(__file__).resolve().parent.parent / 'scripts' / 'record_manifest.py'


def _doc(kind: str, title: str, **extra) -> dict:
    return {'kind': kind, 'title': title, 'path': f'{title}.pdf', **extra}


def _build(docs, rule_9_7=False):
    return build_manifest({'rule_9_7': rule_9_7, 'documents': docs}, Path('cover.pdf'), Path('out/Record.pdf'))


def test_orders_by_the_rule_keeping_caller_order_within_a_kind():
    manifest = _build([
        _doc('draft_order', 'Draft order'),
        _doc('respondent_evidence', 'Affidavit #1 of Roe'),
        _doc('filed_evidence', 'Affidavit #2 of Doe'),
        _doc('application_response', 'Response of Roe'),
        _doc('filed_evidence', 'Affidavit #1 of Doe'),
        _doc('notice_of_application', 'Notice of application'),
        _doc('other_by_consent', 'Agreed chronology', consent=True),
    ])
    assert [(t['tab'], t['title']) for t in manifest['tabs']] == [
        (1, 'Notice of application'),
        (2, 'Response of Roe'),
        (3, 'Affidavit #2 of Doe'),
        (4, 'Affidavit #1 of Doe'),
        (5, 'Affidavit #1 of Roe'),
        (6, 'Draft order'),
        (7, 'Agreed chronology'),
    ]
    assert manifest['index_output'] == str(Path('out/Record - Index.pdf'))


def test_pleadings_follow_respondent_evidence_on_a_9_7_application():
    manifest = _build([
        _doc('pleading', 'Notice of civil claim'),
        _doc('respondent_evidence', 'Affidavit of Roe'),
        _doc('notice_of_application', 'Notice'),
    ], rule_9_7=True)
    assert [t['kind'] for t in manifest['tabs']] == ['notice_of_application', 'respondent_evidence', 'pleading']


@pytest.mark.parametrize('kind', ['affidavit_of_service', 'authority'])
def test_refuses_what_15_d_keeps_out(kind):
    with pytest.raises(ManifestError) as e:
        _build([_doc('notice_of_application', 'Notice'), _doc(kind, 'X')])
    assert e.value.code == 'refused_document'


@pytest.mark.parametrize('docs, rule_9_7, code', [
    ([_doc('notice_of_application', 'N'), _doc('pleading', 'NOCC')], False, 'pleading_without_9_7'),
    ([_doc('notice_of_application', 'N'), _doc('other_by_consent', 'X')], False, 'consent_required'),
    ([_doc('notice_of_application', 'N'), _doc('exhibit', 'X')], False, 'unknown_kind'),
    ([_doc('filed_evidence', 'A')], False, 'notice_count'),
    ([_doc('notice_of_application', 'N'), _doc('notice_of_application', 'M')], False, 'notice_count'),
    ([{'kind': 'notice_of_application', 'title': 'N', 'path': 'N.docx'}], False, 'bad_documents'),
    ([{'kind': 'notice_of_application', 'title': 'N'}], False, 'bad_documents'),
])
def test_rejections(docs, rule_9_7, code):
    with pytest.raises(ManifestError) as e:
        _build(docs, rule_9_7)
    assert e.value.code == code


def test_cli_writes_the_manifest(tmp_path):
    spec = tmp_path / 'documents.json'
    spec.write_text(json.dumps({'rule_9_7': False, 'documents': [_doc('notice_of_application', 'Notice')]}),
                    encoding='utf-8')
    manifest = tmp_path / 'manifest.json'
    proc = subprocess.run([sys.executable, str(SCRIPT), str(spec), 'cover.pdf', 'Record.pdf', str(manifest)],
                          capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert json.loads(proc.stdout)['success'] is True
    assert json.loads(manifest.read_text(encoding='utf-8'))['tabs'][0]['title'] == 'Notice'
