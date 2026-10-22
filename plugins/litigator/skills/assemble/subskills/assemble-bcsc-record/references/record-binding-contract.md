# Record binding contract

The grammar and error codes of the three `assemble-bcsc-record` scripts. Each
prints one JSON line, `{"success": true, ...}` or
`{"success": false, "error": "<code>", "detail": "..."}`, and exits non-zero on
failure. `paginate_record.py` and `mark_orders.py` need PyMuPDF; without it they
refuse with `missing_dependency`.

## Record manifest builder

`python record_manifest.py <documents .json> <cover .pdf> <output .pdf> <manifest .json>`

The documents file:

```json
{"rule_9_7": false,
 "documents": [
   {"kind": "notice_of_application", "title": "Notice of Application filed November 3, 2026", "path": "<matter folder>/NOA filed.pdf"},
   {"kind": "other_by_consent", "title": "Agreed chronology", "path": "...", "consent": true}
 ]}
```

`kind` places each document in the Rule 8-1 (15) order, as amended by
B.C. Reg. 105/2026. Documents of one kind keep the order the file lists them in.

| Kind | Rule | Holds |
|---|---|---|
| `notice_of_application` | (15) (b) (iii) | The filed notice. Exactly one |
| `application_response` | (15) (b) (iv) | Every application response served on the applicant |
| `filed_evidence` | (15) (b) (v) | Every filed pleading, and every filed affidavit or other evidence, relied on at the hearing |
| `respondent_evidence` | (15) (b) (v.1) | Any affidavit or other evidence an application respondent served on the applicant |
| `pleading` | (15) (b) (vi) | Each filed pleading, on a Rule 9-7 application only (`rule_9_7: true`) |
| `draft_order` | (15) (c) (i) | Optional |
| `written_argument` | (15) (c) (ii) | Optional, subject to (16) |
| `list_of_authorities` | (15) (c) (iii) | Optional |
| `draft_bill_of_costs` | (15) (c) (iv) | Optional |
| `other_by_consent` | (15) (d) (iii) | Any other document, only with `"consent": true` |

The cover is the Form 30.001 cover saved as a PDF. The manifest written is
`{"cover", "tabs": [{"tab", "title", "kind", "path"}], "output", "index_output"}`,
where `index_output` is the output name with ` - Index` added.

| Error | Meaning |
|---|---|
| `refused_document` | A kind (15) (d) keeps out: `affidavit_of_service` (d) (i) or `authority` (d) (ii) |
| `unknown_kind` | A kind not in the table |
| `pleading_without_9_7` | A `pleading` when `rule_9_7` is false. A pleading relied on is `filed_evidence` |
| `consent_required` | An `other_by_consent` document without `"consent": true` |
| `notice_count` | Not exactly one `notice_of_application` |
| `bad_documents` | The file's shape is wrong, or a path or the cover is not a `.pdf` |

## Record paginator

`python paginate_record.py <manifest .json>`

Binds the cover, an index and each tab, in that order. Every page is numbered at
the top centre, from 1 on the cover. The index lists each tab's number, title
and first page. Bookmarks: `Cover Page`, `Index`, and `Tab N – <title>` for each
tab. The index pages are also written alone to `index_output`, for service under
(17).

On success it adds `record`, `index`, `page_count` and
`tabs: [{"tab", "title", "page"}]`.

| Error | Meaning |
|---|---|
| `bad_manifest` | The manifest's shape is wrong, or tab numbers do not run 1, 2, 3 |
| `missing_file` | The cover or a tab's PDF is not on disk |
| `output_exists` | `output` or `index_output` exists. Nothing is overwritten |

## Marked copy

`python mark_orders.py <filed notice .pdf> <output .pdf>`

Highlights every text line between the `Part 1` heading line and the `Part 2`
heading line of the filed notice, for the separate copy (15.1) requires. On
success it adds `output`, `lines_marked` and `pages`.

| Error | Meaning |
|---|---|
| `missing_file` | The notice is not on disk |
| `output_exists` | The output exists. Nothing is overwritten |
| `no_text_layer` | The notice has no text, so Part 1 cannot be found |
| `heading_not_found` | Not exactly one `Part 1` and one `Part 2` heading line, or nothing between them |
