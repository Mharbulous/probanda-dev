"""inspect_exhibits.py refuses with missing_dependency, naming the module, where PyMuPDF is absent,
not with unexpected_exception (#1378)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'


def test_inspect_refuses_without_pymupdf(tmp_path):
    blocker = tmp_path / 'blocker'
    blocker.mkdir()
    (blocker / 'pymupdf.py').write_text(
        "raise ModuleNotFoundError(\"No module named 'pymupdf'\", name='pymupdf')\n", encoding='utf-8')
    exhibits = tmp_path / 'exhibits'
    exhibits.mkdir()
    (exhibits / 'Exhibit A.pdf').write_bytes(b'%PDF-1.4\n')
    payload = tmp_path / 'in.json'
    payload.write_text(json.dumps({'exhibit_dirs': [str(exhibits)], 'png_out_dir': str(tmp_path / 'png')}),
                       encoding='utf-8')
    env = {**os.environ, 'PYTHONPATH': str(blocker)}
    result = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'inspect_exhibits.py'), str(payload)],
                            capture_output=True, text=True, env=env)
    out = json.loads(result.stdout)
    assert result.returncode == 1
    assert out['error'] == 'missing_dependency'
    assert 'pymupdf' in out['detail']
