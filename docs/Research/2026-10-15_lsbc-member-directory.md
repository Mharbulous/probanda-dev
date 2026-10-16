# LSBC member directory: what it shows, and its terms for lookups

Research for issue #47. Primary sources only (lawsociety.bc.ca pages). Facts only; no recommendation.

## 1. Fields shown in search results / member profile

- The directory lets a user "confirm they are licensed to practice, find their contact information, and see any current practice restrictions, discipline history and current regulatory proceedings." Source: https://www.lawsociety.bc.ca/for-the-public/finding-a-lawyer/ (also stated, in near-identical wording, at https://www.lawsociety.bc.ca/working-with-lawyers/finding-a-lawyer/).
- "Any discipline history prior to November 1983 will not appear in the search results." Source: https://www.lawsociety.bc.ca/lsbc/apps/lkup/directory/mbr-search.cfm.
- "The Lawyer Directory includes the names of former members for a period of two years from the date the lawyer ceased to be a member." Source: https://www.lawsociety.bc.ca/lsbc/apps/lkup/directory/mbr-search.cfm.
- "The names of disbarred members are included indefinitely." Source: https://www.lawsociety.bc.ca/lsbc/apps/lkup/directory/mbr-search.cfm.
- "retired lawyers (non-practising members who have practised law at least 20 of the past 25 years) and non-practising lawyers" are included in the directory. Source: https://www.lawsociety.bc.ca/for-the-public/about-the-lawyer-directory/.
- "The Lawyer Directory pulls information from the Law Society databases regularly. A lawyer's status can change at any time." Source: https://www.lawsociety.bc.ca/for-the-public/about-the-lawyer-directory/.
- Whether the results/profile separately display year of call, a direct email address, a member number, firm name or a phone number as discrete fields could not be established from the pages reached — see "Unestablished" below. The pages above describe the directory only in general terms ("contact information", "current practice status") without listing discrete field labels.

## 2. How a search is made, and whether it blocks automated lookups

