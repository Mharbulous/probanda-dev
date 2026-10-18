import contextlib
import importlib.util
import io
import json
import re
import sys
import tempfile
import unittest
import zlib
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
TEST_TMP = CASE_DATA_ROOT.parents[2] / ".test-tmp"
TEST_TMP.mkdir(exist_ok=True)
FIXTURES = CASE_DATA_ROOT / "tests" / "fixtures"

sys.path.insert(0, str(CASE_DATA_ROOT / "references" / "scripts"))

spec = importlib.util.spec_from_file_location(
    "extract_outline", CASE_DATA_ROOT / "references" / "scripts" / "extract_outline.py"
)
eo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eo)

VARIANTS = ("classic", "objstm", "hybrid")
HEADER = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"


# --------------------------------------------------------------------------
# PDF generator
# --------------------------------------------------------------------------

def _obj(num, body):
    return b"%d 0 obj\n%s\nendobj\n" % (num, body)


def _xref_table(offsets, size, root, trailer_extra=b"", prev=None, include_zero=True):
    nums = ([0] if include_zero else []) + sorted(offsets)
    groups = []
    for n in nums:
        if groups and groups[-1][-1] == n - 1:
            groups[-1].append(n)
        else:
            groups.append([n])
    out = bytearray(b"xref\n")
    for group in groups:
        out += b"%d %d\n" % (group[0], len(group))
        for n in group:
            out += b"0000000000 65535 f \n" if n == 0 else b"%010d 00000 n \n" % offsets[n]
    trailer = b"<< /Size %d /Root %d 0 R" % (size, root)
    if prev is not None:
        trailer += b" /Prev %d" % prev
    out += b"trailer\n" + trailer + trailer_extra + b" >>\n"
    return bytes(out)


def _png_up_encode(rows):
    prev = bytes(len(rows[0]))
    out = bytearray()
    for row in rows:
        out.append(2)
        out += bytes((a - b) & 0xFF for a, b in zip(row, prev))
        prev = row
    return bytes(out)


def _xref_stream(num, entries, size, root, index, extra=b""):
    rows = []
    for start, count in zip(index[0::2], index[1::2]):
        for n in range(start, start + count):
            t, a, b = entries.get(n, (0, 0, 0))
            rows.append(bytes([t]) + a.to_bytes(4, "big") + b.to_bytes(2, "big"))
    comp = zlib.compress(_png_up_encode(rows))
    idx = b" ".join(b"%d" % i for i in index)
    head = (b"%d 0 obj\n<< /Type /XRef /Size %d /W [1 4 2] /Index [%s] /Root %d 0 R /Filter /FlateDecode "
            b"/DecodeParms << /Predictor 12 /Columns 7 >> /Length %d%s >>\nstream\n"
            % (num, size, idx, root, len(comp), extra))
    return head + comp + b"\nendstream\nendobj\n"


def _objstm_content(objects):
    header = b""
    bodies = b""
    for num in sorted(objects):
        header += b"%d %d " % (num, len(bodies))
        bodies += objects[num] + b"\n"
    return header, bodies


def build_classic(objects, root=1, trailer_extra=b""):
    out = bytearray(HEADER)
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += _obj(num, objects[num])
    xref_off = len(out)
    out += _xref_table(offsets, max(objects) + 1, root, trailer_extra)
    out += b"startxref\n%d\n%%%%EOF\n" % xref_off
    return bytes(out)


def build_objstm(objects, root=1, trailer_extra=b""):
    """Every object inside one ObjStm; xref stream with /Index subsections; ObjStm /Length indirect."""
    s = max(objects) + 1
    l = s + 1
    x = s + 2
    header, bodies = _objstm_content(objects)
    comp = zlib.compress(header + bodies)
    out = bytearray(HEADER)
    offsets = {s: len(out)}
    out += (b"%d 0 obj\n<< /Type /ObjStm /N %d /First %d /Filter /FlateDecode /Length %d 0 R >>\nstream\n"
            % (s, len(objects), len(header), l)) + comp + b"\nendstream\nendobj\n"
    offsets[l] = len(out)
    out += _obj(l, b"%d" % len(comp))
    offsets[x] = len(out)
    entries = {num: (2, s, i) for i, num in enumerate(sorted(objects))}
    for n in (s, l, x):
        entries[n] = (1, offsets[n], 0)
    size = x + 1
    out += _xref_stream(x, entries, size, root, [0, 1, 1, size - 1], trailer_extra)
    out += b"startxref\n%d\n%%%%EOF\n" % offsets[x]
    return bytes(out)


