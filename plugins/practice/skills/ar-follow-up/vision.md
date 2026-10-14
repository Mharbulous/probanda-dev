# AR Follow-Up — Vision & Design Philosophy

**Date:** 2026-04-14

## 1. Platform & Scope

A skill within the CoClerk Cowork plugin for BC litigation practice management. Consumes data from the shared SQLite database (retainer balances from retainer-tracking, WIP hours from practice-data, court dates from the docket-clerk agent, invoice status from invoice-tracking) and produces a prioritized, consolidated "money conversation" list per client.

Does not own any upstream data — reads only. Owns payment-in-flight state (client has sent payment, awaiting bank clearing) and retainer policy advisory logic.

## 2. Purpose

### Audience

A sole BC litigation practitioner managing retainer-funded client matters alongside a legal assistant.

### Pain Points

- **Fragmented asks:** Without a consolidated view, the practitioner asks a client to pay an outstanding invoice, then separately asks for retainer replenishment — frustrating the client ("Why didn't you just ask for the full amount?") and eroding trust.
- **Late retainer requests:** Forgetting to request retainer replenishment early enough before a hearing or trial means arriving at court without funded retainer — economically damaging and avoidable.
- **Invisible AR state:** Outstanding invoices, depleted retainers, unbilled WIP, and upcoming court-date-driven retainer increases live in different systems. The practitioner has no single view of the total financial picture per client.
- **Reminder noise during clearing:** Sending payment reminders to a client who has already paid but whose funds haven't cleared the bank yet damages the client relationship.

### Value Proposition

One consolidated money conversation per client, timed early enough that funds clear before the work or court date that requires them. The practitioner never has to go back for a second ask, and never arrives at a hearing without adequate retainer because they forgot to request it in time.

### Killer Use Case

A trial is scheduled 130 days out. The client's retainer is depleted, there's $2,400 in unbilled WIP, and a $800 invoice from last month is unpaid. AR Follow-Up surfaces this client at the top of the list with a single consolidated ask: "$800 outstanding invoice + $2,400 unbilled WIP + $5,000/day trial retainer = request $X by [date], so funds clear 90 days before trial." One conversation. One number. No follow-up surprises.

## 3. Theme & Design Philosophy

### Design Principles

**3.1 One Conversation, One Number**

Every client interaction about money should be a single, complete ask. The skill must consolidate all outstanding amounts (invoices, WIP, retainer shortfall, upcoming court-date increases) into one total before surfacing the client for follow-up. Never surface a client for just one component when other amounts are also outstanding.

**Violation example:** Surfacing "Smith owes $800 on invoice #1234" without mentioning the depleted retainer and upcoming hearing that will require an additional $5,000.

**3.2 Time the Ask to the Calendar**

Prioritization is driven by court date proximity, not just amount owed. The skill must apply retainer agreement timing rules:
- Trial: request substantial retainer at least 120 days before trial, due 90 days before trial
- Hearing: request $5,000/hearing-day retainer at least 2 weeks before hearing date
- No upcoming dates: standard $3,000 base retainer replenishment

**Violation example:** Ranking a client who owes $10,000 with no upcoming dates above a client who owes $3,000 with a hearing in 3 weeks.

**3.3 Suppress During Clearing**

When the practitioner records that a client has sent payment, suppress all reminders for that client until either the payment clears (confirmed by retainer-tracking's next import) or the clearing window expires without confirmation. Do not treat the retainer as funded during this period — just stop asking.

**Violation example:** Continuing to surface "Smith — depleted retainer" after the practitioner noted that Smith sent an e-transfer yesterday.

**3.4 Advise on Policy, Not Exceptions**

The skill states what retainer policy requires (continue work, cease work, or consider withdrawal) based on the financial picture. It does not advise on whether to make exceptions. The judgment call belongs to the practitioner.

**Violation example:** "You should keep working on Smith despite the depleted retainer because trial is next month" — the skill should say "Policy: cease work pending replenishment. Trial in 30 days — consider implications."

**3.5 Show the Math**

Every follow-up recommendation must cite its components: current trust balance, outstanding invoices, unbilled WIP, upcoming court dates, retainer requirement, and the total ask amount. The practitioner must be able to verify the number before picking up the phone.

**Violation example:** "Call Smith about $8,200" without showing how that number was derived.

### Litmus Test

**"Does this help the practitioner know who to ask for money, how much to ask for, and how urgently?"**

- "Which clients need a money conversation this week?" — **Yes**, core scope.
- "How much does Smith owe in total including unbilled WIP?" — **Yes**, consolidated financial picture.
- "Draft a retainer replenishment letter to Smith" — **No** (wishlist feature, not core scope).
- "Has Smith's e-transfer cleared yet?" — **No** (retainer-tracking confirms via next CSV import).
- "Should I keep working on Smith even though the retainer is depleted?" — **No** (exception to policy is practitioner judgment).

## 4. Non-Goals

- **Drafting client-facing correspondence** — wishlist feature; the skill tells you who to call and what to ask for, not what to write.
- **Advising on whether to make exceptions to retainer policies** — the skill states what the policy requires; the practitioner decides whether to deviate.
- **Confirming deposits have cleared** — that's retainer-tracking's job when the next trust CSV is imported. AR follow-up owns "payment in flight" suppression, not deposit verification.
- **Trust accounting, reconciliation, or LSBC compliance reporting** — out of scope per the plugin's Vision.

## 5. North Star

**Zero surprise shortfalls.** The practitioner never arrives at a hearing, trial, or billing cycle and discovers they've been working without adequate retainer because nobody asked the client for money in time. Every money conversation happens early enough that funds are in place before the work or court date that requires them.

## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*
