"""Write scripts/paginate_record.py's manifest for one BCSC application record.

Orders the caller's documents by Rule 8-1 (15) (b) and (c) as amended by
B.C. Reg. 105/2026, and refuses what (15) (d) keeps out of a record.
Grammar and error codes: references/record-binding-contract.md "Record manifest builder".

Usage:
    python record_manifest.py <documents .json> <cover .pdf> <output .pdf> <manifest .json>

Prints one JSON line: {"success": true, "manifest": ..., "tabs": [{"tab", "title", "kind", "path"}]}
or {"success": false, "error": "<code>", "detail": "..."}. Exit 0 on success,
non-zero otherwise.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Each kind a record may hold, in the order Rule 8-1 (15) (b) and (c) bind them.
ORDER = (
    ('notice_of_application', '8-1 (15) (b) (iii)'),
    ('application_response', '8-1 (15) (b) (iv)'),
    ('filed_evidence', '8-1 (15) (b) (v)'),
    ('respondent_evidence', '8-1 (15) (b) (v.1)'),
    ('pleading', '8-1 (15) (b) (vi)'),
    ('draft_order', '8-1 (15) (c) (i)'),
    ('written_argument', '8-1 (15) (c) (ii)'),
    ('list_of_authorities', '8-1 (15) (c) (iii)'),
    ('draft_bill_of_costs', '8-1 (15) (c) (iv)'),
    ('other_by_consent', '8-1 (15) (d) (iii)'),
)
REFUSED = {
    'affidavit_of_service': '8-1 (15) (d) (i)',
    'authority': '8-1 (15) (d) (ii)',
}
_RANK = {kind: i for i, (kind, _) in enumerate(ORDER)}
_DOC_KEYS = {'kind', 'title', 'path'}


class ManifestError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


def build_manifest(spec: dict, cover: Path, output: Path) -> dict:
    if not isinstance(spec, dict) or set(spec) != {'rule_9_7', 'documents'} \
            or not isinstance(spec['rule_9_7'], bool) or not isinstance(spec['documents'], list):
        raise ManifestError('bad_documents', 'documents file must be {"rule_9_7": true | false, "documents": [...]}')
    docs = spec['documents']
    for doc in docs:
        if not isinstance(doc, dict) or not _DOC_KEYS <= set(doc) <= _DOC_KEYS | {'consent'} \
                or not all(isinstance(doc[k], str) and doc[k].strip() for k in _DOC_KEYS):
            raise ManifestError('bad_documents', f'each document needs kind, title and path, and optionally consent: {doc!r}')
        kind = doc['kind']
        if kind in REFUSED:
            raise ManifestError('refused_document',
                                f'{doc["title"]!r} is a {kind}, which Rule {REFUSED[kind]} keeps out of an application record')
        if kind not in _RANK:
            raise ManifestError('unknown_kind', f'{doc["title"]!r} has kind {kind!r}; known kinds: {[k for k, _ in ORDER]}')
        if kind == 'pleading' and not spec['rule_9_7']:
            raise ManifestError('pleading_without_9_7',
                                f'{doc["title"]!r}: a pleading goes under (15) (b) (vi) only on a Rule 9-7 application; '
                                'a pleading relied on is filed_evidence under (15) (b) (v)')
        if kind == 'other_by_consent' and doc.get('consent') is not True:
            raise ManifestError('consent_required',
                                f'{doc["title"]!r} is in the record only with the consent of all parties of record '
                                '(Rule 8-1 (15) (d) (iii)); set "consent": true once they have consented')
        if Path(doc['path']).suffix.lower() != '.pdf':
            raise ManifestError('bad_documents', f'{doc["title"]!r} path must be a .pdf: {doc["path"]}')
    notices = [d for d in docs if d['kind'] == 'notice_of_application']
    if len(notices) != 1:
        raise ManifestError('notice_count', f'a record holds exactly one filed notice of application; found {len(notices)}')
    if cover.suffix.lower() != '.pdf':
        raise ManifestError('bad_documents', f'cover must be the Form 30.001 cover saved as a .pdf: {cover}')
    ordered = sorted(docs, key=lambda d: _RANK[d['kind']])  # stable: caller order within a kind
    return {
        'cover': str(cover),
        'tabs': [{'tab': i, 'title': d['title'], 'kind': d['kind'], 'path': d['path']}
                 for i, d in enumerate(ordered, 1)],
        'output': str(output),
        'index_output': str(output.with_name(f'{output.stem} - Index{output.suffix}')),
    }


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    documents, cover, output, manifest_path = sys.argv[1:]
    try:
        try:
            spec = json.loads(Path(documents).read_text(encoding='utf-8'))
        except json.JSONDecodeError as e:
            raise ManifestError('bad_documents', f'documents file is not valid JSON: {e}')
        manifest = build_manifest(spec, Path(cover), Path(output))
    except ManifestError as e:
        print(json.dumps({'success': False, 'error': e.code, 'detail': e.detail}))
        return 1
    Path(manifest_path).write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'success': True, 'manifest': manifest_path, 'tabs': manifest['tabs']}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