def build_hybrid(objects, root=1, trailer_extra=b""):
    """Classic table for the uncompressed objects plus /XRefStm for the compressed ones."""
    s = max(objects) + 1
    x = s + 1
    header, bodies = _objstm_content(objects)
    comp = zlib.compress(header + bodies)
    out = bytearray(HEADER)
    offsets = {s: len(out)}
    out += (b"%d 0 obj\n<< /Type /ObjStm /N %d /First %d /Filter /FlateDecode /Length %d >>\nstream\n"
            % (s, len(objects), len(header), len(comp))) + comp + b"\nendstream\nendobj\n"
    offsets[x] = len(out)
    entries = {num: (2, s, i) for i, num in enumerate(sorted(objects))}
    out += _xref_stream(x, entries, x + 1, root, [1, s - 1])
    table_off = len(out)
    out += _xref_table(offsets, x + 1, root, b" /XRefStm %d" % offsets[x] + trailer_extra)
    out += b"startxref\n%d\n%%%%EOF\n" % table_off
    return bytes(out)


BUILDERS = {"classic": build_classic, "objstm": build_objstm, "hybrid": build_hybrid}


def append_update(base, objects, root=1):
    prev = int(base[base.rfind(b"startxref") + 9:].split()[0])
    size = int(re.findall(rb"/Size (\d+)", base)[-1])
    out = bytearray(base)
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += _obj(num, objects[num])
    xref_off = len(out)
    out += _xref_table(offsets, max(size, max(objects) + 1), root, prev=prev, include_zero=False)
    out += b"startxref\n%d\n%%%%EOF\n" % xref_off
    return bytes(out)


def page_objs(n):
    """Pages object 2 with page objects 10..10+n-1."""
    objs = {2: b"<< /Type /Pages /Kids [%s] /Count %d >>"
               % (b" ".join(b"%d 0 R" % (10 + i) for i in range(n)), n)}
    for i in range(n):
        objs[10 + i] = b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"
    return objs


def outline_objs(items):
    """items: nested [(dict_fragment_bytes, children), ...]; root is object 3, items from 100."""
    objs = {}
    counter = [100]

    def build(items, parent):
        nums = []
        for extra, children in items:
            nums.append((counter[0], extra, children))
            counter[0] += 1
        for i, (n, extra, children) in enumerate(nums):
            parts = [b"<<", extra, b"/Parent %d 0 R" % parent]
            if i > 0:
                parts.append(b"/Prev %d 0 R" % nums[i - 1][0])
            if i < len(nums) - 1:
                parts.append(b"/Next %d 0 R" % nums[i + 1][0])
            if children:
                first, last = build(children, n)
                parts.append(b"/First %d 0 R /Last %d 0 R /Count %d" % (first, last, len(children)))
            objs[n] = b" ".join(parts + [b">>"])
        return nums[0][0], nums[-1][0]

    if items:
        first, last = build(items, 3)
        objs[3] = b"<< /Type /Outlines /First %d 0 R /Last %d 0 R >>" % (first, last)
    else:
        objs[3] = b"<< /Type /Outlines >>"
    return objs


def item(title, page=None, extra=b"", children=()):
    """Outline item fragment: title is raw PDF syntax (or None); page is a 1-based page number."""
    parts = []
    if title is not None:
        parts.append(b"/Title " + title)
    if page is not None:
        parts.append(b"/Dest [%d 0 R /Fit]" % (9 + page))
    if extra:
        parts.append(extra)
    return (b" ".join(parts), list(children))


def make_pdf(variant, n_pages, items, catalog_extra=b"", extra_objs=None, trailer_extra=b""):
    """items=None omits /Outlines from the catalog altogether."""
    outlines = b"" if items is None else b" /Outlines 3 0 R"
    objs = {1: b"<< /Type /Catalog /Pages 2 0 R%s %s >>" % (outlines, catalog_extra)}
    objs.update(page_objs(n_pages))
    if items is not None:
        objs.update(outline_objs(items))
    objs.update(extra_objs or {})
    return BUILDERS[variant](objs, root=1, trailer_extra=trailer_extra)


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------

