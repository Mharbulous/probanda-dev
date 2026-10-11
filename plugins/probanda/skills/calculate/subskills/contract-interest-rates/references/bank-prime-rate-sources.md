# Sourcing a bank's prime rate

Use the benchmark bank's own publication to establish every rate and effective date. This
reference records source methods, not rate data. Rates change and publication identifiers can
be mispaired, so do not treat training data, an earlier matter's schedule, or a secondary
table as filing-grade proof.

## The bank's own pages

For RBC, use either or both of these official methods:

- **Aggregate history:** RBC's published prime-rate table,
  `http://www.rbcroyalbank.com/sdb/pdf/prime-interest_eng.pdf`. Open the live PDF and confirm
  that its title, dates, and rate column describe the contractual benchmark before relying on
  an entry.
- **Per-change announcements:** individual RBC newsroom releases using
  `https://www.rbc.com/newsroom/news/article.html?article=NNNNN`. Each release can serve as a
  separate citable and exhibitable record. Open the live article and record its
  dateline plus the sentence stating the new rate and effective date; the announcement date
  is not necessarily the effective date.

Other Canadian banks may publish announcements, a rate-history page, or both. Prefer the
contractual bank's own domain and publication over mirrors or synthesized histories.

## Browser-rendering constraint

RBC newsroom articles are JavaScript-rendered. A plain HTTP or text-only fetch may return only
a loading shell. Use a browser-capable session to inspect the rendered page. Search snippets
may locate a candidate release, but they do not verify its contents. Do not assign final
verification to a researcher limited to text-only fetches.

## Article/rate/date pairing rule

Treat an `{article, effective date, rate}` set as verified only after opening the article and
reading both its dateline and its rate/effective-date sentence. Search associations,
sequential article-number inference, and aggregator tables are locate-only methods. They do
not establish the pairing, even when several aggregators agree.

## Aggregators are locate-only

- A government or institutional history may track a different named bank. Confirm the series'
  bank before using it; do not relabel one bank's history as another's.
- A newswire may reproduce a bank release, but it remains a mirror. Cite the bank's live page
  in a court-facing artifact.
- Rate-comparison and mortgage aggregators can help locate or cross-check candidate changes,
  but their dates may represent announcement dates rather than effective dates. Confirm each
  entry on the bank's own publication.

## Do not substitute a US prime-rate series

US prime-rate series move on a different schedule from Canadian bank prime rates. A contract
referring to prime quoted by a Canadian bank means that bank's Canadian rate. Never substitute
a US series without expressly reporting that it is not the contractual benchmark.

## What to record for each rate

For every fixed anchor rate or floating-schedule entry, record:

- the bank and exact rate;
- the effective date, which becomes the calculator's sub-period boundary;
- the bank's own URL and access date;
- the publication's dateline, kept distinct from the effective date; and
- whether the figure is pleaded or requires sworn proof under
  `default-judgment-proof.md`.

Build a floating schedule chronologically for
`subskills/contract-interest-rates/scripts/calculate_contract_interest.py`. Add the contract's spread to each verified prime
rate before forming each `{"effective_date": "YYYY-MM-DD", "rate": <annual percent including
spread>}` entry; the calculator expects the all-in contractual rate, not bare prime.
