# /timecamping — Vision

*The skill does not exist yet. This file states the design principle it must be built around, settled with Brahm on 2026-08-28 during the Telus walkthrough (#420). The full design: `Engineering/1. Design/2026-08-28_timecamping-evidence-first-design.md`.*

## The problem: LLMs are inference machines

An LLM is trained by being handed a chunk of data and practicing inference on it. It is not trained to stop and ask, "is there other data that the people training me might have, and forgot to include?" So when it meets time-tracking data one source at a time, it does what it was trained to do: it infers immediately, from whatever it has. Every partial view produces a confident, wrong conclusion — and each wrong conclusion gets recorded, poisoning the steps that follow and burning practitioner attention on questions that are artifacts of the model's own process.

## The worked example

One block of time, roughly 2:59–3:09 pm. Three sources, revealed one at a time — the way a naive pipeline meets them:

**Telus alone:** *"Phone call; duration 9m51s; start 2:59:01 pm; dial out; unknown number."* The model concludes: **"unknown caller, cannot classify."** It has converted its own ignorance into a recorded conclusion.

**Calendar next:** *"Appointment 3:00–3:30 pm; Call Mr. Smith."* The model searches Telus for calls starting **after 3:00 pm**, finds nothing — the call began at 2:59:01, 59 seconds before the appointment — and concludes: **"no call found; conference call likely cancelled; confirm with practitioner."** A mis-scoped query's empty result treated as evidence of absence, and the human's attention spent confirming a non-event.

**SyncoPaid alone:** screenshots show a demand letter *from Mr. Smith* on screen with **zero input for 8 minutes**, then 2 minutes viewing the practitioner's calendar. The model concludes: **"lawyer idle — likely non-billable; calendar shows many matters, impossible to assign; propose write-off."** It has read *being on the phone* as idleness — zero keyboard and mouse input while a document sits on screen is exactly what a phone call looks like to a screen tracker — and judged the calendar by its contents instead of by why it was opened.

**The joined table:** the call *is* the scheduled Smith call, started a minute early and finished under the booked half hour. The still screen *is* the call — reading Smith's demand letter while talking to Smith about it. The calendar review *is* responsive to the letter's demand for chambers availability. One block, one matter, one description: *Phone to opposing counsel regarding demand letter and canvassing availability for chambers.* Fully billable. And the proof runs both ways — the Telus row rescues the "idle" screenshots, and the screenshots give the anonymous number its subject matter.

Three contradictory wrong conclusions from partial views; one nearly self-evident right conclusion from the whole.

## The principle

**Inference is forbidden until evidence assembly is complete — enforced by pipeline structure, not prompt instructions.**

An LLM will always infer from whatever it is handed. Telling it to wait is unreliable; the fix is controlling what it gets handed and when. So the pipeline's first stages are deterministic plumbing with no inference surface at all — enumerate every source, populate every source's table in full, splice everything into one consolidated time table — and only then does the model see anything. It cannot infer from a partial view because it never sees one.

## Why the unit of review is a whole day, never a matter

The same principle sets the unit of review: one day, every block in it, for every client, judged together. A review that walks one matter's entries is another partial view, and it fails in four ways (Brahm, 2026-11-10):

- **The same time billed to two clients.** Each block of a day goes to exactly one matter only when the whole day is classified at once. Reviewed matter by matter, two reviews can each claim the same half hour, and a bill that charges two clients for one stretch of time cannot be defended.
- **Time on the wrong matter is never found.** An entry put on the wrong matter does not appear in a review of the right one, and it looks plausible in a review of the wrong one. Only the whole day shows it.
- **The day explains its own blocks.** A few screenshots and a note are often unreadable alone. The morning's call, the document opened at noon or the email answered after lunch is often what tells what a later stretch was. The whole day is the context.
- **The day narrows the choice.** On any one day only a handful of matters are active. Seeing them all turns "which of every matter in the practice?" into "which of these four or five?", and forces a decision for every block instead of leaving gaps between matters.

So `/bill` hands `/timecamping` dates, never a matter's entries alone: each date is reviewed whole, and the bill takes its matter's share. A view filtered to one matter is only a view; it never changes what is reviewed.

## The corollary: ceremonies must be rare and non-repetitive

Human review is the scarcest resource in the pipeline, and it fails in a specific way: ceremonies that repeat for the same resolvable situation breed complacency — the human starts clicking Approve without reading. So review is confidence-gated, not default:

- When corroborated evidence carries the conclusion, commit silently. No ceremony.
- A ceremony fires only when the interpretation requires **disbelieving** a source (conflict) or **inventing** facts no source holds (lack of corroboration).
- Recurring single-identifier leaps (John Baker → L3156, confirmed again and again) graduate into practitioner-approved presumptions that stop asking — so the ceremonies that remain are the ones worth reading.
- The permanent exception: conclusions resting on **indirect evidence alone** — calendar entries, TimeCamp's keyword guesses, anything predictive or derived rather than a contemporaneous record of what happened — are ceremonied every time, forever. No run of past confirmations turns a prediction into a record. A calendar can promise a trial day; only the practitioner knows it didn't settle on the courtroom steps.
