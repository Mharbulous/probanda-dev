---
name: verify-bc-lawyer
description: Use when asked to verify someone is a licensed practicing lawyer in British Columbia, or to look up a BC lawyer's status, firm, or contact info - queries the Law Society of BC Lawyer Directory programmatically via Node.js with session cookie handling
disable-model-invocation: true
---

<!-- lawyer v0.25.4 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Verify BC Lawyer

## Overview

Programmatic lookup against the Law Society of BC (LSBC) Lawyer Directory. Requires a two-step HTTP flow with cookie persistence — the detail page returns 302 without valid session cookies.

## When to Use

- User asks to verify someone is a practicing lawyer in BC
- User asks for a BC lawyer's firm, status, or contact info
- User needs to confirm a lawyer's standing with the Law Society of BC

## Critical: What Does NOT Work

| Approach | Why it fails |
|----------|-------------|
| WebFetch | Summarizes HTML, strips form field names. Cookie-less = 302 on detail page |
| curl | Shell escaping breaks the encrypted URLs with special chars |
| Guessed params (`lastname`, `firstName`) | ColdFusion uses `txt_last_nm`, `txt_given_nm` |
| POST method | Form uses GET only |
| Detail page without cookies | Returns 302 — requires CFID/CFTOKEN/JSESSIONID from search |
| Inline `node -e` | Regex patterns with backslashes break in shell. Run the shipped `.cjs` file |

## The Working Flow

The shipped script below does this. The steps are recorded so a failure can be diagnosed.

### Step 1: Search (GET, captures cookies)

```
GET /lsbc/apps/lkup/directory/mbr-search.cfm
  ?txt_search_type=1          # 1=starts with, 2=contains, 3=exact match
  &txt_last_nm={LAST_NAME}
  &txt_given_nm={FIRST_NAME}  # optional
  &txt_city=                  # optional
  &is_submitted=1
  &member_search=Search
  &results_no=10
```

### Step 2: Parse search results

Regex: `href="mbr-details\.cfm\?encrypted=([^"]+)">\s*([^<]+)`

**CRITICAL:** Strip `#_toph1` anchor fragment from encrypted value before using it. The href contains `#_toph1` which causes 400 errors if included in the HTTP request.

### Step 3: Detail page (GET, with cookies from Step 1)

```
GET /lsbc/apps/lkup/directory/mbr-details.cfm?encrypted={ENCRYPTED_WITHOUT_FRAGMENT}
Cookie: CFID=...; CFTOKEN=...; JSESSIONID=...
```

### Step 4: Parse detail HTML

The HTML uses multiline label/value pairs (NOT on same line):
```html
<div class="col-sm-3 form-label">Current status</div>
<div class="col-sm-9">
  <p>Practising</p>
</div>
```

Use **multiline regex** with `[\s\S]*?` to span across lines. The shipped script does this.

## The script

The lookup ships as `scripts/lsbc-lookup.cjs`, using only Node's built-in `https` module, so it needs no install. From this skill's folder (the installed copy), quoting each name:

```bash
node scripts/lsbc-lookup.cjs "{LAST}" "{FIRST}"
```

The first name is optional. The script sends the name to `www.lawsociety.bc.ca` and nowhere else, tries "starts with" and then "contains", reads the first result's detail page, and prints the result as JSON. Never rewrite it inline with `node -e`: the regex backslashes break in shell escaping.

## Output Format

```
**Verification Result: {Name}**
- Status: {Practising / Non-practising / etc.}
- Firm: {Firm name}
- Location: {City, Province}
- Phone: {Number}
- Restrictions: {None / details}
- Discipline history: {None / details}
- Email: Not available (CAPTCHA-protected)
```

## Edge Cases

- **Multiple results:** Show all names in `allResults`, ask user which to look up in detail
- **No results:** Report "Not found in LSBC directory" — may be unlicensed, retired, or name spelling differs. Script auto-falls back from "starts with" to "contains" before reporting not found.
- **Non-practising status:** Lawyer exists but is not currently licensed to practice
