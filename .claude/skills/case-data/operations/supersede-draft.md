# Operation: supersede-draft

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `coclerk.json` only to confirm initialization; halt on any tool error per §2.3.

Internal. Reached from [`ingest.md`](ingest.md) (a file with no hash match, a match carrying `SUPERSEDE-PENDING:`, or, for §6c, a superseded match whose file was not moved), [`extract-facts.md`](extract-facts.md) §3b, and [`ingest-unattended.md`](ingest-unattended.md).

An unsigned draft, a signed copy and the filed copy of one court document have three different hashes, so ingest would read each in full and register three sources. This operation treats the less complete copy as a draft of the operative one:

- it keeps the operative copy as the source of record, **K**;
- it re-points the draft's rows onto K, changing each row's `source_id`, or `fact_id` when a fact is folded, so it refers to K or a fact on K;
- it moves the draft file into `0. DRAFT*\Superseded\` and records it as superseded, **S**.

Nothing is deleted. S keeps its own hash, which is how a re-presented copy of the moved file is recognised. The decisions behind this file are `../references/design-decisions.md` #64.

The deterministic steps are the fenced functions below. [`../references/scripts/supersede_draft.py`](../references/scripts/supersede_draft.py) runs the same functions from this file as a command-line tool; the markdown stays their single source.

---

## Input

| Field | Meaning |
|---|---|
| `matter_root`, `matter_folder` | as [`ingest-status.md`](ingest-status.md) takes them |
| `mode` | `attended` (the practitioner is present: [`ingest.md`](ingest.md), [`extract-facts.md`](extract-facts.md)) or `unattended` ([`ingest-unattended.md`](ingest-unattended.md)) |
| `newcomers` | files with no row yet, each `{path, hash}`, `path` in stored form (conventions §2.4) |
| `scan_folder` | the folder the caller is working in, in stored form: the scanned folder, or for one file its first path segment |
| `pair` | instead of the above, a pair the caller already holds: the two `source_id`s a `SUPERSEDE-PENDING:` marker names |

## Output, one entry per pair

| Field | Meaning |
|---|---|
| `outcome` | `superseded` (applied), `not_version` (`[NOT-VERSION-OF:]` written), `pending` (unattended: marker written), `declined` (the practitioner gave no answer) |
| `kept`, `superseded` | the two `source_id`s, after any insert |
| `basis` | the rank basis (§3), or for `not_version` the differences the strict comparison found (§2) |
| `counts` | facts moved and folded; children re-parented and matched; rows retired as duplicates |
| `moved_to` | the superseded file's new stored path, or the move tool's refusal word for word |

A newcomer that ends in `superseded` is held: as K, its facts arrived from S; as S, K's facts stand for it. The caller never extracts it, except the kept copy of a pair of two newcomers, which is extracted once (§6, "Two newcomers"). A newcomer in any other outcome goes on to [`ingest-extract.md`](ingest-extract.md) as before.

---

## §1 Candidates

A cheap deterministic pass decides which pairs get the page comparison. Read the registered top-level court rows with one `case_data__query` call:

```sql
-- supersede-draft candidates probe
SELECT source_id, proceeding_id, title, file_path, notes
FROM main.sources
WHERE parent_source_id IS NULL
  AND category = 'court'
  AND instr(coalesce(notes, ''), '[SUPERSEDED-BY:#') = 0
ORDER BY source_id;
```

Read each PDF's page count with `references/scripts/extract_outline.py <path>` (its output carries `pages`), for every newcomer and every registered row under `scan_folder`. A script error leaves that file's count unknown. Then run `candidates`. Two files are a pair when all of these hold:

- **Same proceeding.** Two registered rows: equal, non-null `proceeding_id`. A newcomer and a registered row, or two newcomers: the same `5. COURT…` folder (first path segment).
- **Similar title**, compared on each file's title stem: the file name, lower-cased, with dates and the whole words DRAFT, SIGNED, UNSIGNED, EXECUTED, FILED, AFFIRMED and UNFILED stripped, and every run of other characters collapsed to one space. A word is stripped only whole, so `unsigned` never leaves `un`. The two stems need not be equal, because two copies of one document are often named by hand, with a filler word, an abbreviation or a typo in one of them. `same_title` compares them in three steps:
  - Each stem is split into words. A document code in the list below is replaced by its meaning, and the filler words `of`, `re`, `the`, `and`, `to` and `for` are dropped. The list is a short copy of the court document codes in `file-naming/references/code-registry.md`, which stays their source; it sits here because `candidates` runs from this fenced code alone.
  - The numbers in the two names must be the same. `AFF#1` and `AFF#2` are never a pair, and neither are a numbered name and one with no number.
  - The remaining words are compared as two sets. Two words match when they are equal, or when both have 6 or more letters and differ by at most 2 single-letter edits (a typo). The titles are similar when the matched words are at least 0.6 of all the distinct words in the two names.
- **Page counts within 2**, when both files are PDFs with a known count.
- **No marker**: neither registered row carries `[SUPERSEDED-BY:#` or `[NOT-VERSION-OF:#` naming the other. The markers are the cache: a decided pair is never assessed again.

