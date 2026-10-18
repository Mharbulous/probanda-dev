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

## 4. The rendered search results and detail page (issue #60, 2026-10-16)

Observed in a browser session on 2026-10-16: one search, on Brahm Dorst's own name, and his own detail page. Labels only; no values recorded. This section settles the first, second and fourth items under "Unestablished" above.

### The search form submits by GET, not POST

The "Unestablished" note above says the form submits by POST. It does not. The form uses GET, with action `mbr-search.cfm#act_searchresults` and these parameters: `txt_search_type` (1 = starts with, 2 = contains, 3 = exact match), `txt_last_nm`, `txt_given_nm`, `txt_city`, `member_search`, and hidden `is_submitted=1` and `results_no=10`. A results page is therefore an ordinary URL, for example `/lsbc/apps/lkup/directory/mbr-search.cfm?txt_search_type=3&txt_last_nm=<last>&txt_given_nm=<first>&txt_city=&member_search=Search&is_submitted=1&results_no=10`. A plain `curl` of that URL, with no browser and no cookies, returned HTTP 200 with the results table and the detail link.

### Search result row

- The results table has one column, "Name". Status, city and firm are not shown in the results list.
- The table has client-side controls: "Show 10/25/50/100 entries", "Filter:", "Showing 1 to 1 of 1 entries", and Previous/Next paging.
- Each name links to `mbr-details.cfm?encrypted=<opaque token>#_toph1`. The token is an encoded string, not a numeric member id, so a detail page cannot be addressed by member number. Reaching one means running a search first.

### Member detail page ("Lawyer's Profile")

URL path `/lsbc/apps/lkup/directory/mbr-details.cfm`, whose only query parameter is `encrypted`. The fields, in order, as labelled on the page:

1. Name, shown as the page heading, with no label.
2. "Current status". The value seen was "Practising".
3. "Call date". This is a full call date, not just a year of call.
4. "Primary location". The firm name.
5. "Contact address", followed by the links "[ Show Map ] [ Add to Outlook Contacts ] [ Show QRCode ]".
6. "Phone number", tagged "[Firm]".
7. "Fax number", tagged "[Firm]".
8. "Email". Not shown on the page. The page reads "To obtain this lawyer's email address, click here." That link runs `javascript:showcap();`, which reveals a CAPTCHA in an iframe (`iframeCaptchaForEmail`). The page has no `mailto:` link.
9. "Current practice restrictions". Empty state: "None".
10. "Discipline history since 1983". Empty state: "None".
11. "Current regulatory proceedings". Empty state: "None".

The page has no member number, website, areas of practice or languages. It carries no legend explaining statuses. Its other text is a pointer to the Unauthorized Practitioners database and a "Lawyers: Does your contact information need updating?" link.

### Anti-automation

- No CAPTCHA, interstitial, Cloudflare check or rate-limit message appeared on loading the form or on submitting the search. The form page's HTML contains none of "recaptcha", "hcaptcha", "turnstile", "captcha" or "cf-chl". The plain `curl` above also contained no "captcha".
- The detail page contains "captcha" (6 matches), all belonging to the email-reveal CAPTCHA. It loads no third-party bot-check script. Its only third-party scripts are Siteimprove analytics and Google Tag Manager.
- So the one CAPTCHA in the flow guards the email address, not the search and not the status. One search was run, so a rate limit triggered by volume was not tested.

### How a suspension would show

Status is a single labelled field, "Current status". Only the value "Practising" was observed. Whether a suspended lawyer's "Current status" reads "Suspended" or something else, or whether the suspension appears only under "Current practice restrictions" or "Current regulatory proceedings", could not be established from one practising member's page, and the page has no legend listing the possible values.

### Still unestablished

- The full set of values "Current status" can take, including the value for a suspended member. Settled, except for "Retired", by section 5.
- Whether high-volume searching is rate-limited.

## 5. The values of "Current status" (issue #64, 2026-10-18)

Observed with plain `curl` on 2026-10-18, with no browser: one search and one detail page per status class, through the ordinary search URL in section 4. Each candidate was chosen from a public LSBC source that states their status class: a discipline summary or consent agreement on lawsociety.bc.ca, or a candidate's own statement in an LSBC Bencher election package. Only the "Current status" value and its legend were read. No other field was recorded, and the email CAPTCHA was never opened. Names are left out on purpose.

### The categories LSBC defines

The Registration page (https://www.lawsociety.bc.ca/for-lawyers/registration-and-licensee-services/membership-category-change-and-voluntary-resignation/) says a lawyer who will not practise may apply for one of "three membership categories: Non-practising Retired Former (voluntary resignation)". The same page says membership also terminates on judicial appointment or on failing to pay the annual fee by December 31. Suspension and disbarment are discipline outcomes, not categories a lawyer applies for.

### Values observed

| Status class | Source of the candidate | "Current status" value, verbatim |
|---|---|---|
| Practising | Brahm Dorst's own record (as in section 4) | `Practising` |
| Non-practising | Bencher candidate's own statement, 2025 District 1 package: "currently a non-practising member" | `Non-practising` |
| Suspended | Rule 3-7.1 consent agreement approved 2026-04-10: "consented to a suspension of six months" | `Suspended*` |
| Former member | Rule 4-29 admission accepted 2026-04-02: resignation "effective April 9, 2026" | `Former member` |
| Disbarred | LSBC news item, April 2026: declared ungovernable and disbarred | `Disbarred` |
| Retired | not observed (see below) | not observed |

The asterisk on `Suspended*` belongs to the value. It points to a footnote at the foot of that member's page, verbatim: "*A suspended lawyer is temporarily disqualified from practising law. For more information on a suspended lawyer, or publically available information about a lawyer's professional conduct record, please call the Law Society at 604.669.2533 or 1.800.903.5300 (toll-free) /TTY 604.443.5700." So a suspension shows in "Current status" itself, not only under "Current practice restrictions". The `Non-practising` page carries no footnote. The `Former member` and `Disbarred` pages were not checked for one.

The value sits in the HTML as `<div class="col-sm-3 form-label">Current status</div>` followed by `<div class="col-sm-9">` holding `<p>VALUE</p>`.

### Retired: not observed

Three people described as retired lawyers on firm or roster pages (an ADR roster, a firm profile and a legal directory listing) returned no directory result under their surnames. Their pages may be out of date, or they may have left the Law Society more than two years ago, after which the directory drops former members. No current retired member was found from a public source, so the exact string is unobserved. The Registration page calls the category "Retired", and the About page (section 1) says retired lawyers are listed. The value is probably `Retired`, but that is unconfirmed.

### Not tested

- Whether an administrative suspension (for example for unpaid fees or a missing trust report) also shows as `Suspended*`, or under a different value. Only a discipline suspension was observed.
- Whether a member who resigned on judicial appointment shows `Former member` or something else.
- Whether a former member whose membership ended for non-payment shows `Former member`.

### The "exact match" search option does not match exactly

Section 4 maps `txt_search_type=3` to "exact match", and the form's own option list agrees (`1` starts with, `3` exact match, `2` contains). In use, `3` returned the same results as `1`. A last-name search for a four-letter prefix returned four members under both, and a search for one surname under `3` returned six members whose surnames only start with it. `2` ("contains") behaved as labelled. So a lookup by exact surname returns every surname that starts with it, and the caller must filter the names itself.
