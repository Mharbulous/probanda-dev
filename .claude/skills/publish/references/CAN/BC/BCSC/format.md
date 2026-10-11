---
items:
  - rule_ref: bcsc-paper
    passage: '<w:pgSz w:w="12240" w:h="15840" w:code="1"/>'
    source: practitioner
    ref: subskills/publish-bcsc-form/templates/032-noa.dotx
  - rule_ref: bcsc-margins
    passage: '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/>'
    source: practitioner
    ref: subskills/publish-bcsc-form/templates/032-noa.dotx
---
```json
{
  "format": {
    "paper": { "value": "letter", "rule_ref": "bcsc-paper" },
    "margins": {
      "value": { "top": "1 in", "bottom": "1 in", "left": "1 in", "right": "1 in" },
      "rule_ref": "bcsc-margins"
    }
  }
}
```

# Supreme Court of British Columbia: physical format

The physical format `publish-general` gives a `general` Writing at this venue. The block's contract is `shared/declared-format.md`, and how its items are recorded is `shared/knowledge-tree.md`.

- **Paper and margins** are the values the firm's shipped BCSC form templates already use. Each item quotes the page-size or margin element from the `word/document.xml` of `subskills/publish-bcsc-form/templates/032-noa.dotx`, the template its `ref` names.
- **Typography** of the bespoke BCSC forms is each form's own template, as `subskills/publish-bcsc-form/forms/000-SOP/style-guide.md` says. This file does not restate it, so `typeface`, `font_size` and `line_spacing` are omitted.
- **Every other property is omitted** and reads `defaulted`, because no shipped template or style guide records a value for it. The SOP style guide reserves page one's top-left corner for the filing stamp but records no length, so `filing_stamp_reservation` is omitted too.
