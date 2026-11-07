# Email dedupe: compare links and inline images (not yet on main)

Saved from the `claude/gracious-mccarthy-fgdekf` branch (commit `5e21add5`, 2026-11-02) before that branch was deleted. The branch built `/deduping-email` as a host Python script. Main rebuilt it as MCP tools (`source/lawyer/mcp/src/mail/dedupe.ts`, `.claude/skills/shared/mail-judging.md`, the `lawyer:email-reader` agent), and that design replaces the script. What main lacks is the comparison evidence below. Nothing here is built.

## What main lacks

Main records `html_sha256` and `other_parts` per copy, and rule 9 of `mail-judging.md` treats an unreadable inline image as not a source of facts. It has no handling of:

1. **Links.** The `href` addresses and plain-text URLs of each copy, with the destination decoded where a mail filter rewrote them after delivery (Microsoft Safe Links, Proofpoint URL Defense v2 and v3).
2. **Inline images.** Images the HTML shows (an image part with a Content-ID or an inline disposition) listed apart from attachments, each with its sha256.
3. **Missing inline images.** A `cid:` reference in the HTML with no image part in that copy.
4. **Hints** comparing two copies on each of these.

## Rules the branch added to the judge

- Critical, so the copy that still has it is kept: body text, quoted chain, embedded images, original link addresses, attachments by content, and the sender's headers (`from`, `to`, `cc`, `subject`, `date`).
- Not critical, so a copy differing only by it can go: anything added after delivery (mail-program notes, "external email" banners, list footers, rewritten links, delivery headers).
- A copy with a rewritten link lacks the original address unless another kept copy has it: keep a copy that shows the original.
- A copy missing an inline image that another copy has lost that image: keep the copy that still has it.
- A different `to` or `cc` is the sender's content: each copy holds something the other lacks, so keep both.
- When it is unclear whether a difference is the sender's or a later addition, keep both.

## Working decode logic from the branch (Python, tested there)

```python
_HREF = re.compile(r"""(?is)<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
_IMG_SRC = re.compile(r"""(?is)<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
_PLAIN_URL = re.compile(r"""(?i)\bhttps?://[^\s<>"'\)\]]+""")
_TRAILING_PUNCT = ".,;:!?'\""

def _is_inline_image(part):
    """An image leaf the HTML shows in the body: it has a Content-ID or an inline disposition."""
    if part.is_multipart() or part.get_content_maintype() != "image":
        return False
    disp = (part.get_content_disposition() or "").lower()
    if disp == "attachment":
        return False
    return bool(part.get("Content-ID")) or disp == "inline"

def _decode_urldefense_v3(rest):
    """Proofpoint v3: https://urldefense.com/v3/__<url>__;<base64 of replaced chars>!!<sig>$"""
    m = re.match(r"__(.*?)__;([A-Za-z0-9+/=_-]*)!!", rest, re.S)
    if not m:
        m = re.match(r"__(.*?)__", rest, re.S)
        return m.group(1) if m else None
    url, enc = m.group(1), m.group(2)
    if "*" not in url:
        return url
    try:
        enc = enc.replace("-", "+").replace("_", "/")
        chars = base64.b64decode(enc + "=" * (-len(enc) % 4)).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    out, k, i = [], 0, 0
    while i < len(url):
        if url[i] == "*":
            # "**A" style runs encode several characters; a single "*" is one character.
            if url[i:i + 2] == "**" and i + 2 < len(url):
                count = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".find(url[i + 2]) + 2
                out.append(chars[k:k + count]); k += count; i += 3
                continue
            out.append(chars[k:k + 1]); k += 1; i += 1
            continue
        out.append(url[i]); i += 1
    return "".join(out)

def decode_rewritten_link(url):
    """(original destination, rewriter) for a link a mail filter rewrote after delivery."""
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    try:
        if host.endswith("safelinks.protection.outlook.com"):
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            if q.get("url"):
                return q["url"][0], "safelinks"
        elif host == "urldefense.com" and "/v3/" in url:
            orig = _decode_urldefense_v3(url.split("/v3/", 1)[1])
            if orig:
                return orig, "urldefense"
        elif host == "urldefense.proofpoint.com" and "/v2/url" in url:
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            if q.get("u"):
                enc = q["u"][0].replace("_", "/")
                enc = re.sub(r"-([0-9A-Fa-f]{2})", r"%\1", enc)
                return urllib.parse.unquote(enc), "urldefense"
    except ValueError:
        pass
    return url, None
```

Per copy the branch recorded: `links` (`url`, `original`, `rewritten_by`), `images` (`content_id`, `filename`, `size`, `sha256`), `image_refs`, `missing_inline_images`, and `sender_headers`. Per pair it added `links_equal`, `links_i_subset_of_j`, `links_j_subset_of_i`, `rewritten_links_i/j`, `images_equal`, `images_i_subset_of_j`, `images_j_subset_of_i` and `sender_headers_equal`.

## To build it on main

Port the fields into `ComparedCopy` in `source/lawyer/mcp/src/mail/dedupe.ts` (TypeScript, so the decoder above is re-written, not copied), add the rules to `.claude/skills/shared/mail-judging.md`, add tests with real Safe Links and URL Defense samples, then run `python scripts/build_plugin.py` and release `lawyer`. Adding fields the old copy ignores is a patch release. A decision to change what the judge keeps or removes is the developer's.
