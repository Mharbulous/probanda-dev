---
items:
  - rule_ref: vaniac-paper
    passage: '<w:pgSz w:w="12240" w:h="15840"/>'
    source: practitioner
    ref: subskills/publish-vaniac-package/templates/vaniac-package.dotx
  - rule_ref: vaniac-margins
    passage: '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
    source: practitioner
    ref: subskills/publish-vaniac-package/templates/vaniac-package.dotx
---
```json
{
  "format": {
    "paper": { "value": "letter", "rule_ref": "vaniac-paper" },
    "margins": {
      "value": { "top": "1 in", "bottom": "1 in", "left": "1 in", "right": "1 in" },
      "rule_ref": "vaniac-margins"
    }
  }
}
```

# Vancouver International Arbitration Centre: physical format

The physical format `publish-general` gives a `general` Writing at this venue. The block's contract is `shared/declared-format.md`, and how its items are recorded is `shared/knowledge-tree.md`.

- **Paper and margins** are the values the firm's shipped VanIAC package template already uses. Each item quotes the page-size or margin element from the `word/document.xml` of `subskills/publish-vaniac-package/templates/vaniac-package.dotx`, the template its `ref` names.
- **Typography** of the VanIAC package documents is that template's own. This file does not restate it, so `typeface`, `font_size` and `line_spacing` are omitted.
- **Every other property is omitted** and reads `defaulted`, because no shipped template or style guide records a value for it.
