# Bill of Costs — Source Version Tracker

This file records the version dates of the authoritative sources that underpin the skill's reference materials. The startup protocol compares live source dates against these stored values to detect when the skill's references are stale.

---

## Tracked Sources

### 1. BC Courts Costs Package (PDF)
- **URL:** https://www.bccourts.ca/supreme_court/self-represented_litigants/sc_info_packages/costs_package.pdf
- **How to read version:** Open PDF in browser, take screenshot, zoom into bottom-right corner of any page — look for "Last Updated dd-MMM-yyyy"
- **Last known "Last Updated" date:** 2026-04-14 *(set during initial skill verification — confirm against live PDF)*
- **References updated to match:** 2026-04-14

### 2. BC Laws — Appendix B (Supreme Court Civil Rules, B.C. Reg. 168/2009)
- **URL:** https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/168_2009_05
- **How to read version:** Use get_page_text — look for "This consolidation is current to [Mmmm dd, yyyy]"
- **Last known consolidation date:** April 7, 2026
- **Last amended:** January 19, 2026 by B.C. Reg. 152/2025
- **References updated to match:** 2026-04-14

### 3. Cumulative B.C. Regulations Bulletin
- **How to find:** On the bclaws.gov.bc.ca Appendix B page, look for the link labelled "Cumulative B.C. Regulations Bulletin [year]" in the header note and follow it
- **Purpose:** Catches amendments that are passed but not yet incorporated into the consolidation ("Amendments Not in Force")
- **Last checked:** 2026-04-14
- **Amendments to B.C. Reg. 168/2009 found:** None affecting Appendix B (as of 2026-04-14)

---

## How to update this file

After running the startup currency check and confirming (or updating) the skill's references:

1. Update the **"Last known"** date for each source to whatever the live source shows
2. Update the **"References updated to match"** date to today's date
3. Note any amendments found in the Bulletin section
4. Save this file

This file is updated when the user grants permission to refresh the reference subfolder.