- The current search form is at https://www.lawsociety.bc.ca/lsbc/apps/lkup/directory/mbr-search.cfm. Its fields, per that page: "Last name (required):" with "starts with," "exact match," or "contains" options; "First name or first initial (optional):"; "City (optional):".
- No public API or bulk data download for the directory was found on lawsociety.bc.ca.
- robots.txt (https://www.lawsociety.bc.ca/robots.txt) contains, under `User-Agent: *`:
  - `Disallow: /lsbc/apps/lkup/mbr-search.cfm`
  - `Disallow: /lsbc/apps/lkup/uap-search.cfm`
  - `Disallow: /lsbc/apps/lkup/mbr-details.cfm`
  - `Disallow: /lsbc/apps/lkup/directory/mbr-details.cfm`
  - and, separately: `Allow: /lsbc/apps/lkup/`, `Allow: /lsbc/apps/lkup/directory/mbr-search.cfm`, `Allow: /lsbc/apps/lkup/uap/uap-search.cfm`.
  - Net effect as written: the current search-form page (`/lsbc/apps/lkup/directory/mbr-search.cfm`) and its parent path are allowed for crawling, while the member-detail page (`/lsbc/apps/lkup/directory/mbr-details.cfm`, i.e. the page that would show one member's own record) and two older-path search/detail pages (`mbr-search.cfm`, `mbr-details.cfm`, `uap-search.cfm`, without the `directory/` or `uap/` segment) are disallowed.
- The Terms of Use page (https://www.lawsociety.bc.ca/terms-of-use/, last updated June 25, 2015) contains a general copyright clause — "The Works may not be transmitted, transcribed, reproduced, stored or translated into any other form, in whole or in part" (with limited exceptions for private/educational use) — but no clause specifically addressing the directory, automated access, scraping, rate limiting or bulk extraction.
- Whether the live search form presents a CAPTCHA, a rate limit, or any anti-automation challenge on submission could not be established — see "Unestablished" below.

## 3. Terms governing a single lookup to verify practising status

Verbatim, from the search page itself (https://www.lawsociety.bc.ca/lsbc/apps/lkup/directory/mbr-search.cfm):

> "This service is provided to permit you to search for individual lawyers you may wish to contact on a professional basis or to verify their status. The information is not to be used for any commercial, marketing or fundraising purposes."

This is the only clause found, on any lawsociety.bc.ca page reached, that states a permitted or forbidden purpose for using the directory. It names "verify their status" as an affirmatively permitted purpose, and names "commercial, marketing or fundraising purposes" as the forbidden purposes. It contains no separate numeric limit on lookups per person and no clause using the words "bulk," "automated," or "scrape."

No other page reached (the Terms of Use page, the "Finding a Lawyer" page, or the "About the Lawyer Directory" page) adds or repeats a purpose restriction; the "About the Lawyer Directory" page instead says only: "Your use of the Lawyer Directory is governed by and subject to the Terms of Use" (https://www.lawsociety.bc.ca/for-the-public/about-the-lawyer-directory/), which in turn (as noted in Section 2) carries no directory-specific clause.

### Re-checking status later

No page states a rule either permitting or forbidding a later re-check of the same lawyer. The only relevant statement found is the data-currency note on https://www.lawsociety.bc.ca/for-the-public/about-the-lawyer-directory/: "The Lawyer Directory pulls information from the Law Society databases regularly. A lawyer's status can change at any time. Contact Registration and Licensee Services to ensure you have complete, up-to-date information." This describes the data as changing over time but does not itself state a rule about repeat lookups.

### Distinguishing practising from non-practising, retired, suspended or disbarred members

The directory distinguishes:
- practising status (https://www.lawsociety.bc.ca/for-the-public/finding-a-lawyer/: "current practice status"),
- non-practising and retired members, the latter defined as "non-practising members who have practised law at least 20 of the past 25 years" (https://www.lawsociety.bc.ca/for-the-public/about-the-lawyer-directory/),
- former members, included for two years after ceasing membership, and disbarred members, included indefinitely (https://www.lawsociety.bc.ca/lsbc/apps/lkup/directory/mbr-search.cfm).

No page reached uses the word "suspended" as a named status category; the pages instead refer generally to "current practice restrictions," "discipline history," and "current regulatory proceedings" (https://www.lawsociety.bc.ca/for-the-public/finding-a-lawyer/), which may or may not be where a suspension would appear. See "Unestablished" below.

## Unestablished

- **Exact field layout of a search result row and of an individual member's profile page** (whether year of call, a direct email address, a member number, firm name or a phone number are shown as discrete, separately labelled fields). The pages describing the directory speak only in general terms ("contact information," "current practice status"). The search form at https://www.lawsociety.bc.ca/lsbc/apps/lkup/directory/mbr-search.cfm submits by POST; WebFetch renders pages as converted markdown and cannot submit a POST form or show the underlying HTML, so the live results list and a profile detail page could not be retrieved under the tools permitted for this task (WebFetch and WebSearch only, no browser automation). Establishing this would need a browser session that: loads the search form, submits one real last-name search, and records only the field *labels* shown on the results list and on one member's detail page — not that member's actual values.
- **Whether the live search form presents a CAPTCHA, rate limiting, or any other anti-automation challenge on submission.** Not visible in the markdown-rendered static page content returned by WebFetch. A browser session would need to submit the form (once) and observe whether a CAPTCHA or throttling appears.
- **Whether any LSBC page states an explicit numeric limit on lookups (e.g., "one lookup per applicant") or an explicit "no bulk extraction" clause.** None was found. The only purpose restriction located is the commercial/marketing/fundraising clause quoted in Section 3.
- **Whether "suspended" is used anywhere as a named status label distinct from "current practice restrictions" / "current regulatory proceedings."** Not found on the pages reached.
- A page titled "Lawyer Directory Important Notice," which appeared in search-result listings, returned HTTP 404 when fetched directly (https://www.lawsociety.bc.ca/working-with-lawyers/lawyer-directory-important-notice/); its content, if any, is not reflected in this file.
