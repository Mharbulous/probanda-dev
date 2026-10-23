# E3: measuring /compare-documents and its cache warming

The procedure for experiment E3, which follows E2 (spec: `docs/Specs/2026-10-23_document-comparison-spec.md` §2). The maintainer runs it after the lawyer release that ships `/compare-documents` has synced to the machine. Check the time on the synced copy's `.last-complete-round` before starting.

## What E3 measures

1. **The real case.** The cost and wall time of `/compare-documents` on the E2 pair (a 74-page scanned affidavit and its flattened copy), against E2's three arms. Only one page differs, so this run dispatches one review agent and no warming happens.
2. **Cache warming.** Whether launching one review agent first makes the others' start-up prompt a cache read instead of a write. The key figure is each agent's first-call `cache_read` against its first-call cache write.

## Where the data goes

The `e3/` folder of the maintainer's token-test folder, laid out as `e2/` is:

```
e3/
  E3-prompt.md          this procedure's arms as run, with any deviation noted
  results/ledger.csv    one row per agent
  results/summary.csv   one row per arm
  tools/                the scripts below
  transcripts/<arm>/    each arm's session transcript and its subagent transcripts
```

`results/ledger.csv` has E2's columns (`agent_id, arm, pages, n_pages, status, verdict, model, effort, start_utc, end_utc, duration_s, api_calls, tool_uses, image_reads, first_call_prompt_tokens, input, cache_write_5m, cache_write_1h, cache_read, output, thinking, total_tokens, cost_usd`). It adds `first_call_cache_read` and `first_call_cache_write`, the latter being the 5-minute and 1-hour writes summed.

The transcripts and the pair hold client content. They stay in the token-test folder and never enter this repo, a commit, a fixture or a log. Cite only numbers.

## Arms

Run each arm in a **new session**, at least **6 minutes** after the previous arm's last agent ended, so that no arm reads a cache the one before it wrote. Time the gap yourself. E1's in-session waits were skipped, which made its timing results invalid. Use the same model settings as the installed plugin (the review agent is Haiku, high effort).

| Arm | Pair | What runs | Review groups |
|---|---|---|---|
| E3-real | the E2 original and its flattened copy | `/compare-documents` as a practitioner would ask it | 1 (one page) |
| E3-warm | the E2 original and a copy with 11 pages turned (below) | `/compare-documents` | 3 (4, 4 and 3 pages): the first launched alone, the other two after it returns |
| E3-cold | the same pair as E3-warm | the check, then the same three groups dispatched at once (below) | 3, all launched in one message |

**Making the E3-warm copy.** `tools/make_turned_copy.py ORIGINAL OUT` writes a copy of ORIGINAL in which pages 1 to 11 each have 90 added to their `/Rotate`. It uses pypdf, reads ORIGINAL only, and writes OUT into `e3/`, never into a matter folder:

```python
import sys
from pypdf import PdfReader, PdfWriter

reader = PdfReader(sys.argv[1])
writer = PdfWriter()
for i, page in enumerate(reader.pages):
    if i < 11:
        page.rotate(90)
    writer.add_page(page)
with open(sys.argv[2], "wb") as out:
    writer.write(out)
```

**E3-cold prompt.** Paste this into a new session opened on the machine that holds the pair:

```text
This is experiment E3, arm E3-cold. Call pdf_pages__compare with a = <original path> and b = <turned copy path>. Then, in ONE message, dispatch one lawyer:compare-pages agent per entry of review_groups, all as parallel calls. Each brief has one line per page of its group: the page number, its reasons, changed_share if present, and its a and b image paths, in order. Nothing else goes in the brief. Report each agent's reply verbatim, then each agent's id.
```

E3-real and E3-warm are asked as a practitioner would: "Compare <original> with <copy> and tell me whether anything changed."

## Building the ledger

Copy each arm's session transcript and its subagent transcripts into `transcripts/<arm>/`. Build `results/ledger.csv` with the method of `scripts/token_test/token_ledger.py`: group each transcript's lines by API message id, count the last line of each call (it carries the final output count), and sum. The review agents' briefs carry no `RUN` tag, so pass `--all`. Prices follow the E1 and E2 ledgers: Haiku input 0.10, 5-minute cache write 0.125, cache read 0.01, output 0.50 USD per million tokens. These rates are not yet confirmed against published prices, so treat cost ratios as provisional.

Also record, per arm, in `results/summary.csv`: the wall time from the request to the answer, the check's own time (the tool call to its result, from the session transcript), the number of agents, and the summed tokens and cost.

## Reading the result

- **E3-real against E2.** Agent count, tokens, cost and wall time, against E2's fan-out (15 agents, 8,206,154 tokens, $0.285, 90.6 s) and its script (12.1 s).
- **Warming works** when, in E3-warm, agents 2 and 3 show a first-call cache write near zero and a first-call cache read near the size of agent 1's start-up prompt, while in E3-cold every agent writes its start-up prompt. If E3-cold's agents already read from the cache, warming adds a wait for no saving, and the warming step can be dropped from the skill.
- **Warming's cost** is the time agent 1 runs before the others start: compare E3-warm's and E3-cold's wall times.