class OutlineTestCase(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)
        self._n = 0

    def tearDown(self):
        self.tempdir.cleanup()

    def write(self, data):
        self._n += 1
        path = Path(self.tempdir.name) / f"doc{self._n}.pdf"
        path.write_bytes(data)
        return str(path)

    def run_main(self, path):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = eo.main([path])
        return rc, out.getvalue(), err.getvalue()

    def result(self, data):
        rc, out, err = self.run_main(self.write(data))
        self.assertEqual(rc, 0, out)
        self.assertEqual(err, "")
        lines = out.splitlines()
        self.assertEqual(len(lines), 1)
        return json.loads(lines[0])

    def failure(self, data):
        rc, out, err = self.run_main(self.write(data))
        self.assertEqual(rc, 1)
        self.assertEqual(err, "")
        lines = out.splitlines()
        self.assertEqual(len(lines), 1, out)
        parsed = json.loads(lines[0])
        self.assertEqual(list(parsed), ["error"])
        return parsed["error"]

    def codes(self, res):
        return [a["code"] for a in res["anomalies"]]


class StructuralTests(OutlineTestCase):
    def test_no_outline(self):
        for variant in VARIANTS:
            for items in (None, []):
                with self.subTest(variant=variant, items=items):
                    res = self.result(make_pdf(variant, 3, items))
                    self.assertEqual(res, {"pages": 3, "entries": [], "anomalies": []})

    def test_single_entry(self):
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(variant, 5, [item(b"(Only)", 1)]))
                self.assertEqual(res["pages"], 5)
                self.assertEqual(res["entries"], [{"level": 1, "title": "Only", "page": 1, "range": [1, 5]}])
                self.assertEqual(res["anomalies"], [])

    def test_nested_three_levels(self):
        items = [
            item(b"(PART 1)", 1, children=[
                item(b"(A1)", 1, children=[item(b"(A1-x)", 2)]),
                item(b"(A2)", 4),
            ]),
            item(b"(PART 2)", 6, children=[item(b"(B1)", 7)]),
            item(b"(PART 3)", 11),
        ]
        expected = [
            {"level": 1, "title": "PART 1", "page": 1, "range": [1, 5]},
            {"level": 2, "title": "A1", "page": 1, "range": [1, 3]},
            {"level": 3, "title": "A1-x", "page": 2, "range": [2, 3]},
            {"level": 2, "title": "A2", "page": 4, "range": [4, 5]},
            {"level": 1, "title": "PART 2", "page": 6, "range": [6, 10]},
            {"level": 2, "title": "B1", "page": 7, "range": [7, 10]},
            {"level": 1, "title": "PART 3", "page": 11, "range": [11, 12]},
        ]
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(variant, 12, items))
                self.assertEqual(res["entries"], expected)
                self.assertEqual(res["anomalies"], [])

    def test_titles_utf16_and_pdfdoc(self):
        items = [
            item(b"<FEFF0050004100522019>", 1),                       # hex UTF-16BE
            item(b"(\\376\\377\\000P\\000A\\000R\\000\\040\\040\\031)", 2),  # literal with BOM
            item(b"(Frank\\220s book \\223le)", 3),                   # PDFDocEncoding 0x90, 0x93
            item(b"(\\357\\273\\277caf\\303\\251)", 4),               # UTF-8 BOM
        ]
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(variant, 4, items))
                self.assertEqual([e["title"] for e in res["entries"]],
                                 ["PAR’", "PAR ’", "Frank’s book ﬁle", "café"])
                self.assertEqual(res["anomalies"], [])

    def test_literal_escapes_and_newlines(self):
        items = [
            item(b"(Line one\\r\\nLine two)", 1),
            item(b"(Raw\r\n  break\rhere\nnow)", 1),
            item(b"(Paren \\(nested\\) and (balanced) ok)", 1),
            item(b"(\\101\\102\\0603 tab\\there\\\\ back)", 1),
            item(b"(joined \\\r\nline)", 1),
            item(b"<FEFF 0041 000D000A 0042>", 1),
        ]
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(variant, 1, items))
                self.assertEqual([e["title"] for e in res["entries"]], [
                    "Line one Line two",
                    "Raw break here now",
                    "Paren (nested) and (balanced) ok",
                    "AB03 tab here\\ back",
                    "joined line",
                    "A B",
                ])
                self.assertEqual(res["anomalies"], [])

    def test_named_dests(self):
        extra = {
            50: b"<< /Kids [51 0 R 52 0 R] >>",
            51: b"<< /Limits [(a) (b)] /Names [(a) [10 0 R /Fit] (b) [11 0 R /XYZ 0 0 0]] >>",
            52: b"<< /Limits [(c) (d)] /Names [(c) << /D [12 0 R /Fit] >> (d) 53 0 R] >>",
            53: b"[13 0 R /Fit]",
            60: b"<< /legacy [14 0 R /Fit] /Sp#20ace [15 0 R /Fit] >>",
        }
        items = [
            item(b"(goto named)", extra=b"/A << /S /GoTo /D (a) >>"),
            item(b"(a)", extra=b"/Dest (a)"),
            item(b"(b)", extra=b"/Dest (b)"),
            item(b"(c dict)", extra=b"/Dest (c)"),
            item(b"(d indirect)", extra=b"/Dest (d)"),
            item(b"(legacy name)", extra=b"/Dest /legacy"),
            item(b"(legacy space)", extra=b"/Dest (Sp ace)"),
            item(b"(goto array)", extra=b"/A << /S /GoTo /D [15 0 R /Fit] >>"),
        ]
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(
                    variant, 6, items,
                    catalog_extra=b"/Names << /Dests 50 0 R >> /Dests 60 0 R", extra_objs=extra))
                self.assertEqual([e["page"] for e in res["entries"]], [1, 1, 2, 3, 4, 5, 6, 6])
                self.assertEqual(res["anomalies"], [])

    def test_stray_out_of_order_entry(self):
        items = [
            item(b"(PART A)", 1, children=[item(b"(Affidavit)", 1)]),
            item(b"(PART B)", 6),
            item(b"(PART C)", 10),
            item(b"(Untitled)", 6),
        ]
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(variant, 10, items))
                self.assertEqual([e["range"] for e in res["entries"]],
                                 [[1, 5], [1, 5], [6, 9], [10, 10], [6, 9]])
                for e in res["entries"]:
                    self.assertLessEqual(e["range"][0], e["range"][1])
                self.assertEqual(len(res["anomalies"]), 1)
                anomaly = res["anomalies"][0]
                self.assertEqual(anomaly["code"], "page_out_of_order")
                self.assertEqual(anomaly["entry_index"], 4)
                self.assertEqual(anomaly["title"], "Untitled")

    def test_page_index_dest(self):
        items = [
            item(b"(third)", extra=b"/Dest [2 /Fit]"),
            item(b"(beyond)", extra=b"/Dest [99 /Fit]"),
        ]
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(variant, 4, items))
                self.assertEqual(res["entries"], [
                    {"level": 1, "title": "third", "page": 3, "range": [3, 4]},
                    {"level": 1, "title": "beyond", "page": None, "range": None},
                ])
                self.assertEqual(self.codes(res), ["unresolved_dest"])
                self.assertEqual(res["anomalies"][0]["entry_index"], 1)

    def test_missing_title(self):
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(variant, 2, [item(None, 2)]))
                self.assertEqual(res["entries"], [{"level": 1, "title": "", "page": 2, "range": [2, 2]}])
                self.assertEqual(self.codes(res), ["missing_title"])

    def test_unresolved_dest_and_non_goto_action(self):
        items = [
            item(b"(nowhere)", extra=b"/Dest (nope)"),
            item(b"(web)", extra=b"/A << /S /URI /URI (http://example.test) >>"),
            item(b"(both)", 2, extra=b"/A << /S /GoTo /D [10 0 R /Fit] >>"),
            item(b"(neither)"),
        ]
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(variant, 3, items))
                self.assertEqual([e["page"] for e in res["entries"]], [None, None, 2, None])
                self.assertEqual([e["range"] for e in res["entries"]], [None, None, [2, 3], None])
                self.assertEqual([(a["code"], a["entry_index"]) for a in res["anomalies"]], [
                    ("unresolved_dest", 0),
                    ("action_not_goto", 1),
                    ("dest_and_action", 2),
                    ("missing_dest", 3),
                ])
                self.assertIn("URI", res["anomalies"][1]["detail"])

    def test_page_tree_untyped_intermediate_and_wrong_count(self):
        extra = {
            2: b"<< /Type /Pages /Kids [20 0 R 12 0 R] /Count 7 >>",
            20: b"<< /Kids [10 0 R 11 0 R] /Parent 2 0 R >>",
        }
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                res = self.result(make_pdf(variant, 3, [item(b"(last)", 3)], extra_objs=extra))
                self.assertEqual(res["pages"], 3)
                self.assertEqual(res["entries"], [{"level": 1, "title": "last", "page": 3, "range": [3, 3]}])
                self.assertEqual(self.codes(res), ["page_count_mismatch"])
                self.assertIsNone(res["anomalies"][0]["entry_index"])

    def test_incremental_update_redefines_title(self):
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                base = make_pdf(variant, 2, [item(b"(Old)", 1), item(b"(Second)", 2)])
                updated = append_update(base, {100: b"<< /Title (New) /Parent 3 0 R /Next 101 0 R /Dest [10 0 R /Fit] >>"})
                res = self.result(updated)
                self.assertEqual([e["title"] for e in res["entries"]], ["New", "Second"])
                self.assertEqual(res["anomalies"], [])


