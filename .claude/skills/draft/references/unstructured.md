Read when: the Writing is an Unstructured Writing (its kind is `unstructured`, or `unstructured-<recipient>` under `_NoVenue`), the venue and kind lookup creates one (`references/venue-and-kind-lookup.md`, step 5), the Sent write succeeds on one, or the assigned job's title starts with `Make ` and ends with ` a Structured Writing`.
Assumes SKILL.md is loaded. Rules are not restated here.

# Unstructured Writings

An Unstructured Writing is a Writing whose document type has no type file of its own at its venue. It is created on the venue's stock `unstructured` type and renders through the general renderer like any general Writing: caption, a link to the saved published form, the body and the signature block. Under `_NoVenue` it is created on the recipient's stock type, `unstructured-<recipient>`, which prints the date, the address, the body and the signature block, with no caption and no form link. The practitioner's own name for the document, such as "Notice of discontinuance", is the Writing's title, and the mockup's header names it as the Document Name beside `Document Type: Unstructured`. Its review, revisions, Job Board and Word document are any Writing's.

## 1. Saving it

The lookup creates it at once through `/drafting-data`'s creation write, with the stock kind, `unstructured` or under `_NoVenue` `unstructured-<recipient>`, and the practitioner's name for the document as its title. The save writes its two stock jobs, `Draft the Writing` and `Deliver`, by `/drafting-data`'s save idiom for an Unstructured Writing.

## 2. The saved form comes first

The venue's stock type links the saved copy of the form the venue publishes for this document, and the form's fixed wording is copied from that copy, never written from memory. A `_NoVenue` stock type links no form, and this section does not apply to it. Before any wording is written:

1. Ask the practitioner to save the published form, a PDF from the venue's own site where there is one, anywhere in the matter folder, and to say where.
2. Record that file as a document of the proceeding and link it to this Writing as its saved form copy, through `/drafting-data`, which says how a saved form copy is linked.

Until the copy is linked, the mockup prints a gap where the form copy goes, `open-items` reads unmet, and the filed render refuses `unwritten_gate_failed` naming `form-source`. Once it is linked, the mockup prints only a comment naming the document, and nothing reaches the filed face.

## 3. Drafting the body

The model writes the Writing's printed wording into its `body` slot through `/drafting-data` (under `_NoVenue`, the date and the address too, each into its own part), and nothing else. The renderer builds the mockup around it: the header, the caption, the signature block, the work markers and the Legend. The model never writes a mockup file and never adds a header, a legend or a heading of its own.

- **Only printed wording.** Every line of the slot is text that will be printed on the document as delivered. No commentary, suggestion, alternative wording, note to the practitioner or loose idea goes into it. A line that opens `Note:` or `Draft note:`, a bracketed placeholder such as `[insert date]`, a bare `TBD`, `TODO` or `TBC`, and an emoji outside the plugin's symbol table are flagged on the mockup and refuse the filed render (SKILL.md section 11, Refusals). A thought about the Writing is said to the practitioner in chat, or captured as an idea.
- **A form's fixed wording is copied.** Copy each sentence, heading and label the form prints from the linked saved copy, word for word, in the form's own order. Never write it from memory, from another decision or from a summary, and never improve it.
- **A blank is an underline.** Where the wording needs a fact the record does not hold, write a blank underline, `________`, with what it stands for in a comment after it: `________ <!-- date the order was entered -->`. Never describe the missing fact in words that would print. The mockup flags each underline for the practitioner, and a blank the venue's registry fills in may stay on the filed face.
- **The caption and the signature block are not written.** The renderer prints the caption from the proceeding and the signature block from the signer. Do not repeat either in the slot.

## 4. Word document and sending

At a venue, `/publish` with `publish-general` makes the Word document through the venue's generic template, with the caption. It is not a replica of the court's own Word form.

The Writing is recorded as sent or filed through `/drafting-data`'s Sent write, `drafting_data__record_sent`, as `references/letters.md` section 8 says for a letter: the date it went, and the copy as filed or sent. `drafting_data__record_filed` refuses a general Writing. The Sent write closes `Deliver`.

## 5. The conversion offer and job

**The offer.** When the Sent write succeeds on this Writing, offer in the same turn, as one question, to put the job `Make <title> a Structured Writing` on its Job Board, `<title>` being the Writing's title. Say what it does in plain words: it records this document's layout, so the next one of its kind is drafted from that layout, and it is unbilled firm work. Name no type file, stock type or folder code (`shared/internals-confidentiality.md`). On a yes, write the job by `/drafting-data`'s fixed text for it, on this Writing. On a no, write nothing.

No retirement is offered with it or after it: recording a Writing as sent never leads to a retirement offer (ADR 0042), so the Writing stays on its board until the practitioner asks to retire it (`references/retire-filing.md`).

**The job.** Its steps, in order:

1. **Compose the candidate layout** from the frozen Writing, its structure only: its stored layout and its body text, read through `/drafting-data`. Keep the stock type's parts in order and split its body into parts. Each span of fixed wording, the same in every document of this type (for a form, the form's own wording, as the linked saved copy prints it), is a `literal` part with that wording as its `text`. Each client-specific span, anything naming a party, a date, an amount, a file number or a fact of this matter, is a `slot:<name>` part named for what it holds, or an existing projection where one prints it (`caption`, `parties`, `addressee`, `sender`, `signature-block`). No client text goes into the layout, and it has no `form-source` part: the new type records the saved form as its source. Its `title` is the document type's own name, such as `Notice of discontinuance`, and its `folder_code` a short code in capitals for that type.
2. **Run `/localize`** with `operation: create`, the calling skill `draft`, the Writing's country, jurisdiction and venue (or `_NoVenue` with its recipient), the kind as named being the layout's `title`, the live matter, and `practitioner_layout` the composed layout. When the Writing links a saved form copy, pass `saved_copy` too: its path, the address of the page the venue publishes the form on, asked of the practitioner once when not known, and the date it was saved. On `created`, show the learned-file notice. An `excerpt_mismatch` names a `literal` part the saved form does not hold word for word: correct the part from the form, never the reverse, and run the create again. An `invalid_layout` names a part outside the vocabulary: recompose it as a slot or a projection, and run the create again. Relay an `ambiguous` return as `references/venue-and-kind-lookup.md` step 4 does, and any other refusal in one line, then stop.

Once the type file is written, the next lookup of that document type at that venue resolves to it, and the Writing created on it is a Structured Writing.
