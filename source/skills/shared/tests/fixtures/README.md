Fixtures for `shared/scripts/pdf_layout.py` and the bilingual tests of `verify-law/scripts/diff_excerpt.py` and `show-me/scripts/highlight_pages.py`. All are public decisions of the Supreme Court of Canada, downloaded on 2026-10-06 from scc-csc.lexum.com as the official bilingual *Supreme Court Reports* PDF, and trimmed with pypdf (`PdfWriter.add_page` for the pages kept, nothing else changed).

| File | Decision | Source | Pages kept |
|---|---|---|---|
| `scr-2012-1-433-ipeelee-pp14-16.pdf` | *R. v. Ipeelee*, 2012 SCC 13, [2012] 1 S.C.R. 433 | `https://scc-csc.lexum.com/scc-csc/scc-csc/en/8000/1/document.do` | 14-16 (report pp. 446-448): paras [9]-[17], bracketed markers in each column, para [11] crossing the page break |
| `scr-2004-3-511-haida-pp14-16.pdf` | *Haida Nation v. British Columbia (Minister of Forests)*, 2004 SCC 73, [2004] 3 S.C.R. 511 | `https://scc-csc.lexum.com/scc-csc/scc-csc/en/2189/1/document.do` | 14-16 (report pp. 524-526): paras 20-28, numbered in the outer margin, which is on the right of odd pages and the left of even ones |

In both, English is the left column and French the right, under a running header that crosses the gutter. pdfplumber reads their line-end hyphens as "-"; PyMuPDF reads Ipeelee's as U+00AD.

The excerpt files are each paragraph's text cut from the PDF's own column with pdfplumber, line by line, with the paragraph marker left off and line-wrap hyphens rejoined (`compor-` / `tement` → `comportement`):

- `ipeelee-para11-en.txt`: para [11], English, pages 1-2
- `ipeelee-para12-en.txt`: para [12], English, page 2
- `ipeelee-para12-fr.txt`: para [12], French, page 2

`../bilingual_sample.py` builds a synthetic one-page bilingual report at test time, for soft hyphens (U+00AD), which neither S.C.R. fixture yields through pdfplumber.