```python
import os
import re

_STEM_DATE = re.compile(r'\d{4}[-._ ]?\d{2}[-._ ]?\d{2}')
_STEM_TOKEN = re.compile(r'\b(?:draft|signed|unsigned|executed|filed|affirmed|unfiled)\b')
_COURT_FOLDER = re.compile(r'^5\. COURT', re.I)


def title_stem(path):
    name = os.path.splitext(path.replace('/', '\\').split('\\')[-1])[0].lower()
    name = re.sub(r'[^0-9a-z]+', ' ', _STEM_DATE.sub(' ', name))
    return ' '.join(_STEM_TOKEN.sub(' ', name).split())


_FILLER = frozenset(('of', 're', 'the', 'and', 'to', 'for'))
_CODES = {
    'aff': 'affidavit',
    'ar': 'application response',
    'dj': 'default judgment',
    'noa': 'notice of application',
    'nocc': 'notice of civil claim',
    'noh': 'notice of hearing',
    'ordr': 'order',
    'pet': 'petition',
    'req': 'requisition',
    'rnocc': 'response to civil claim',
    'rtp': 'response to petition',
}


def _edits(a, b):
    """The number of single-letter insertions, deletions and substitutions between two words."""
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        diagonal, row[0] = row[0], i
        for j, y in enumerate(b, 1):
            diagonal, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, diagonal + (x != y))
    return row[-1]


def title_words(path):
    """The numbers and the other words of a title stem, codes expanded and filler words dropped."""
    numbers, words = set(), set()
    for token in title_stem(path).split():
        for word in _CODES.get(token, token).split():
            if word.isdigit():
                numbers.add(int(word))
            elif word not in _FILLER:
                words.add(word)
    return numbers, words


def same_title(a, b):
    """Whether two file names are similar enough to be two copies of one document."""
    (numbers_a, words_a), (numbers_b, words_b) = title_words(a), title_words(b)
    if numbers_a != numbers_b:
        return False
    matched = len(words_a & words_b)
    unmatched = sorted(words_b - words_a)
    for word in sorted(words_a - words_b):
        near = next((other for other in unmatched
                     if len(word) >= 6 and len(other) >= 6 and _edits(word, other) <= 2), None)
        if near is not None:
            unmatched.remove(near)
            matched += 1
    distinct = len(words_a) + len(words_b) - matched
    return distinct == 0 or matched / distinct >= 0.6


def candidates(newcomers, registered, pages, scan_folder, matter_root):
    """Pairs worth the page comparison: {'newcomer', 'source_id'}, {'newcomers'} or {'source_ids'}."""
    def names(row, other):
        notes = row.get('notes') or ''
        return (f'[SUPERSEDED-BY:#{other} ' in notes
                or f'[NOT-VERSION-OF:#{other} ' in notes)

    def segment(path):
        return path.split('\\')[0].lower()

    counts = {stored_form(p, matter_root).lower(): n for p, n in pages.items()}

    def pages_fit(a, b):
        na, nb = counts.get(a.lower()), counts.get(b.lower())
        if not (a.lower().endswith('.pdf') and b.lower().endswith('.pdf')) or na is None or nb is None:
            return True
        return abs(na - nb) <= 2

    scope = stored_form(scan_folder or '', matter_root).strip('\\').lower()
    rows = []
    for r in registered:
        if not r.get('file_path') or '[SUPERSEDED-BY:#' in (r.get('notes') or ''):
            continue
        path = stored_form(r['file_path'], matter_root)
        if not scope or path.lower().startswith(scope + '\\'):
            rows.append(dict(r, path=path))
    pairs = []
    court = [p for p in (stored_form(n['path'], matter_root) for n in newcomers)
             if _COURT_FOLDER.match(segment(p))]
    for path in court:
        for r in rows:
            if (segment(r['path']) == segment(path)
                    and same_title(r['path'], path)
                    and pages_fit(path, r['path'])):
                pairs.append({'newcomer': path, 'source_id': r['source_id']})
    for i, a in enumerate(court):
        for b in court[i + 1:]:
            if (segment(a) == segment(b) and same_title(a, b)
                    and pages_fit(a, b)):
                pairs.append({'newcomers': [a, b]})
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if (a['proceeding_id'] is not None and a['proceeding_id'] == b['proceeding_id']
                    and same_title(a['path'], b['path'])
                    and pages_fit(a['path'], b['path'])
                    and not names(a, b['source_id']) and not names(b, a['source_id'])):
                pairs.append({'source_ids': [a['source_id'], b['source_id']]})
    return pairs
```

`stored_form` is conventions §2.4's helper. `pages` maps a stored path to its page count, or to `None` when unknown. A `newcomers` pair is two files with neither yet read (§6, "Two newcomers"). No pair: the operation ends, and the caller routes the file as before.

**One pair at a time.** A file can pair with several others: several registered rows, another newcomer, or, from the gate, the rows named by several `SUPERSEDE-PENDING:` markers on its own row. Take its pairs one at a time: in the order `candidates` returns them, or for markers in ascending order of the id each names. Each pair gets its own §2 comparison and, attended, its own §5 question, never one question covering two pairs. Re-read the pair's rows (§4's probe) before each one. When an earlier pair superseded one copy of a later pair, the later pair is taken with that copy's kept copy in its place, unless a marker already decides that pair or it is the pair just decided. The superseded row keeps none of its `SUPERSEDE-PENDING:` markers: §6's script clears them all, because a superseded row is never assessed again.

In `unattended` mode go straight to §5.

## §2 Strict comparison

