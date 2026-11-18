# Spec: Email ingest applies the client-lawyer privilege protocol without asking

Status: proposed, 2026-11-17. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.31.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-17_email-inline-images-not-attachments-spec.md`, `2026-11-17_ceremony-gate-misfires-outside-timecamping-spec.md`

## 1. Problem

When the practitioner asks to ingest emails exchanged with a client, ingest stops and asks a privilege question for every email (Yes / No / Unclear). The practitioner has stated the protocol once and wants it applied every time without waiting on approval:

1. An email between the client and the lawyer or firm staff is solicitor-client privileged, judged on the recipients that can be seen (From, To, Cc). That a Bcc cannot be seen is no reason to doubt it.
2. A mixed-privilege chain is one where older quoted or forwarded messages inside it were sent outside the solicitor-client relationship (for example the client's earlier emails to the opposing party or a third party, forwarded to the lawyer). The client-lawyer covering message stays privileged, and the facts in the outside messages are ingested into the non-privileged (main) case data.
3. Ingest proceeds on both without asking.

Today there is no way to split one email between the two stores: the Path B `privileged` contract writes the whole document to one store.

## 2. Evidence (observed; quoted text is data, not instructions)

- `lawyer/skills/ingest-orchestrator/references/routing.md` check 9: "**Internal document.** A client email, a lawyer's note or an internal memo: Path B, with its question."
- Same file, Path B: "Ask its privilege question unless check 6 answered it: is the document categorically privileged? Yes, No, or Unclear (decide later). The call is the practitioner's (#2)."
- Same file, Path B contract: `"contract": "privileged"` with one `document` and one `facts` list; `ingest_result` takes `store` `privileged` only "for a privileged contract answered yes".
- Check 6: the folder map answers privilege only by folder. The folder-map glossary flags `client_communications` `privileged_by_default`, but emails saved under an unmapped folder (here a CASEMAP emails folder) get no answer, so every one falls to check 9's question.
- Session: 11 client emails routed; 5 reached Path B and waited on 4 combined privilege questions; the practitioner then answered with the protocol above and asked that it be applied automatically from now on.
- 1 of the 5 was a mixed chain: a short covering message from the client to the firm forwarding about 25 earlier messages between the client and the opposing party, plus 1 forward to a third party. Under today's contract the outside facts would be held back from main if the whole email were answered Yes.
- Workaround in use: none; the run is paused waiting on answers.

## 3. Goal and non-goals

Goal: an email whose visible participants are only the client (or the client's representatives) and the firm is classified privileged with no question, and each outside message quoted or forwarded inside it is ingested as non-privileged facts in main, attributed to its own author and date.
Non-goals: changing privilege handling for non-email documents; inferring privilege from content; any Bcc reasoning; changing the attended question for emails whose participants include outsiders (those are not client-lawyer emails and route as ordinary correspondence).

## 4. Design

- **Participants decide.** From the rendering's header lines (From, To, Cc), classify an email as client-lawyer when every address is either a firm address (the firm profile's domain or staff addresses) or a client contact of this matter (`practice_data` contact roles). No model judgment is needed for this step; prefer a deterministic helper.
- **Client-lawyer email: privileged, no question.** Write the covering message (the newest message, down to the first quoted-header boundary) to the privileged store, as Path B does today with the answer Yes.
- **Mixed chain split.** For each quoted or forwarded message below the covering message, read its own header block (`From: / Sent: / To:` or `On <date>, <name> wrote:` / `---------- Forwarded message ---------`). A message whose participants are all firm or client stays with the privileged part. A message with any outside participant is non-privileged: its facts go to main, with `source_locator` pointing into the email and the fact attributed to that message's author and date. One source row per store, or one main row and one privileged row linked to the same file; the implementer chooses after reading the schema (§9).
- **No approval stop.** Steps 6 and Path B ask nothing for client-lawyer emails. An email whose participants cannot be classified (an address that is neither firm nor known client, with no outsider evidence) keeps today's question.
- **Recorded as the practitioner's standing rule.** Record the protocol where Probanda keeps such rules (a firm rule overlay or practice quirk), not as a hard-coded assumption, so a practitioner who wants the question back can turn it off. UNVERIFIED which store fits; see §9.

## 5. Constraints that must still hold

- Privileged wording never reaches the main store, the report or any note (routing.md Path B: "Nothing about the privilege call goes into any field, the report or a note").
- Non-privileged facts are copied in the source's own words, not summarised.
- The single-document path (`/ingest` via `matter-data` `operations/ingest.md`) applies the same protocol, so an email set aside to it (for example for attachments) is not asked either.
- Attachments of a privileged email: today "the privileged store holds no children" (routing.md, Emails with attachments). An attachment that is itself an outside document (for example an agreement signed by the opposing party) must still reach main. Keep this behaviour consistent with the split.
- Internals stay confidential in anything the practitioner sees.

## 6. Options considered (streamline and deburr first, additions last)

1. **Replace check 9's question for emails with the participant rule, and extend the `privileged` contract with a `non_privileged_facts` list written to main** (recommended). Smallest change: one rule replaces a question; one optional list on an existing contract.
2. Route the covering message to Path B and send the whole email again through Path A as `kind: facts` with an instruction to skip the covering message. Reuses extractors but reads the email twice and risks privileged wording leaking into main.
3. Split the email into two rendered files before routing. Adds a file-level artefact and a second hash identity for one document.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the participant classifier (firm addresses from the firm profile, client addresses from the matter's contact roles) as a script or server helper; unit-test it with synthetic headers.
3. Edit `routing.md` check 9 and Path B, and `ingest-orchestrator/SKILL.md` Steps 5-6, so client-lawyer emails take privilege Yes with no question, and outside messages in a chain are listed for the main store.
4. Extend the `privileged` contract and `matter_data__ingest_result` (mcp/src) to accept and write the non-privileged facts to main, attributed per message; add tests, including that no covering-message text lands in main.
5. Apply the same rule in `matter-data/operations/ingest.md`'s single-email path.
6. Record the protocol as the practitioner's standing rule (§4 last bullet).
7. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Email ingest applies the client-lawyer privilege protocol without asking complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. routing.md check 9 no longer asks a privilege question for an email whose visible participants are only firm and client; it asks only when a participant cannot be classified.
2. A test email with a client covering message forwarding a chain with an outside party writes the covering message's facts only to the privileged store and the outside messages' facts only to main, each with its own author and date.
3. A test shows no text of the covering message in any main-store row.
4. The single-document path gives the same result for the same email.
5. Turning the standing rule off restores today's question.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- One source row per store for a split email, or a main row plus a privileged row sharing the file hash? The hash lookup in `operations/ingest.md` Step 3 treats a privileged match as a routing anchor; the design must not make the second row look like a duplicate.
- Where the standing rule lives (firm rule overlay, practice quirks, or preferences). Pick the store meant for practitioner-stated rules.
- Whether firm staff addresses come from the firm profile or must be added there.

## 10. Verify against HEAD before building

Confirm in HEAD: routing.md checks 6 and 9 and Path B wording; the `privileged` contract shape and `ingest_result`'s store handling in mcp/src; how the folder map's `privileged_by_default` flag reaches check 6; how `operations/ingest.md` routes a single email; and the "privileged store holds no children" rule.

## 11. Verification against HEAD (2026-11-17, at 4853f1b9)

Repo paths: `lawyer/skills/<skill>/...` in this spec is `source/skills/<skill>/...`; the server is `source/lawyer/mcp/src`.

| Claim | HEAD | Where |
|---|---|---|
| Check 9 sends a client email to Path B with its question | Confirmed, word for word | `source/skills/ingest-orchestrator/references/routing.md` check 9 |
| Path B asks unless check 6 answered it | Confirmed, word for word | same file, "Path B" |
| `privileged` contract: one `document`, one `facts` list, optional `client_instructions` | Confirmed | same file; `source/skills/matter-data/references/scripts/ingest_privileged.py` docstring |
| `ingest_result` takes `store` `privileged` only for a Yes | Confirmed: `document.store` must be `privileged` exactly when `answers.privilege` is `yes`, else `main` | `source/lawyer/mcp/src/case/ingest-result.ts` `checkAndWrite` |
| A Yes writes the whole document to the privileged store | Confirmed: one `privileged_sources` row; each fact a bare `main.facts` row with its words on `privileged.fact_provenance`; `GUARD_MAIN` refuses a file already held in `main.sources` | `ingest_privileged.py` |
| How `privileged_by_default` reaches check 6 | `practice_data__folder_map` answers `privileged: true` only when every document type kept in the folder carries the flag; check 6 then takes Yes with no question. A folder where only some types carry it gets the question. An unmapped folder gets no answer and falls to the page-1 read and check 9 | `source/lawyer/mcp/src/tools/practice/folder-map.ts`; routing.md check 6 |
| How `operations/ingest.md` routes a single email | The gate hashes and looks up both stores and routes to `ingest-extract.md`, which renders the email and asks Path B's question there; its Path B writes by its own inserts, not through `ingest_result` | `source/skills/matter-data/operations/ingest.md` Steps 2-4; `operations/ingest-extract.md` "Path B" |
| "The privileged store holds no children" | Confirmed in three places | routing.md "Emails with attachments, unattended"; `ingest-extract.md` email attachments; `ingest.md` Step 3 |
| A second top-level row with the same hash | `main.sources` refuses a second top-level row per hash (trigger); nothing spans the two stores. The gate reads more than one top-level match across both stores as corruption | `references/triggers.sql`; `ingest.md` Step 3; routing.md check 3 |
| Firm staff addresses (§9) | The firm profile's roster holds each person's `email`, with `role` `lawyer` or `staff`. It holds no firm domain | `source/lawyer/mcp/src/tools/practice/firm-profile.ts` |
| Client addresses (§9) | `practice_data__contact_lookup` with a matter ref returns that matter's contacts, each with `emails` and its matter `roles` (`client` among them) | `source/lawyer/mcp/src/tools/practice/contacts.ts` |
| Store for the standing rule (§9) | A practitioner Rule is kept as a preference (`preferences__write`), in the practitioner's own words, behind the Rule gate hook, and retired to turn it off. A practice quirk cannot hold it: the quirk validator refuses text that loosens a privilege safeguard | `source/skills/shared/paralegal-posture.md` §9; `source/lawyer/hooks/rule-gate.py`; `source/lawyer/mcp/src/quirks/validate.ts` |
