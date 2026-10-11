# Classifying a contractual rate: fixed or floating

The single most consequential judgment call in this skill. Get it wrong and every downstream
number is wrong, even if the arithmetic is flawless -- so treat classification as its own
step, state the conclusion, and quote the clause language it rests on.

## The question

Does the interest rate the contract specifies change over the life of the debt as the
underlying benchmark (usually a bank's prime rate) changes, or was it fixed once and never
moves again regardless of what the benchmark does afterward?

## Language patterns that signal FIXED

- "at the rate of prime plus 2% **calculated as at** the date of this Agreement"
- "at a rate of 2% above the Royal Bank of Canada prime rate **in effect on** [date]"
- "the rate applicable **at the time of** default/breach/demand"
- A specific numeric rate stated with no reference to "from time to time," "as adjusted," or
  similar -- e.g. "interest at 9.2% per annum" with no floating mechanism described at all.
  This is the simplest fixed case: there is no benchmark to research at all, just the stated
  number.

In each of these, once you know the benchmark's rate on the one anchor date, the contractual
rate for the *entire* interest period is that single number. This is why a pleading can state
a flat percentage (e.g. "9.2% per annum") even though the underlying clause references a
bank's prime rate: the rate was pinned once, and the pinned figure is what gets pleaded.

## Language patterns that signal FLOATING

- "at the rate of 2% above the prime rate **as established by** the Bank **from time to
  time**"
- "at the Bank's prime rate, **as it may change**, plus 2%"
- "a variable rate equal to prime plus 2%, **adjusted automatically** on each change in the
  prime rate"
- Any clause that describes the rate moving *with* the bank's own rate changes throughout the
  loan or debt period, rather than freezing it at a moment.

A floating clause requires the benchmark's full rate history for the interest period, because
the "correct" rate genuinely differs day to day as the benchmark moves. Treat every rate
change during the period as a new sub-period boundary
(`subskills/contract-interest-rates/scripts/calculate_contract_interest.py`
does this automatically once given the schedule).

## When the clause doesn't say either way

Some clauses are genuinely silent or ambiguous -- e.g. "interest at prime plus 2%" with no
temporal qualifier at all. Do not default silently to either reading:

1. Check whether other clauses in the same contract, or the parties' course of dealing (e.g.
   invoices actually issued at a rate that moved with prime, or that stayed constant),
   resolve the ambiguity.
2. Check whether the pleading itself already answers the question -- a pleaded flat percentage
   (like "9.2% per annum") with no floating language is strong evidence the plaintiff is
   treating it as fixed (or that it happens to have never changed over the relevant period,
   which produces the same number as fixed but is not the same legal characterization -- note
   this distinction rather than collapsing it).
3. If still unresolved, stop and ask the practitioner rather than guessing. State plainly that
   the clause is ambiguous and what turns on the answer (a one-line estimate of how much the
   total could differ between the two readings, if the benchmark moved materially during the
   period, helps the practitioner decide how much the ambiguity actually matters here).

## Worked example (this matter, L3816)

Notice of Civil Claim para. 10: "It was an express term of the Fixed Price Contract that
interest would accrue on any payments the Defendant failed to make when due, at 2% above the
prime rate quoted by Royal Bank of Canada." Para. 12 then pleads the resulting figure as a
flat "9.2% per annum" with no floating language anywhere in the pleaded facts.

This reads as **fixed as pleaded**: the plaintiff has already pinned the rate to a single
number rather than describing it as tracking prime through the interest period. Before relying
on 9.2% for a calculation spanning any length of time, confirm against the actual contract
(not just the pleading) whether the underlying clause itself is fixed-at-a-date or floating --
the pleading collapsing it to one number is not itself proof the clause is fixed, since a
floating clause happens to produce one flat number if prime never moved during the relevant
window too. If the underlying contract is unavailable, say so and treat 9.2% as the pleaded
figure to verify rather than as a confirmed classification.

On a **default judgment** the contract is not self-proving: `default-judgment-proof.md`.