Model work, for each pair. Read both files page by page, and each exhibit against its counterpart one by one, from the text layer, or from ~150 DPI page renders where a page is scanned (design decision #63, [`ingest-extract.md`](ingest-extract.md) Path C). A copy registered with children shows them as rows; read their pages in the file.

The two files are versions of one document only when every difference is an execution mark: a signature, a completed jurat or commissioning block, a registry filing stamp and its date, a `DRAFT` watermark or header, and up to two added stamp or backing pages. Anything else fails the strict test: a changed, added or missing word, figure or paragraph, a different exhibit, or a handwritten notation beyond those marks.

Record, for the pair:

- `verdict`: `pass` or `fail`, and for `fail` each difference found, by page;
- each copy's execution status as the pages show it: `filed` (a registry stamp), `affirmed` (executed or signed), `draft` (neither), or unclear.

A `fail` goes to §6b with approver `strict-test`. No question is asked.

## §3 Rank

The operative copy ranks highest: `filed` over `affirmed` over `draft`. A tie, or an unclear status, is `ask`: the question in §5 then carries no proposal.

```python
VERSION_RANK = ('draft', 'affirmed', 'filed')


def rank(a, b):
    """Which copy to keep: 'a', 'b', or 'ask' on a tie or an unclear status."""
    if a not in VERSION_RANK or b not in VERSION_RANK:
        return {'keep': 'ask', 'basis': f'rank unclear: {a} against {b}'}
    if a == b:
        return {'keep': 'ask', 'basis': f'tie: both {a}'}
    keep = 'a' if VERSION_RANK.index(a) > VERSION_RANK.index(b) else 'b'
    high, low = (a, b) if keep == 'a' else (b, a)
    return {'keep': keep, 'basis': f'{high} over {low}'}
```

## §4 Fold plan

Read both copies' rows with one `case_data__query` call, its one parameter a JSON array of the registered ids in the pair:

```sql
-- supersede-draft pair probe
WITH pair(id) AS (SELECT value FROM json_each(?)),
     fam AS (SELECT source_id FROM main.sources
             WHERE source_id IN (SELECT id FROM pair)
                OR parent_source_id IN (SELECT id FROM pair))
SELECT 'source' AS kind, s.source_id AS id, s.parent_source_id AS parent_id,
       s.title AS text, NULL AS source_locator, s.file_path, s.file_hash,
       s.ingestion_status, s.execution_status, s.verified, s.notes
FROM main.sources s
WHERE s.source_id IN (SELECT source_id FROM fam)
UNION ALL
SELECT 'fact', f.fact_id, f.source_id, f.description, f.source_locator,
       NULL, NULL, NULL, NULL, f.verified, NULL
FROM main.facts f
WHERE f.source_id IN (SELECT source_id FROM fam)
  AND f.verified >= 0
ORDER BY 1 DESC, 2;
```

`parent_id` is a source row's parent and a fact's source. With S and K taken from §3's proposal, or from the practitioner's answer (§5), run `fold_plan`:

- **Children.** A child of S (an exhibit, a book's part) whose title matches a child of K is *matched*: its facts fold or move into K's child, and the child is marked superseded like its parent. Every other child of S is *re-parented* to K with its facts, and takes K's path and hash when it shared S's (design decision #17).
- **Facts.** Every current fact of S, of a matched child or of a re-parented child *arrives* in K's family. Taken in `fact_id` order, an arriving fact whose normalized description equals a current fact on K or on one of K's children folds into it (`auto`); failing that, one equal to an earlier arriving fact folds into that fact (`auto`), so no two current facts of K's family say the same thing after the writes. Every other fact of S or of a matched child is `agent_required`: judge whether an equivalent fact exists on K or its children, at any locator, and fold into it if so. Otherwise it moves to K, or to the matched child, with its locator unchanged. This is how facts at paragraph locators fold into the exhibit facts of the filed copy. Every other fact of a re-parented child stays on it. The kept fact always survives and keeps its own `verified`.

A fold into an arriving fact that the practitioner's decision then folds into K follows it there: `emit_sql` resolves the chain, so the retired fact names the fact that stays.

```python
def normalized(text):
    return ' '.join((text or '').split()).lower()


def fold_plan(rows, superseded, kept):
    """Children matched or re-parented, exact fact folds, and the facts left to judge."""
    sources = [r for r in rows if r['kind'] == 'source']
    facts = sorted((r for r in rows if r['kind'] == 'fact'), key=lambda f: f['id'])
    s_children = [r for r in sources if superseded is not None and r['parent_id'] == superseded]
    k_children = {}
    for r in sources:
        if kept is not None and r['parent_id'] == kept:
            k_children.setdefault(normalized(r['text']), r['id'])
    into = {c['id']: k_children[normalized(c['text'])]
            for c in s_children if normalized(c['text']) in k_children}
    reparent = [c['id'] for c in s_children if c['id'] not in into]
    s_ids = {superseded, *into} - {None}
    k_ids = {kept, *k_children.values()} - {None}
    current = {}
    for f in facts:
        if f['parent_id'] in k_ids:
            current.setdefault(normalized(f['text']), f['id'])
    auto, agent_required = [], []
    for f in facts:
        if f['parent_id'] not in s_ids and f['parent_id'] not in reparent:
            continue
        match = current.setdefault(normalized(f['text']), f['id'])
        if match != f['id']:
            auto.append({'fact_id': f['id'], 'fold_into': match})
        elif f['parent_id'] in s_ids:
            agent_required.append({'fact_id': f['id'], 'source_id': f['parent_id'],
                                   'source_locator': f['source_locator'],
                                   'description': f['text']})
    return {'children_into': into, 'reparent': reparent,
            'auto': auto, 'agent_required': agent_required}
```

`superseded` or `kept` is `None` for a copy with no row yet. A kept copy with no row has no facts, so every fact of S moves to it, except one restating an earlier one. A pair of two newcomers has no rows at all and needs no plan.

Relief items and sought orders need no plan. A `relief_items` row on S with the same seeking party and description as a current one on K, and a `sought_orders` row on S whose `order_number` K already holds, are retired by §6 (`verified = -1` and the `[FOLDED-INTO:]` marker); the rest move. A position or relief position that would land on a current one with the same fact or relief, party, source and locator is retired the same way. When two or more of them would land on one such key together, the lowest id moves and the others are retired into it.

## §5 Decide

**Unattended.** Write nothing but the marker. [`ingest-unattended.md`](ingest-unattended.md) has already ingested the newcomer. Append `SUPERSEDE-PENDING: possible other version of source #<id>.` to its row, `<id>` the paired row, with conventions §11's append statement, one `case_data__execute` call per marker. A pair of two newcomers gets a marker on each row, naming the other, once both have rows; when either ends with no row, the pair gets none. Outcome `pending`. The attended gate and the folder scan take the pair up later, from the marker.

**Attended.** Follow `/show-me`:

1. Present both files as file cards.
2. Name each difference §2 found, and give the rank basis from §3.
3. Show a table: each current fact of S, with its locator and description, and what happens to it: *move to #K at the same locator*, or *fold into #<kept fact>* with that fact's locator and description. Then the children matched and re-parented, and the duplicate relief items and sought orders that will be retired.
4. Ask one plain-text question with three answers: **keep the proposed copy**, **keep the other copy**, **they are different documents**. On `ask` from §3 the question carries no proposal: keep A, keep B, or they are different documents.

Nothing is written before the answer. When the answer keeps a copy whose table was not shown (on `ask`, or "keep the other copy"), re-run §4 in that direction, show its table, and have the practitioner confirm it before §6. "They are different documents" goes to §6b with approver `practitioner`. No answer is `declined`, with nothing written. A pair of two newcomers has no rows, so step 3 shows nothing and the question is asked before either file is read.

## §6 Execute

Read the date through `case_data__query` (`SELECT date('now','localtime') AS today`, conventions §10). Then build the decision:

| Key | Value |
|---|---|
| `outcome` | `superseded` |
| `superseded`, `kept` | the registered `source_id`, or for a copy with no row `{file_path, file_hash}` (stored path, SHA-256). At most one side has no row |
| `notes` | each registered row's `notes` exactly as the §4 probe read them, keyed by `source_id` |
| `execution_status` | `{superseded, kept}` from §2; each is written only where the row's value is NULL |
| `children_into` | §4's matched children, `{S child: K child}` |
| `facts` | every current fact of S and of its matched children, once: `{fact_id, fold_into}` for a fold, `{fact_id}` for a move; and each fold of a re-parented child's fact (§4) |
| `date`, `approver` | the date read above, and `practitioner` |

Then:

1. Run `emit_sql` and send its script as the `sql_script` of one `case_data__execute` call. The script guards itself: a temp `_assert` table fails the whole transaction when either row already carries `[SUPERSEDED-BY:#`, when the two rows carry `[NOT-VERSION-OF:]` naming each other, when a note changed since it was read, when a decided fact is not a current fact of S or its children, a moved fact not one of S or a matched child, or a fold target does not end as a current fact of K or its children, when a matched child has children of its own, and, after the writes, when S or a matched child still has a current fact or a live link, or an arriving fact restates another current fact of K's family. Each guard is a named `CHECK`, so a refusal reads `CHECK constraint failed: <condition>`, for example `CHECK constraint failed: a copy is already superseded`. Report that condition to the practitioner word for word: it names what stopped the write. Re-read before any retry (conventions §2.3), and never retry with hand-edited SQL. A `-- REPORT:` line at the head of the script names a row whose possible-duplicate wording was left in its note (§6b); report it too.
2. Move the superseded file with `file_ops__move`, `superseded: true`, to `<matter_root>\<the 0. DRAFT* folder>\Superseded\<file name>`, passing that `Superseded` folder in `create_folders` when it does not exist. On `dest_exists` retry as `<stem> v2.<ext>`, then `v3`, and so on. The tool never overwrites. Any other refusal (`invalid_argument` for no `0. DRAFT*` folder or two of them, a file not at its stored path, anything else) ends the move: report the tool's error to the practitioner word for word, and skip step 3. The row is already superseded and keeps its old path, so §6c offers the move again the next time the gate or the folder scan meets it.
3. Run [`relocate-source.md`](relocate-source.md) with S's hash, store `main`, the old path and the new one.
4. Confirm: re-read both rows, each with its count of current facts, its parameter a JSON array of the two ids.

```sql
-- supersede-draft confirm probe
SELECT source_id, parent_source_id, file_path, file_hash, execution_status, verified, notes,
       (SELECT count(*) FROM main.facts f
        WHERE f.source_id = s.source_id AND f.verified >= 0) AS current_facts
FROM main.sources s
WHERE source_id IN (SELECT value FROM json_each(?));
```

S must carry `[SUPERSEDED-BY:#<K>` with no current fact, and its `file_path` must name the `Superseded` folder when the move ran.

**Two newcomers.** The answer for a `newcomers` pair is taken before either file is read, and its writes wait for the kept copy's row. The kept newcomer stays with its caller and is extracted once, through [`ingest-extract.md`](ingest-extract.md). Once that document's transaction has committed, run steps 1 to 4 with the other newcomer as the superseded copy with no row and the new `source_id` as K: the script inserts it marker-only, carrying `[SUPERSEDED-BY:#<K>` and nothing else. When several newcomers of one folder pair with each other (a draft, a signed and a filed copy arriving together), settle the pairs one at a time (§1); every newcomer superseded is then inserted against the one newcomer finally kept, which alone is extracted. "They are different documents" leaves both to be extracted, then §6b runs with their new ids. A declined pair leaves both to be extracted.

### §6b Not versions of one document

The decision is `{outcome: 'not_version', pair: [A, B], notes, date, approver}`, `approver` `strict-test` (§2) or `practitioner` (§5). The script appends `[NOT-VERSION-OF:#<other> <date> <approver>]` to both rows and clears any `SUPERSEDE-PENDING:` marker naming the other. A newcomer has no row to carry the marker: hand it on to [`ingest-extract.md`](ingest-extract.md) first, then run this step with its new `source_id`.

Both paths also remove a "possible duplicate" clause from a `DISCREPANCY:` note on either row, and nothing else on that note. A clause that says only that (`possible duplicate`, optionally `of #<id>` or `of source #<id>` and a bracketed remark) is cut out. A clause that also says something else cannot be cut out without losing it: the whole note is left as it was, and the script's head carries a `-- REPORT:` line naming the row, for §7. A row at `verified = 2` returns to `0` only when no conventions §5 prefix remains on its note. No fact note is edited.

```python
import re

_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_TOKEN = re.compile(r'^[A-Za-z][A-Za-z0-9_.-]*$')
_HASH = re.compile(r'^[0-9a-f]{64}$')
_PREFIXES = ('DISCREPANCY:', 'UNCONFIRMED:', 'OCR:', 'REVERIFICATION:')
_CLAUSE_BREAK = re.compile(r'(;\s*|(?<=\.)\s+(?=[A-Z]))')
_DUPLICATE = re.compile(r'possible duplicate(?: of (?:sources? )?#?\d+(?:(?:,| and| &) #?\d+)*)?'
                        r'(?: \([^()]*\))?[.;]?', re.I)
_EXECUTION = ('draft', 'affirmed', 'filed')


def clear_duplicate_clause(note):
    """The note without the 'possible duplicate' clauses of its DISCREPANCY: lines, and
    without such a line when nothing else is left on it; and whether the note was left as
    it was because a clause says more than 'possible duplicate' and cannot be cut out."""
    if not note:
        return note, False
    lines = []
    for line in note.split('\n'):
        if line.startswith('DISCREPANCY:') and 'possible duplicate' in line.lower():
            parts = _CLAUSE_BREAK.split(line[len('DISCREPANCY:'):])
            kept = ''
            for i in range(0, len(parts), 2):
                clause = parts[i].strip()
                if 'possible duplicate' in clause.lower():
                    if not _DUPLICATE.fullmatch(clause):
                        return note, True
                elif clause:
                    kept += (parts[i - 1] if kept else '') + parts[i]
            kept = kept.strip().rstrip(';').strip()
            if not kept:
                continue
            line = 'DISCREPANCY: ' + kept
        lines.append(line)
    return '\n'.join(lines) or None, False


def pending_marker(other):
    return f'SUPERSEDE-PENDING: possible other version of source #{other}.'


def emit_sql(decision):
    """One guarded script for case_data__execute, from an approved decision."""
    date, approver = decision.get('date'), decision.get('approver')
    if not isinstance(date, str) or not _DATE.match(date):
        raise ValueError(f'date must be YYYY-MM-DD, got {date!r}')
    if not isinstance(approver, str) or not _TOKEN.match(approver):
        raise ValueError(f'approver must be one word, got {approver!r}')
    notes = {_positive(k, 'notes key'): v for k, v in (decision.get('notes') or {}).items()}
    if decision.get('outcome') == 'not_version':
        return _not_version_sql(decision, notes, date, approver)
    if decision.get('outcome') == 'superseded':
        return _supersede_sql(decision, notes, date, approver)
    raise ValueError(f"outcome must be 'superseded' or 'not_version', got {decision.get('outcome')!r}")


def _positive(value, name):
    if isinstance(value, str) and value.isdigit():
        value = int(value)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f'{name} must be a positive integer, got {value!r}')
    return value


def _lit(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


def _append(column, marker):
    return (f"CASE WHEN {column} IS NULL OR {column} = '' THEN {marker} "
            f"ELSE {column} || char(10) || {marker} END")


def _settled(note, other, superseded=False):
    """The note as read, without the possible-duplicate clause and the pending marker naming
    `other` (on the superseded row, every pending marker: that row is never assessed again);
    whether a clause was removed; and whether one was left in place, to report."""
    cleared, left = clear_duplicate_clause(note)
    lines = [] if cleared is None else [
        x for x in cleared.split('\n')
        if x != pending_marker(other) and not (superseded and x.startswith('SUPERSEDE-PENDING:'))]
    return '\n'.join(lines) or None, cleared != note, left


def _report(sid):
    return (f'-- REPORT: #{sid} keeps its possible-duplicate wording: it shares a clause with '
            'other text, so its note was left as it was')


def _guarded(head, reports, body):
    """The script around a temp _assert table with one named CHECK per guard, so a refusal
    reads 'CHECK constraint failed: <the guard's condition>'."""
    script = '\n'.join(body)
    names = dict.fromkeys(re.findall(r"INSERT INTO _assert SELECT '([^']+)'", script))
    checks = ',\n  '.join(f'CONSTRAINT "{n}" CHECK (guard <> \'{n}\' OR n = 0)' for n in names)
    return '\n'.join([head, *reports,
                      f'CREATE TEMP TABLE _assert (guard TEXT NOT NULL, n INTEGER NOT NULL,\n  {checks});',
                      script, 'DROP TABLE _assert;'])


def _note_writes(sid, old, new_sql, restore):
    out = []
    if new_sql != _lit(old):
        out.append(f"UPDATE main.sources SET notes = {new_sql} "
                   f"WHERE source_id = {sid} AND notes IS {_lit(old)};")
        out.append("INSERT INTO _assert SELECT 'a note changed since it was read', count(*) "
                   f"FROM main.sources WHERE source_id = {sid} AND notes IS NOT ({new_sql});")
    if restore:
        out.append(f"UPDATE main.sources SET verified = 0 WHERE source_id = {sid} AND verified = 2;")
    return out


def _not_version_sql(decision, notes, date, approver):
    if approver not in ('practitioner', 'strict-test'):
        raise ValueError(f"a NOT-VERSION-OF approver is 'practitioner' or 'strict-test', got {approver!r}")
    pair = [_positive(x, 'pair') for x in decision.get('pair') or []]
    if len(pair) != 2 or pair[0] == pair[1]:
        raise ValueError(f'pair must name two different sources, got {pair!r}')
    a, b = pair
    head = f'-- ===== #{a} and #{b} are not versions of one document ({date} {approver}) ====='
    out = ["INSERT INTO _assert SELECT 'a copy of the pair is not registered', 2 - count(*) "
           f'FROM main.sources WHERE source_id IN ({a}, {b});',
           "INSERT INTO _assert SELECT 'the pair is already decided', count(*) FROM main.sources WHERE "
           f"(source_id = {a} AND (instr(coalesce(notes, ''), '[NOT-VERSION-OF:#{b} ') > 0 "
           f"OR instr(coalesce(notes, ''), '[SUPERSEDED-BY:#{b} ') > 0)) OR "
           f"(source_id = {b} AND (instr(coalesce(notes, ''), '[NOT-VERSION-OF:#{a} ') > 0 "
           f"OR instr(coalesce(notes, ''), '[SUPERSEDED-BY:#{a} ') > 0));"]
    reports = []
    for sid, other in ((a, b), (b, a)):
        if sid not in notes:
            raise ValueError(f'notes as read are required for #{sid}')
        base, cleared, left = _settled(notes[sid], other)
        if left:
            reports.append(_report(sid))
        marker = f'[NOT-VERSION-OF:#{other} {date} {approver}]'
        new = marker if base is None else base + '\n' + marker
        out += _note_writes(sid, notes[sid], _lit(new), cleared and not new.startswith(_PREFIXES))
    return _guarded(head, reports, out)


def _copy(side, name):
    if not isinstance(side, dict):
        return None
    path, file_hash = side.get('file_path'), side.get('file_hash')
    if not isinstance(path, str) or not path.strip():
        raise ValueError(f'{name}.file_path is required for a copy with no row')
    if not isinstance(file_hash, str) or not _HASH.match(file_hash):
        raise ValueError(f'{name}.file_hash must be a lowercase SHA-256, got {file_hash!r}')
    return side


def _resolved(folds):
    """Each fold onto the fact that stays: a fold into a fact that itself folds follows it."""
    target = dict(folds)
    out = []
    for fid, k in folds:
        seen = [fid]
        while k in target:
            if k in seen:
                raise ValueError(f'fact #{fid} folds in a circle')
            seen.append(k)
            k = target[k]
        out.append((fid, k))
    return out


def _supersede_sql(decision, notes, date, approver):
    s_new = _copy(decision.get('superseded'), 'superseded')
    k_new = _copy(decision.get('kept'), 'kept')
    if s_new and k_new:
        raise ValueError('one copy must already be registered')
    s_id = None if s_new else _positive(decision.get('superseded'), 'superseded')
    k_id = None if k_new else _positive(decision.get('kept'), 'kept')
    if s_id is not None and s_id == k_id:
        raise ValueError('superseded and kept are the same source')
    status = decision.get('execution_status') or {}
    for role, value in status.items():
        if role not in ('superseded', 'kept') or value not in _EXECUTION + (None,):
            raise ValueError(f'execution_status.{role} must be one of {_EXECUTION}, got {value!r}')
    into = {_positive(c, 'children_into key'): _positive(kc, 'children_into value')
            for c, kc in (decision.get('children_into') or {}).items()}
    folds, moves, seen = [], [], set()
    for entry in decision.get('facts') or []:
        fid = _positive(entry.get('fact_id'), 'fact_id')
        if fid in seen:
            raise ValueError(f'fact #{fid} is decided twice')
        seen.add(fid)
        if entry.get('fold_into') is None:
            moves.append(fid)
        else:
            folds.append((fid, _positive(entry['fold_into'], 'fold_into')))
    folds = _resolved(folds)
    if s_new and (folds or moves or into):
        raise ValueError('a superseded copy with no row has no facts or children to decide')
    for sid in (s_id, k_id):
        if sid is not None and sid not in notes:
            raise ValueError(f'notes as read are required for #{sid}')

    S = str(s_id) if s_id else '(SELECT s FROM _v)'
    K = str(k_id) if k_id else '(SELECT k FROM _v)'
    tail = _lit(f' {date} {approver}]')
    superseded_by = f"'[SUPERSEDED-BY:#' || {K} || {tail}"
    registered = ', '.join(str(i) for i in (s_id, k_id) if i)
    count = sum(1 for i in (s_id, k_id) if i)
    head = f'-- ===== supersede source {s_id or "(new)"} by {k_id or "(new)"} ({date} {approver}) ====='
    out = ['CREATE TEMP TABLE _v (s INTEGER, k INTEGER);',
           f"INSERT INTO _v VALUES ({s_id or 'NULL'}, {k_id or 'NULL'});",
           f"INSERT INTO _assert SELECT 'a registered copy is not a top-level source', {count} - count(*) "
           f'FROM main.sources WHERE source_id IN ({registered}) AND parent_source_id IS NULL;',
           "INSERT INTO _assert SELECT 'a copy is already superseded', count(*) FROM main.sources "
           f"WHERE source_id IN ({registered}) AND instr(coalesce(notes, ''), '[SUPERSEDED-BY:#') > 0;"]
    if s_id and k_id:
        out.append("INSERT INTO _assert SELECT 'the pair is already judged different documents', count(*) "
                   'FROM main.sources WHERE '
                   f"(source_id = {s_id} AND instr(coalesce(notes, ''), '[NOT-VERSION-OF:#{k_id} ') > 0) OR "
                   f"(source_id = {k_id} AND instr(coalesce(notes, ''), '[NOT-VERSION-OF:#{s_id} ') > 0);")

    columns = ('proceeding_id, category, title, description, filed_by_party_id, date, '
               'file_path, file_hash, ingestion_status, last_ingested_at, execution_status')
    if k_new:
        # The copy with no row takes S's place; a partial read stays partial.
        out.append("INSERT INTO _assert SELECT 'the superseded copy is neither complete nor partial', count(*) "
                   f'FROM main.sources WHERE source_id = {s_id} '
                   "AND ingestion_status IS NOT 'complete' AND ingestion_status IS NOT 'partial';")
        out.append(f'INSERT INTO main.sources ({columns}) '
                   'SELECT proceeding_id, category, title, description, filed_by_party_id, date, '
                   f"{_lit(k_new['file_path'])}, {_lit(k_new['file_hash'])}, "
                   "CASE WHEN ingestion_status = 'partial' THEN 'partial' ELSE 'complete' END, "
                   f"date('now','localtime'), {_lit(status.get('kept'))} "
                   f'FROM main.sources WHERE source_id = {s_id};')
        out.append('UPDATE _v SET k = (SELECT source_id FROM main.sources '
                   f"WHERE file_hash = {_lit(k_new['file_hash'])} AND parent_source_id IS NULL);")
    if s_new:
        out.append(f'INSERT INTO main.sources ({columns}, notes) '
                   'SELECT proceeding_id, category, title, description, filed_by_party_id, date, '
                   f"{_lit(s_new['file_path'])}, {_lit(s_new['file_hash'])}, 'complete', "
                   f"date('now','localtime'), {_lit(status.get('superseded'))}, "
                   f"'[SUPERSEDED-BY:#' || source_id || {tail} "
                   f'FROM main.sources WHERE source_id = {k_id};')
        out.append('UPDATE _v SET s = (SELECT source_id FROM main.sources '
                   f"WHERE file_hash = {_lit(s_new['file_hash'])} AND parent_source_id IS NULL);")

    reports = []
    for role, sid, other in (('superseded', s_id, k_id), ('kept', k_id, s_id)):
        if sid is None:
            continue
        base, cleared, left = _settled(notes[sid], other, role == 'superseded')
        if left:
            reports.append(_report(sid))
        new_sql = _lit(base)
        if role == 'superseded':
            new_sql = superseded_by if base is None else f'{_lit(base)} || char(10) || {superseded_by}'
        out += _note_writes(sid, notes[sid], new_sql,
                            cleared and not (base or '').startswith(_PREFIXES))
        if status.get(role):
            out.append(f"UPDATE main.sources SET execution_status = {_lit(status[role])} "
                       f"WHERE source_id = {sid} AND execution_status IS NULL;")

    if s_id:
        def folded_into(keep):
            return _append('notes', f"'[FOLDED-INTO:#' || ({keep}) || {tail}")

        rows = ['INSERT INTO _src VALUES '
                + ', '.join([f'({s_id}, {K})'] + [f'({c}, {kc})' for c, kc in into.items()]) + ';']
        if folds:
            rows.append('INSERT INTO _fold VALUES ' + ', '.join(f'({f}, {k})' for f, k in folds) + ';')
        if moves:
            rows.append('INSERT INTO _move VALUES ' + ', '.join(f'({f})' for f in moves) + ';')
        out.append(_REPOINT.format(
            S=S, K=K, ROWS='\n'.join(rows),
            FACT_NOTES=folded_into('SELECT k FROM _fold WHERE f = facts.fact_id'),
            POS_NOTES=folded_into('SELECT keep_id FROM _pos WHERE id = positions.position_id'),
            RELIEF_NOTES=folded_into('SELECT k FROM _relief WHERE r = relief_items.relief_id'),
            RPOS_NOTES=folded_into('SELECT keep_id FROM _rpos WHERE id = relief_positions.relief_position_id'),
            ORDER_NOTES=folded_into(
                'SELECT q.sought_order_id FROM main.sought_orders q '
                'WHERE q.source_id = (SELECT t FROM _src WHERE x = sought_orders.source_id) '
                'AND q.order_number = sought_orders.order_number'),
            CHILD_NOTES=_append('notes', "'[SUPERSEDED-BY:#' || "
                                         f"(SELECT t FROM _src WHERE x = sources.source_id) || {tail}")))
    out.append("INSERT INTO _assert SELECT 'the superseded copy does not carry SUPERSEDED-BY the kept copy', "
               f"1 - count(*) FROM main.sources WHERE source_id = {S} "
               f"AND instr(notes, '[SUPERSEDED-BY:#' || {K} || ' ') > 0;")
    out.append('DROP TABLE _v;')
    return _guarded(head, reports, out)


_REPOINT = """CREATE TEMP TABLE _src (x INTEGER PRIMARY KEY, t INTEGER NOT NULL);
CREATE TEMP TABLE _fold (f INTEGER PRIMARY KEY, k INTEGER NOT NULL);
CREATE TEMP TABLE _move (f INTEGER PRIMARY KEY);
{ROWS}
-- S's other children, re-parented to K below
CREATE TEMP TABLE _kids (c INTEGER PRIMARY KEY);
INSERT INTO _kids SELECT source_id FROM main.sources
  WHERE parent_source_id = {S} AND source_id NOT IN (SELECT x FROM _src);
-- a matched child belongs to S and matches a child of K, and has no children of its own
INSERT INTO _assert SELECT 'a matched child is not a child of the superseded copy matching one of the kept copy',
  count(*) FROM _src WHERE x <> {S} AND NOT (
  EXISTS (SELECT 1 FROM main.sources c WHERE c.source_id = _src.x AND c.parent_source_id = {S})
  AND EXISTS (SELECT 1 FROM main.sources c WHERE c.source_id = _src.t AND c.parent_source_id = {K}));
INSERT INTO _assert SELECT 'a matched child has children of its own', count(*) FROM main.sources
  WHERE parent_source_id IN (SELECT x FROM _src WHERE x <> {S});
-- a folded fact is a current fact of S or one of its children; a moved one, of S or a matched child
INSERT INTO _assert SELECT 'a folded fact is not a current fact of the superseded copy or its children',
  count(*) FROM _fold WHERE f NOT IN (SELECT fact_id FROM main.facts WHERE verified >= 0
    AND (source_id IN (SELECT x FROM _src) OR source_id IN (SELECT c FROM _kids)));
INSERT INTO _assert SELECT 'a moved fact is not a current fact of the superseded copy or a matched child',
  count(*) FROM _move WHERE f NOT IN (SELECT fact_id FROM main.facts
    WHERE verified >= 0 AND source_id IN (SELECT x FROM _src));
-- a fold target ends as a current fact of K or one of its children: one there already,
-- a moved fact, or a fact of a re-parented child that is not itself folded
INSERT INTO _assert SELECT 'a fold target does not end as a current fact of the kept copy',
  count(*) FROM _fold WHERE k IN (SELECT f FROM _fold) OR (k NOT IN (SELECT f FROM _move) AND k NOT IN (
    SELECT fact_id FROM main.facts WHERE verified >= 0 AND (source_id IN (SELECT c FROM _kids)
      OR source_id IN (SELECT source_id FROM main.sources WHERE source_id = {K} OR parent_source_id = {K}))));
-- the facts that arrive in K's family and stay current, compared with it after the writes
CREATE TEMP TABLE _arrive (f INTEGER PRIMARY KEY);
INSERT INTO _arrive SELECT f FROM _move UNION SELECT fact_id FROM main.facts
  WHERE verified >= 0 AND source_id IN (SELECT c FROM _kids) AND fact_id NOT IN (SELECT f FROM _fold);

-- facts: retire each folded fact, move the rest with their locators
UPDATE main.facts SET verified = -1, pending_reverification = 0, notes = {FACT_NOTES}
  WHERE fact_id IN (SELECT f FROM _fold);
UPDATE main.facts SET source_id = (SELECT t FROM _src WHERE x = facts.source_id)
  WHERE fact_id IN (SELECT f FROM _move);

-- positions, in place (#64): a row that would land on a current one is retired instead
CREATE TEMP TABLE _pos (id INTEGER PRIMARY KEY, fact_id INTEGER, source_id INTEGER, keep_id INTEGER);
INSERT INTO _pos (id, fact_id, source_id)
  SELECT p.position_id, coalesce(fo.k, p.fact_id), coalesce(sr.t, p.source_id)
  FROM main.positions p LEFT JOIN _fold fo ON fo.f = p.fact_id LEFT JOIN _src sr ON sr.x = p.source_id
  WHERE fo.f IS NOT NULL OR sr.x IS NOT NULL;
UPDATE _pos SET keep_id = (
  SELECT q.position_id FROM main.positions p JOIN main.positions q
    ON q.fact_id = _pos.fact_id AND q.party_id = p.party_id
   AND coalesce(q.source_id, -1) = coalesce(_pos.source_id, -1)
   AND coalesce(q.source_locator, '') = coalesce(p.source_locator, '')
  WHERE p.position_id = _pos.id AND p.valid_to IS NULL AND q.valid_to IS NULL
    AND q.position_id NOT IN (SELECT id FROM _pos)
  ORDER BY q.position_id LIMIT 1);
-- two rows of the set that would land on one current key: the lowest id moves, the rest retire into it
UPDATE _pos SET keep_id = (
  SELECT min(o.id) FROM _pos o
    JOIN main.positions op ON op.position_id = o.id
    JOIN main.positions p ON p.position_id = _pos.id
  WHERE o.id < _pos.id AND o.keep_id IS NULL AND o.fact_id = _pos.fact_id
    AND coalesce(o.source_id, -1) = coalesce(_pos.source_id, -1) AND op.party_id = p.party_id
    AND coalesce(op.source_locator, '') = coalesce(p.source_locator, '')
    AND op.valid_to IS NULL AND p.valid_to IS NULL)
  WHERE keep_id IS NULL;
UPDATE main.positions SET verified = -1, pending_reverification = 0, notes = {POS_NOTES}
  WHERE position_id IN (SELECT id FROM _pos WHERE keep_id IS NOT NULL);
UPDATE main.positions SET fact_id = (SELECT fact_id FROM _pos WHERE id = positions.position_id),
                          source_id = (SELECT source_id FROM _pos WHERE id = positions.position_id)
  WHERE position_id IN (SELECT id FROM _pos WHERE keep_id IS NULL);

-- admissions and evidence links, in place
UPDATE main.admissions SET
    fact_id = coalesce((SELECT k FROM _fold WHERE f = admissions.fact_id), fact_id),
    source_id = coalesce((SELECT t FROM _src WHERE x = admissions.source_id), source_id)
  WHERE fact_id IN (SELECT f FROM _fold) OR source_id IN (SELECT x FROM _src);
UPDATE main.evidence_links SET
    fact_id = coalesce((SELECT k FROM _fold WHERE f = evidence_links.fact_id), fact_id),
    source_id = coalesce((SELECT t FROM _src WHERE x = evidence_links.source_id), source_id)
  WHERE fact_id IN (SELECT f FROM _fold) OR source_id IN (SELECT x FROM _src);

-- composite keys: add the row for the kept fact unless it is there, then drop the folded fact's
INSERT OR IGNORE INTO main.criteria_facts (criterion_id, fact_id, relevance)
  SELECT c.criterion_id, fo.k, c.relevance FROM main.criteria_facts c JOIN _fold fo ON fo.f = c.fact_id;
DELETE FROM main.criteria_facts WHERE fact_id IN (SELECT f FROM _fold);
INSERT OR IGNORE INTO main.issue_facts (issue_id, fact_id, relevance)
  SELECT i.issue_id, fo.k, i.relevance FROM main.issue_facts i JOIN _fold fo ON fo.f = i.fact_id;
DELETE FROM main.issue_facts WHERE fact_id IN (SELECT f FROM _fold);
INSERT OR IGNORE INTO privileged.fact_provenance
    (fact_id, source_id, source_locator, source_note, verified, disposition)
  SELECT fo.k, p.source_id, p.source_locator, p.source_note, p.verified, p.disposition
  FROM privileged.fact_provenance p JOIN _fold fo ON fo.f = p.fact_id;
DELETE FROM privileged.fact_provenance WHERE fact_id IN (SELECT f FROM _fold);

-- relief items: retire a duplicate of a current one on the target, move the rest
CREATE TEMP TABLE _relief (r INTEGER PRIMARY KEY, k INTEGER);
INSERT INTO _relief (r, k)
  SELECT r.relief_id, CASE WHEN r.verified >= 0 THEN (
      SELECT q.relief_id FROM main.relief_items q
      WHERE q.source_id = sr.t AND q.verified >= 0 AND q.seeking_party_id = r.seeking_party_id
        AND lower(trim(q.description)) = lower(trim(r.description))
      ORDER BY q.relief_id LIMIT 1) END
  FROM main.relief_items r JOIN _src sr ON sr.x = r.source_id;
UPDATE main.relief_items SET verified = -1, notes = {RELIEF_NOTES}
  WHERE relief_id IN (SELECT r FROM _relief WHERE k IS NOT NULL);
UPDATE main.relief_items SET source_id = (SELECT t FROM _src WHERE x = relief_items.source_id)
  WHERE relief_id IN (SELECT r FROM _relief WHERE k IS NULL);

-- relief positions: onto the kept relief and source; one that would land on a current one is retired
CREATE TEMP TABLE _rpos (id INTEGER PRIMARY KEY, relief_id INTEGER, source_id INTEGER, keep_id INTEGER);
INSERT INTO _rpos (id, relief_id, source_id)
  SELECT p.relief_position_id, coalesce(rl.k, p.relief_id), coalesce(sr.t, p.source_id)
  FROM main.relief_positions p
  LEFT JOIN _relief rl ON rl.r = p.relief_id AND rl.k IS NOT NULL
  LEFT JOIN _src sr ON sr.x = p.source_id
  WHERE rl.r IS NOT NULL OR sr.x IS NOT NULL;
UPDATE _rpos SET keep_id = (
  SELECT q.relief_position_id FROM main.relief_positions p JOIN main.relief_positions q
    ON q.relief_id = _rpos.relief_id AND q.party_id = p.party_id
   AND coalesce(q.source_id, -1) = coalesce(_rpos.source_id, -1)
   AND coalesce(q.source_locator, '') = coalesce(p.source_locator, '')
  WHERE p.relief_position_id = _rpos.id AND p.valid_to IS NULL AND q.valid_to IS NULL
    AND q.relief_position_id NOT IN (SELECT id FROM _rpos)
  ORDER BY q.relief_position_id LIMIT 1);
-- two rows of the set that would land on one current key: the lowest id moves, the rest retire into it
UPDATE _rpos SET keep_id = (
  SELECT min(o.id) FROM _rpos o
    JOIN main.relief_positions op ON op.relief_position_id = o.id
    JOIN main.relief_positions p ON p.relief_position_id = _rpos.id
  WHERE o.id < _rpos.id AND o.keep_id IS NULL AND o.relief_id = _rpos.relief_id
    AND coalesce(o.source_id, -1) = coalesce(_rpos.source_id, -1) AND op.party_id = p.party_id
    AND coalesce(op.source_locator, '') = coalesce(p.source_locator, '')
    AND op.valid_to IS NULL AND p.valid_to IS NULL)
  WHERE keep_id IS NULL;
UPDATE main.relief_positions SET verified = -1, notes = {RPOS_NOTES}
  WHERE relief_position_id IN (SELECT id FROM _rpos WHERE keep_id IS NOT NULL);
UPDATE main.relief_positions SET
    relief_id = (SELECT relief_id FROM _rpos WHERE id = relief_positions.relief_position_id),
    source_id = (SELECT source_id FROM _rpos WHERE id = relief_positions.relief_position_id)
  WHERE relief_position_id IN (SELECT id FROM _rpos WHERE keep_id IS NULL);

-- sought orders: UNIQUE(source_id, order_number), so a number the target holds is retired, never moved
UPDATE main.sought_orders SET verified = -1, notes = {ORDER_NOTES}
  WHERE source_id IN (SELECT x FROM _src) AND verified >= 0
    AND EXISTS (SELECT 1 FROM main.sought_orders q
                WHERE q.source_id = (SELECT t FROM _src WHERE x = sought_orders.source_id)
                  AND q.order_number = sought_orders.order_number);
UPDATE main.sought_orders SET source_id = (SELECT t FROM _src WHERE x = sought_orders.source_id)
  WHERE source_id IN (SELECT x FROM _src)
    AND NOT EXISTS (SELECT 1 FROM main.sought_orders q
                    WHERE q.source_id = (SELECT t FROM _src WHERE x = sought_orders.source_id)
                      AND q.order_number = sought_orders.order_number);

-- the remaining references to the superseded source
UPDATE main.source_references SET source_id = (SELECT t FROM _src WHERE x = source_references.source_id)
  WHERE source_id IN (SELECT x FROM _src);
UPDATE main.source_references SET target_source_id = (SELECT t FROM _src WHERE x = source_references.target_source_id)
  WHERE target_source_id IN (SELECT x FROM _src);
UPDATE main.causes_of_action SET source_id = (SELECT t FROM _src WHERE x = causes_of_action.source_id)
  WHERE source_id IN (SELECT x FROM _src);
UPDATE main.witnesses SET report_source_id = (SELECT t FROM _src WHERE x = witnesses.report_source_id)
  WHERE report_source_id IN (SELECT x FROM _src);

-- children: an unmatched child moves under K and shares its path and hash (#17); a matched one is marked
UPDATE main.sources SET
    file_path = (SELECT k.file_path FROM main.sources k WHERE k.source_id = {K}),
    file_hash = (SELECT k.file_hash FROM main.sources k WHERE k.source_id = {K})
  WHERE file_hash IS (SELECT s.file_hash FROM main.sources s WHERE s.source_id = {S})
    AND source_id IN (WITH RECURSIVE d(id) AS (
          SELECT c.source_id FROM main.sources c
          WHERE c.parent_source_id = {S} AND c.source_id NOT IN (SELECT x FROM _src)
          UNION ALL
          SELECT c.source_id FROM main.sources c JOIN d ON c.parent_source_id = d.id)
        SELECT id FROM d);
UPDATE main.sources SET parent_source_id = {K}
  WHERE parent_source_id = {S} AND source_id NOT IN (SELECT x FROM _src);
UPDATE main.sources SET notes = {CHILD_NOTES}
  WHERE source_id IN (SELECT x FROM _src WHERE x <> {S});

-- post-conditions: nothing current is left on S or a matched child
INSERT INTO _assert SELECT 'the superseded copy keeps a current fact', count(*) FROM main.facts
  WHERE source_id IN (SELECT x FROM _src) AND verified >= 0;
INSERT INTO _assert SELECT 'a position still names the superseded copy or a folded fact', count(*)
  FROM main.positions
  WHERE (source_id IN (SELECT x FROM _src) OR fact_id IN (SELECT f FROM _fold)) AND verified >= 0;
INSERT INTO _assert SELECT 'a relief item still names the superseded copy', count(*) FROM main.relief_items
  WHERE source_id IN (SELECT x FROM _src) AND verified >= 0;
INSERT INTO _assert SELECT 'a relief position still names the superseded copy or a retired relief item',
  count(*) FROM main.relief_positions
  WHERE (source_id IN (SELECT x FROM _src) OR relief_id IN (SELECT r FROM _relief WHERE k IS NOT NULL))
    AND verified >= 0;
INSERT INTO _assert SELECT 'a sought order still names the superseded copy', count(*) FROM main.sought_orders
  WHERE source_id IN (SELECT x FROM _src) AND verified >= 0;
INSERT INTO _assert SELECT 'an admission still names the superseded copy or a folded fact', count(*)
  FROM main.admissions WHERE source_id IN (SELECT x FROM _src) OR fact_id IN (SELECT f FROM _fold);
INSERT INTO _assert SELECT 'an evidence link still names the superseded copy or a folded fact', count(*)
  FROM main.evidence_links WHERE source_id IN (SELECT x FROM _src) OR fact_id IN (SELECT f FROM _fold);
INSERT INTO _assert SELECT 'a criterion link still names a folded fact', count(*) FROM main.criteria_facts
  WHERE fact_id IN (SELECT f FROM _fold);
INSERT INTO _assert SELECT 'an issue link still names a folded fact', count(*) FROM main.issue_facts
  WHERE fact_id IN (SELECT f FROM _fold);
INSERT INTO _assert SELECT 'a provenance row still names a folded fact', count(*) FROM privileged.fact_provenance
  WHERE fact_id IN (SELECT f FROM _fold);
INSERT INTO _assert SELECT 'a source reference still names the superseded copy', count(*)
  FROM main.source_references
  WHERE source_id IN (SELECT x FROM _src) OR target_source_id IN (SELECT x FROM _src);
INSERT INTO _assert SELECT 'a cause of action still names the superseded copy', count(*)
  FROM main.causes_of_action WHERE source_id IN (SELECT x FROM _src);
INSERT INTO _assert SELECT 'an expert report still names the superseded copy', count(*)
  FROM main.witnesses WHERE report_source_id IN (SELECT x FROM _src);
INSERT INTO _assert SELECT 'the superseded copy keeps an unmatched child', count(*) FROM main.sources
  WHERE parent_source_id = {S} AND source_id NOT IN (SELECT x FROM _src);
-- no arriving fact restates another current fact of K or its children
INSERT INTO _assert SELECT 'an arriving fact restates a current fact of the kept copy', count(*)
  FROM main.facts m JOIN main.facts o
    ON o.fact_id <> m.fact_id AND lower(trim(o.description)) = lower(trim(m.description))
  WHERE m.fact_id IN (SELECT f FROM _arrive) AND o.verified >= 0
    AND o.source_id IN (SELECT source_id FROM main.sources WHERE source_id = {K} OR parent_source_id = {K});
DROP TABLE _rpos;
DROP TABLE _relief;
DROP TABLE _pos;
DROP TABLE _arrive;
DROP TABLE _kids;
DROP TABLE _move;
DROP TABLE _fold;
DROP TABLE _src;"""
```

### §6c A move that did not happen

§6 commits the database write before the file moves, so a refused or skipped move leaves a superseded row whose stored path lies outside `0. DRAFT*\Superseded\`. Attended only, the gate ([`ingest.md`](ingest.md) Step 3) and the folder scan ([`extract-facts.md`](extract-facts.md) §3b) find such rows with this probe and `unmoved`, and offer each its move:

```sql
-- supersede-draft unmoved probe
SELECT source_id, file_path, file_hash, notes
FROM main.sources
WHERE parent_source_id IS NULL
  AND instr(coalesce(notes, ''), '[SUPERSEDED-BY:#') > 0
  AND file_path IS NOT NULL
ORDER BY source_id;
```

```python
import re


def unmoved(rows, matter_root):
    """The superseded rows whose stored path lies outside 0. DRAFT*\\Superseded\\."""
    def in_superseded(path):
        parts = stored_form(path, matter_root).split('\\')
        return len(parts) > 2 and re.match(r'0\. DRAFT', parts[0], re.I) and parts[1].lower() == 'superseded'

    return [r for r in rows if not in_superseded(r['file_path'])]
```

Report each row returned by name, with the source that superseded it, and offer its move as one plain-text question per row. On yes, run §6 steps 2 to 4 for it. On no, or a refused move (reported word for word), nothing is written and the row is offered again next time. Never skip one silently. Unattended paths never move a file: [`ingest-status.md`](ingest-status.md) reports such a file's `move_pending`, and [`ingest-unattended.md`](ingest-unattended.md) passes it on.

## §7 Report

Per pair: the outcome; the kept and superseded ids and file names; the rank basis, or for `not_version` each difference the strict test found, so the practitioner can see why two similar files were judged different documents; facts moved and folded, children re-parented and matched, duplicate rows retired; the move's destination, or the tool's refusal word for word; and the relocate outcome. A refused script's named condition, word for word. Each `-- REPORT:` line: the row whose possible-duplicate wording was left in its note, so the practitioner can settle it. For `pending`, the marker written and the row it names. For §6c, each row offered, and whether it moved.
