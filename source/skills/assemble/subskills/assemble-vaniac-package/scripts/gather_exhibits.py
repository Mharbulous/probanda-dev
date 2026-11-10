"""Gather a VanIAC package's exhibits into its Package folder.

Usage:
    python gather_exhibits.py --index-json <Package index.json> --evidence-index <mockup Evidence Index.md>
                              --matter-root <dir> --package-dir <Package dir>

The exhibits to gather are the rows of `Package index.json` (written by
/publish with publish-vaniac-package from the filed render). Each one's file
comes from the mockup Evidence Index's Source trace, which the filed render
leaves out: `- Ex. N — <path>[, PDF pp. A-B]`. Each lands in the Package
folder as `Exhibit N - <description>.<ext>`; a traced page range is extracted
alone. A relative path resolves against the matter root. A traced file
already inside the Package folder, or an exhibit whose file is already
there, is left alone, so the step is safe to run again. Nothing unlisted is
copied, and nothing is overwritten.

Every exhibit is checked before any file is copied. An exhibit with no
traced path, a missing file, or a bad page range stops the run and is named.

Prints one JSON line: {"success": true, "exhibits": [...]} or
{"success": false, "error": "<code>", "detail": "..."}. Exit 0 on success,
1 on a refusal.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import traceback
from pathlib import Path

try:
    import pymupdf as fitz
except ImportError as exc:  # refuse in this script's JSON contract, not as a traceback
    print(json.dumps({'success': False, 'error': 'missing_dependency', 'detail': (
        f"{exc.name or exc} is not installed. This script runs on the PC, in a Claude Code "
        "session in the desktop app's Code tab, where the Probanda plugin is installed "
        "-- not in a Cowork cloud sandbox, which has no PyMuPDF and blocks pypi. "
        "On the PC, install it: "
        "pip install PyMuPDF")}))
    sys.exit(1)

TRACE = re.compile(r'^- Ex\. (\d+) — (.+?)\s*(?:<!--.*-->)?\s*$')
PAGE_RANGE = re.compile(r'^(.*?)(?:,\s*|\s*\()PDF pp?\.\s*(\d+)(?:\s*[-–]\s*(\d+))?\)?\s*$')
FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
# Windows: 255 characters per name, and Word and Explorer open nothing past 259 in all.
MAX_NAME, MAX_PATH = 255, 259


class GatherError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


def parse_trace(text: str) -> dict[int, tuple[str, tuple[int, int] | None]]:
    """{exhibit number: (path, (first, last) 1-based page range or None)}."""
    traces = {}
    in_section = False
    for line in text.splitlines():
        if line.startswith('#'):
            in_section = line.strip() == '## Source trace'
            continue
        match = TRACE.match(line) if in_section else None
        if not match:
            continue
        number, target = int(match.group(1)), match.group(2).strip()
        pages = None
        ranged = PAGE_RANGE.match(target)
        if ranged:
            target = ranged.group(1).strip()
            first = int(ranged.group(2))
            pages = (first, int(ranged.group(3) or first))
        traces[number] = (target, pages)
    return traces


def exhibit_name(number: int, description: str, suffix: str, room: int = MAX_NAME) -> str:
    """`Exhibit N - <description>.<ext>`, the description cut at a word boundary
    when the name would run past `room` characters. The full description stays
    on the index and the divider page; the pre-filing gate reads only the
    `Exhibit N` prefix."""
    head, suffix = f'Exhibit {number} - ', suffix.lower()
    clean = FORBIDDEN.sub('', description).strip().rstrip('. ')
    if len(head) + len(clean) + len(suffix) > room:
        cut = clean[:max(room - len(head) - len(suffix), 0) + 1]
        clean = cut.rsplit(' ', 1)[0] if ' ' in cut else ''
        clean = clean.rstrip(' .,;:-–—(')
    if not clean:
        raise GatherError('path_too_long', f'Ex. {number}: the Package folder path leaves no room for its file name')
    return f'{head}{clean}{suffix}'


def _inside(path: Path, folder: Path) -> bool:
    try:
        path.resolve().relative_to(folder.resolve())
        return True
    except ValueError:
        return False


def plan(exhibits: list[dict], traces: dict, matter_root: Path, package_dir: Path) -> list[dict]:
    listed = {x['number'] for x in exhibits}
    stray = sorted(set(traces) - listed)
    if stray:
        raise GatherError('trace_not_in_index', f'the Source trace names exhibits the filed index does not: {stray}')
    steps, problems = [], []
    for x in exhibits:
        n = x['number']
        present = sorted(package_dir.glob(f'Exhibit {n} - *')) if package_dir.is_dir() else []
        if n not in traces:
            if present:
                steps.append({'number': n, 'action': 'already_present', 'path': str(present[0])})
            else:
                problems.append(f'Ex. {n}: no traced path')
            continue
        target, pages = traces[n]
        # Traces are recorded with Windows separators; '/' reads on every host.
        source = Path(target.replace('\\', '/'))
        if not source.is_absolute():
            source = matter_root / source
        if _inside(source, package_dir) and source.is_file():
            steps.append({'number': n, 'action': 'already_present', 'path': str(source)})
            continue
        if present:
            steps.append({'number': n, 'action': 'already_present', 'path': str(present[0])})
            continue
        if not source.is_file():
            problems.append(f'Ex. {n}: {source} does not exist')
            continue
        if pages:
            if source.suffix.lower() != '.pdf':
                problems.append(f'Ex. {n}: a page range on a non-PDF file, {source.name}')
                continue
            with fitz.open(source) as doc:
                count = doc.page_count
            if not 1 <= pages[0] <= pages[1] <= count:
                problems.append(f'Ex. {n}: pages {pages[0]}-{pages[1]} of {source.name}, which has {count}')
                continue
        room = min(MAX_NAME, MAX_PATH - len(str(package_dir.resolve())) - 1)
        try:
            dest = package_dir / exhibit_name(n, x['description'], source.suffix, room)
        except GatherError as e:
            problems.append(e.detail)
            continue
        steps.append({'number': n, 'action': 'extract' if pages else 'copy', 'source': str(source),
                      'pages': list(pages) if pages else None, 'path': str(dest)})
    if problems:
        raise GatherError('exhibit_unresolved', '; '.join(problems))
    return steps


def gather(index_json: Path, evidence_index: Path, matter_root: Path, package_dir: Path) -> list[dict]:
    data = json.loads(index_json.read_text(encoding='utf-8'))
    traces = parse_trace(evidence_index.read_text(encoding='utf-8'))
    steps = plan(data['exhibits'], traces, matter_root, package_dir)
    package_dir.mkdir(parents=True, exist_ok=True)
    for step in steps:
        if step['action'] == 'copy':
            shutil.copy2(step['source'], step['path'])
        elif step['action'] == 'extract':
            first, last = step['pages']
            out = fitz.open()
            with fitz.open(step['source']) as src:
                out.insert_pdf(src, from_page=first - 1, to_page=last - 1)
            out.save(step['path'], garbage=3, deflate=True)
            out.close()
    return steps


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--index-json', type=Path, required=True)
    parser.add_argument('--evidence-index', type=Path, required=True)
    parser.add_argument('--matter-root', type=Path, required=True)
    parser.add_argument('--package-dir', type=Path, required=True)
    args = parser.parse_args()
    try:
        steps = gather(args.index_json, args.evidence_index, args.matter_root, args.package_dir)
    except GatherError as e:
        print(json.dumps({'success': False, 'error': e.code, 'detail': e.detail}, ensure_ascii=False))
        return 1
    except Exception as e:  # a defect, reported as one JSON line rather than a traceback
        print(json.dumps({'success': False, 'error': 'internal_error', 'detail': f'{e!r}',
                          'trace': traceback.format_exc()}))
        return 1
    print(json.dumps({'success': True, 'exhibits': steps}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
