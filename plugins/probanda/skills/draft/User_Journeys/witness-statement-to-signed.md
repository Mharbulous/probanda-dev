---
journey: Work a witness statement from empty to signed
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: a session opens on a matter whose submission needs a witness statement that does not exist yet — a fact has no one to prove it
outcome: over several sessions, one witness statement climbs from nothing to executed, each session starting from the regenerated mockup that shows exactly which rung the statement is on
path: happy
status: aspirational (desired UX — not yet verified against the implementation)
source: effort owner's flow selection, 2026-08-23; step 7 amended 2026-09-13 so paragraphs and fact links are read back, not composed (`Engineering/1. Design/2026-09-13_paralegal-posture-and-outline-vocabulary-design.md` §5.2)
---

# Work a witness statement from empty to signed

## The journey

1. **Practitioner:** opens a session on the matter. **Assistant:** regenerates and presents the mockups. On the submission mockup, a fact carries 👤 *no witness* — articulated, provable, nobody identified to prove it.

2. **Practitioner:** names the witness.

   > Jesse Marlowe can speak to that — he was on the site that week.

3. **Assistant:** records the attribution through `/drafting-data`, regenerates, and presents the witness-statement mockup as a file card. No approval pause before writing or rendering. The fact now sits in the statement's trailing to-do subsection at 🗣️ *talk to witness* — attributed, not yet interviewed. The statement itself shows no *sign it*: nothing has been drafted, so there is nothing to sign (see the paired data journey, `.claude/skills/drafting-data/User_Journeys/fact-work-on-the-witness-statement.md`).

4. **Practitioner:** conducts the interview away from the assistant — days later, in a new session — and returns with the account.

   > I spoke with Jesse. Here's what he actually saw...

5. **Assistant:** stores the oral account, marks the interview done, regenerates. The rung advances to ✍️ *draft it* — the account exists, no paragraph carries it yet.

6. **Practitioner:** asks for the statement to be drafted.

7. **Assistant:** keeps the account as given. Before anything is written, it reads back how the account divides into numbered paragraphs and which fact each paragraph proves, and asks the practitioner to confirm or correct each. Where the account is silent on a fact the statement needs, it asks rather than filling the silence:

   > The account doesn't say what day Jesse saw the crane arrive, and the delivery-date fact needs it. Did he tell you?

   Only then does it write the confirmed paragraphs and links through `/drafting-data`, regenerate, and present the mockup. Any 🧩 *gap* on a drafted paragraph with no fact behind it closes as facts get attributed. With at least one paragraph linked, the statement's own line now reads 🖋️ *sign it* — or ✒️ *swear it* where the instrument is an affidavit — reachable for the first time.

8. **Practitioner:** reviews the mockup, asks for wording changes the same way they asked for the draft. **Assistant:** writes, regenerates, presents — no separate revision mode. This review pass is also where exhibits meet witnesses: a paragraph that tenders a document is how the exhibit gets its sponsor (see `.claude/skills/drafting-data/User_Journeys/tender-an-exhibit-through-a-witness.md`).

9. **Practitioner:** obtains the signature — again away from the assistant — and reports it in a later session.

   > Jesse signed his statement yesterday.

10. **Assistant:** records the execution, regenerates, presents. The statement's line is clean: no marker, nothing left to do on it. Whatever remains elsewhere on the submission still carries its own markers, and the next session starts from this same mockup.

## Principles this journey encodes

- **The mockup is the ladder.** Every session opens on the regenerated mockup, and the marker on each line is the one next action — 👤, 🗣️, ✍️, 🖋️ ⊕ ✒️ — without opening anything else or keeping a separate task list.
- **The assistant records rungs; the practitioner climbs them.** Interviewing the witness and obtaining the signature happen in the world, away from the assistant. The assistant's job is to store what the practitioner brings back, regenerate, and show the new rung — never to invent an account or backfill one. Paragraph breaks and fact links are read back for confirmation before they are written, and a silence in the account is asked about, never filled.
- **Nothing to sign until something is drafted.** *Sign it* becomes reachable only once at least one paragraph is linked to a fact — the mockup never asks a witness to execute an empty statement.
- **Write, render, no gate.** Every practitioner instruction lands in the database and comes back as a fresh mockup file card in the same turn. The mockup carries the review; conversation never substitutes for it.
- **Multi-session by design.** The loop assumes days between rungs. Because the rung lives in the data and renders on the mockup, no session depends on the last session's conversation to know where the statement stands.