class FailureTests(OutlineTestCase):
    def test_next_cycle(self):
        items = [item(b"(A)", 1), item(b"(B)", 1)]
        extra = {101: b"<< /Title (B) /Parent 3 0 R /Dest [10 0 R /Fit] /Next 100 0 R >>"}
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                err = self.failure(make_pdf(variant, 1, items, extra_objs=extra))
                self.assertIn("cycle", err)

    def test_outline_too_deep(self):
        children = []
        for depth in range(66, 0, -1):
            children = [item(b"(L%d)" % depth, 1, children=children)]
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                err = self.failure(make_pdf(variant, 1, children))
                self.assertIn("64", err)

    def test_truncated_file(self):
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                data = make_pdf(variant, 3, [item(b"(A)", 1)])
                err = self.failure(data[: len(data) * 2 // 3])
                self.assertIn("%%EOF", err)

    def test_torn_incremental_update(self):
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                base = make_pdf(variant, 2, [item(b"(Old)", 1)])
                updated = append_update(base, {100: b"<< /Title (New) /Parent 3 0 R /Dest [10 0 R /Fit] >>"})
                err = self.failure(updated[: len(base) + 30])
                self.assertIn("%%EOF", err)

    def test_corrupt_flate(self):
        data = bytearray(make_pdf("objstm", 2, [item(b"(A)", 1)]))
        start = data.index(b"stream\n", data.index(b"/Type /ObjStm")) + len(b"stream\n")
        data[start + 4:start + 12] = b"\xff" * 8
        err = self.failure(bytes(data))
        self.assertIn("Flate", err)

    def test_encrypt(self):
        for variant in VARIANTS:
            with self.subTest(variant=variant):
                err = self.failure(make_pdf(variant, 1, [item(b"(A)", 1)],
                                            trailer_extra=b" /Encrypt << /Filter /Standard >>"))
                self.assertIn("ncrypt", err)

    def test_bad_object_header_at_offset(self):
        data = bytearray(make_pdf("classic", 1, [item(b"(A)", 1)]))
        idx = data.index(b"100 0 obj")
        data[idx:idx + 9] = b"200 0 obj"
        err = self.failure(bytes(data))
        self.assertIn("object 100", err)

    def test_xref_offset_out_of_range(self):
        data = make_pdf("classic", 1, [item(b"(A)", 1)])
        idx = data.rfind(b"startxref\n") + len(b"startxref\n")
        data = data[:idx] + b"999999999\n%%EOF\n"
        self.assertIn("out of range", self.failure(data))

    def test_non_pdf_input(self):
        rc, out, err = self.run_main(str(FIXTURES / "sample.docx"))
        self.assertEqual(rc, 1)
        self.assertEqual(err, "")
        self.assertIn("error", json.loads(out))

    def test_missing_file(self):
        rc, out, _err = self.run_main(str(Path(self.tempdir.name) / "absent.pdf"))
        self.assertEqual(rc, 1)
        self.assertIn("error", json.loads(out))


class StreamAndFilterTests(OutlineTestCase):
    def test_stream_length_mismatch_anomaly(self):
        data = make_pdf("objstm", 2, [item(b"(A)", 1)])
        m = re.search(rb"(\d+) 0 obj\n(\d+)\nendobj", data)
        old = m.group(2)
        new = b"%d" % (int(old) - 1)
        self.assertEqual(len(old), len(new))
        data = data[: m.start(2)] + new + data[m.end(2):]
        res = self.result(data)
        self.assertEqual(res["entries"], [{"level": 1, "title": "A", "page": 1, "range": [1, 2]}])
        self.assertEqual(self.codes(res), ["stream_length_mismatch"])
        self.assertIsNone(res["anomalies"][0]["entry_index"])

    def test_png_predictor_types(self):
        rows = b"\x01\x02\x03\x04\x05\x06"
        self.assertEqual(eo._png_predictor(b"\x00\x01\x02\x03\x00\x04\x05\x06", 1, 8, 3), rows)
        self.assertEqual(eo._png_predictor(b"\x01\x01\x01\x01\x01\x04\x01\x01", 1, 8, 3), rows)
        self.assertEqual(eo._png_predictor(b"\x00\x01\x02\x03\x02\x03\x03\x03", 1, 8, 3), rows)
        self.assertEqual(eo._png_predictor(b"\x00\x01\x02\x03\x03\x04\x02\x02", 1, 8, 3), rows)
        self.assertEqual(eo._png_predictor(b"\x00\x01\x02\x03\x04\x03\x01\x01", 1, 8, 3), rows)
        # Sub with two-byte pixels (colors=2) uses bpp=2.
        self.assertEqual(eo._png_predictor(b"\x01\x01\x02\x02\x02", 2, 8, 2), b"\x01\x02\x03\x04")
        with self.assertRaises(eo.PDFError):
            eo._png_predictor(b"\x05\x01\x02\x03", 1, 8, 3)
        with self.assertRaises(eo.PDFError):
            eo._png_predictor(b"\x00\x01\x02", 1, 8, 3)

    def test_predictor_2_rejected(self):
        stream = eo.Stream({"Filter": eo.Name("FlateDecode"),
                            "DecodeParms": {"Predictor": 2, "Columns": 2}}, zlib.compress(b"\x01\x02"), None)
        with self.assertRaises(eo.PDFError):
            stream.decoded()

    def test_unsupported_filter_rejected(self):
        stream = eo.Stream({"Filter": eo.Name("LZWDecode")}, b"abc", None)
        with self.assertRaises(eo.PDFError):
            stream.decoded()

    def test_lexer_and_parser(self):
        parsed = eo.Parser(b"<< /A#20B (x\\)y) /C <414> /D [1 2 R 3] /E 1.5 /F true /G null /H -7 >>").parse()
        self.assertEqual(parsed, {
            "A B": b"x)y", "C": b"A@", "D": [eo.Ref(1, 2), 3], "E": 1.5, "F": True, "G": None, "H": -7,
        })
        self.assertIsInstance(list(parsed)[0], eo.Name)
        self.assertEqual(eo.Parser(b"(a(b)c)").parse(), b"a(b)c")
        self.assertEqual(eo.Parser(b"(\\101\\12\\7)").parse(), b"A\n\x07")
        self.assertEqual(eo.Parser(b"(a\\\nb)").parse(), b"ab")
        self.assertEqual(eo.Parser(b"% comment\n[1 0 R 2 0 R]").parse(), [eo.Ref(1, 0), eo.Ref(2, 0)])
        self.assertEqual(eo.Parser(b"[1 2 R 3 R]").parse(), [eo.Ref(1, 2), 3, eo.Keyword("R")])
        stream = eo.Parser(b"<< /Length 5 >>\nstream\r\nhello\r\nendstream").parse()
        self.assertIsInstance(stream, eo.Stream)
        self.assertEqual(stream.raw, b"hello")
        with self.assertRaises(eo.PDFError):
            eo.Parser(b"<< /A (unterminated >>").parse()
        with self.assertRaises(eo.PDFError):
            eo.Parser(b"<zz>").parse()
        with self.assertRaises(eo.PDFError):
            eo.Parser(b"[1 2").parse()


class CliTests(OutlineTestCase):
    def test_determinism(self):
        path = self.write(make_pdf("objstm", 3, [item(b"(A)", 1, children=[item(b"(B)", 2)])]))
        rc1, out1, _ = self.run_main(path)
        rc2, out2, _ = self.run_main(path)
        self.assertEqual((rc1, rc2), (0, 0))
        self.assertEqual(out1, out2)
        self.assertTrue(out1.isascii())

    def test_wrong_argc(self):
        for argv in ([], ["a", "b"]):
            with self.subTest(argv=argv):
                out, err = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    rc = eo.main(argv)
                self.assertEqual(rc, 2)
                self.assertEqual(out.getvalue(), "")
                self.assertIn("usage", err.getvalue())


if __name__ == "__main__":
    unittest.main()
