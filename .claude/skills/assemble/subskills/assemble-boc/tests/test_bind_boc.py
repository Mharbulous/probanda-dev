"""bind_boc.py: the bound bill is written beside the bill, at the draft folder's root, and a
re-bind never overwrites: it takes v(highest + 1) and names the copy it passed over (#1324).
Every bind removes its bindboc_ work folder, whether it succeeds or refuses (#1338)."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

import bind_boc  # noqa: E402
from bind_boc import BindError, BookError, bind  # noqa: E402

STEM = '2026-10-01 BOC Smith J'


def pdf(path: Path, labels: list[str]) -> Path:
    doc = fitz.open()
    for text in labels:
        doc.new_page(width=612, height=792).insert_text((72, 400), text, fontsize=14)
    doc.save(path)
    doc.close()
    return path


def texts(path: Path) -> list[str]:
    with fitz.open(path) as doc:
        return [page.get_text().strip() for page in doc]


@pytest.fixture(autouse=True)
def temp_root(tmp_path, monkeypatch):
    """Work folders go to a fresh folder per test, never the real temp directory."""
    root = tmp_path / 'temp'
    root.mkdir()
    monkeypatch.setattr(tempfile, 'tempdir', str(root))
    return root


def work_dirs(temp_root: Path) -> list[str]:
    return [p.name for p in temp_root.glob('bindboc_*')]


@pytest.fixture
def bill(tmp_path, monkeypatch):
    """A bill .docx at the draft root, Word stood in for, and one voucher outside it."""
    draft = tmp_path / '0. DRAFT'
    draft.mkdir()
    docx = draft / f'{STEM}.docx'
    docx.write_bytes(b'stand-in')
    monkeypatch.setattr(bind_boc, 'convert_docx_to_pdf',
                        lambda docx_path, pdf_path: pdf(pdf_path, ['BILL-1']))
    voucher = pdf(tmp_path / 'filing fee.pdf', ['VOUCHER-1'])
    manifest = {'bill_docx': str(docx), 'bill_pdf': None, 'output': None, 'lines': [
        {'description': 'Court filing fee', 'claimed': '200.00', 'voucher': str(voucher)}]}
    return draft, manifest


def test_rebinds_write_v2_then_v3_beside_the_bill_and_leave_nothing_else(bill):
    draft, manifest = bill
    first = draft / f'{STEM} - bound.pdf'
    result = bind(manifest)
    assert result['output'] == str(first)
    assert 'versioned_from' not in result
    assert texts(first) == ['BILL-1', 'VOUCHER-1']
    original = first.read_bytes()

    v2 = draft / f'{STEM} - bound v2.pdf'
    v3 = draft / f'{STEM} - bound v3.pdf'
    for path, prior in ((v2, first), (v3, v2)):
        result = bind(manifest)
        assert result['output'] == str(path)
        assert result['versioned_from'] == str(prior)

    assert first.read_bytes() == original
    assert sorted(p.name for p in draft.iterdir()) == sorted(
        [f'{STEM}.docx', first.name, v2.name, v3.name])


def test_a_saved_bill_pdf_is_bound_and_named_from(bill):
    draft, manifest = bill
    saved = pdf(draft / f'{STEM}.pdf', ['SAVED-1'])
    result = bind({**manifest, 'bill_pdf': str(saved)})
    assert result['output'] == str(draft / f'{STEM} - bound.pdf')
    assert texts(Path(result['output'])) == ['SAVED-1', 'VOUCHER-1']


def test_an_output_in_a_missing_folder_is_refused_and_not_created(bill):
    draft, manifest = bill
    missing = draft / 'BOC Smith J'
    with pytest.raises(BindError) as caught:
        bind({**manifest, 'output': str(missing / 'bound.pdf')})
    assert caught.value.code == 'no_out_dir'
    assert not missing.exists()


def test_a_successful_bind_leaves_no_work_folder(bill, temp_root):
    _, manifest = bill
    bind(manifest)
    assert work_dirs(temp_root) == []


def test_a_missing_output_folder_leaves_no_work_folder(bill, temp_root):
    draft, manifest = bill
    with pytest.raises(BindError):
        bind({**manifest, 'output': str(draft / 'missing' / 'bound.pdf')})
    assert work_dirs(temp_root) == []


def test_an_existing_output_leaves_no_work_folder(bill, temp_root, monkeypatch):
    draft, manifest = bill
    taken = pdf(draft / 'taken.pdf', ['TAKEN'])
    monkeypatch.setattr(bind_boc, '_next_version', lambda out_path: (taken, None))
    with pytest.raises(BindError) as caught:
        bind(manifest)
    assert caught.value.code == 'output_exists'
    assert work_dirs(temp_root) == []


def test_a_failed_bill_conversion_leaves_no_work_folder(bill, temp_root, monkeypatch):
    _, manifest = bill

    def fail(docx_path, pdf_path):
        pdf_path.write_bytes(b'partial')
        raise BookError('conversion_failed', 'Word refused')

    monkeypatch.setattr(bind_boc, 'convert_docx_to_pdf', fail)
    with pytest.raises(BookError):
        bind(manifest)
    assert work_dirs(temp_root) == []


def test_a_failed_voucher_conversion_leaves_no_work_folder(bill, temp_root, monkeypatch, tmp_path):
    _, manifest = bill
    voucher = tmp_path / 'receipt.docx'
    voucher.write_bytes(b'stand-in')

    def convert(docx_path, pdf_path):
        if docx_path == voucher:
            pdf_path.write_bytes(b'partial')
            raise BookError('conversion_failed', 'Word refused')
        return pdf(pdf_path, ['BILL-1'])

    monkeypatch.setattr(bind_boc, 'convert_docx_to_pdf', convert)
    with pytest.raises(BookError):
        bind({**manifest, 'lines': [{'description': 'Receipt', 'voucher': str(voucher)}]})
    assert work_dirs(temp_root) == []


def run_main(monkeypatch, capsys, manifest_path: Path) -> tuple[int, list[str]]:
    monkeypatch.setattr(sys, 'argv', ['bind_boc.py', '--vouchers', str(manifest_path)])
    code = bind_boc.main()
    return code, capsys.readouterr().out.splitlines()


@pytest.mark.parametrize('content', [None, '{not json', b'\xff\xfe\x9c'])
def test_a_missing_or_invalid_manifest_is_manifest_unreadable(tmp_path, monkeypatch, capsys, content):
    path = tmp_path / 'vouchers.json'
    if isinstance(content, bytes):
        path.write_bytes(content)
    elif content is not None:
        path.write_text(content, encoding='utf-8')
    code, lines = run_main(monkeypatch, capsys, path)
    assert code == 1 and len(lines) == 1
    assert json.loads(lines[0])['error'] == 'manifest_unreadable'


@pytest.mark.parametrize('exc', [PermissionError(13, 'Permission denied'), RuntimeError('defect')])
def test_an_unexpected_bind_failure_is_one_internal_error_line(tmp_path, monkeypatch, capsys, exc):
    path = tmp_path / 'vouchers.json'
    path.write_text('{}', encoding='utf-8')

    def fail(*args):
        raise exc

    monkeypatch.setattr(bind_boc, 'bind', fail)
    code, lines = run_main(monkeypatch, capsys, path)
    assert code == 1 and len(lines) == 1
    out = json.loads(lines[0])
    assert out['error'] == 'internal_error'
    assert out['detail'] == repr(exc) and out['trace']


@pytest.mark.parametrize('exc', [BindError('output_exists', 'taken'), BookError('conversion_failed', 'Word refused')])
def test_a_bind_refusal_keeps_its_own_code(tmp_path, monkeypatch, capsys, exc):
    path = tmp_path / 'vouchers.json'
    path.write_text('{}', encoding='utf-8')

    def fail(*args):
        raise exc

    monkeypatch.setattr(bind_boc, 'bind', fail)
    code, lines = run_main(monkeypatch, capsys, path)
    assert code == 1
    assert json.loads(lines[0]) == {'success': False, 'error': exc.code, 'detail': exc.detail}
