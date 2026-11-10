# Schedule 1 -- Costs on Default Judgment Under Rule 3-8

**Source:** B.C. Reg. 168/2009, Appendix B, Schedule 1.
**Status:** figures are sourced from
`source/skills/calculate/subskills/itemize-boc/references/tariff-appendix-b.md`'s
"Schedule 1 -- Default Judgment (Rule 3-8)" section, which `itemize-boc`'s
`tariff-checker` agent re-verifies against bclaws.gov.bc.ca and bccourts.ca on
every `itemize-boc` run. The Form 63 route never runs `itemize-boc` (Form 63 has
no tariff items), so **nothing in the Form 63 path re-verifies these bands**:
they are only as current as the appendix's last Form 62 run. If
the two tables ever disagree, the appendix wins -- update this file to match
it.

Costs are banded by "amount involved" -- the upper bound of each band is
**exclusive**: an amount equal to a bound falls in the *next* band up.

| Amount involved                  | Costs |
| --------------------------------- | ----: |
| No amount involved                 | $320 |
| Up to $5,000                       | $160 |
| $5,000 up to $15,000               | $240 |
| $15,000 up to $25,000              | $320 |
| $25,000 up to $35,000              | $400 |
| $35,000 up to $45,000              | $480 |
| $45,000 up to $55,000              | $560 |
| $55,000 up to $65,000              | $620 |
| $65,000 and over                   | $680 |

Encoded as `SCHEDULE_1_BANDS` in `../scripts/form63.py`.
