# Declared format — the settable properties of a venue physical-format file

This file is the single source of truth for the **format block**: the fenced JSON block that opens a venue physical-format file in `/publish`'s knowledge tree. Its readers are `publish-general`, `/localize` and its helper, and the runtime, which validates the block. Those components reference this file and do not restate it. It has no `SKILL.md` and is never wrapped. It ships only inside the litigation `.plugin`'s `skill-source/` mirror.

Where the file sits in the tree, how each item's `rule_ref`, passage and source are recorded, and how a firm confirms or corrects an item are in `shared/knowledge-tree.md`. What a Writing prints and in what order is its layout block, whose contract is `shared/declared-layout.md`.

`publish-general` renders every `general` Writing through one generic template. The physical-format file sets that template's properties for the venue, or for `_NoVenue`.

Provenance: settled on #1047 (2026-09-25), recorded on #970.

## 1. The block and its validator

- **Shape.** The block is the first fenced `json` block in the file, after the front matter:

  ```json
  { "format": { "<property>": { "value": <value>, "rule_ref": "<ref>" } } }
  ```

  Each property is one entry under `format`. Its `rule_ref` is the key under which the file records the property's passage and source.
- **The runtime is the single validator.** It validates the block at `knowledge__write` and again each time `publish-general` reads the file. An unknown property, a value of the wrong type or a malformed length fails hard, naming the file, the property and the rule broken.
- **Omitted properties.** A property the file omits takes the generic template's documented default. The read reports each one under `defaulted`.

## 2. Settable properties

The vocabulary is closed and owned by the runtime.

| Property | Value |
|---|---|
| `paper` | `letter`, `lawyer` or `a4` |
| `margins` | object with `top`, `bottom`, `left` and `right`, each a length |
| `typeface` | string |
| `font_size` | length in `pt`, whose number is greater than zero |
| `line_spacing` | number greater than zero |
| `page_numbering` | object with `position`, `format` and `first_page`, over the page-numbering vocabulary |
| `header` | string over the letterhead token set |
| `footer` | string over the letterhead token set |
| `filing_stamp_reservation` | length |

**Length.** A length is the string `"<number> <unit>"`, the unit one of `mm`, `cm`, `in` or `pt`, separated from the number by one space. For example `"25 mm"` or `"12 pt"`.

**Page-numbering vocabulary.** `position` is one of `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center` or `bottom-right`. `format` is one of `arabic`, `lower-roman` or `upper-roman`. `first_page` is `true` or `false`, and says whether page one shows its number.

**Letterhead token set.** The tokens `/publish`'s letterhead step substitutes in header and footer parts. A `header` or `footer` string carrying any other token fails.

**No signature property.** Signature placement is not settable. `publish-general` always keeps the signature block on the same page as the paragraph before it.

## 3. Letterhead precedence

For a Writing whose layout block declares `letterhead: true`, the firm's registered letterhead template governs. Every property the file sets, all nine included, is ignored for that render and reported under `overridden_by_letterhead`, once per session, as a shadowed local file is reported. A letterhead Writing is never refused because the letterhead does not apply a property the file sets: the file is per venue, so it also serves the venue's Writings that do not use the letterhead (settled on #1156).

## 4. Practitioner-sourced properties

A property whose source is the practitioner (`source: practitioner`, the usual case for `_NoVenue` letter and release formatting) needs no confirmation row and reads confirmed. Only agent-sourced properties go through confirmation.

## 5. `corrected` values

How a correction is recorded and validated is `shared/knowledge-tree.md` "Confirmation sidecar". In this tree a `corrected` value is the property's own JSON value, in the shape section 2 gives it, and the validator it is substituted into is section 1's.
