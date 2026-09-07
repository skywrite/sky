---
created: 2026-09-07
updated: 2026-09-07
---

# Research results and the speaking handoff

A deep public investigation could fail immediately, followed by Sky reading
a short fallback answer and Sunny announcing that no research was available.
The contradictory exchange came from several independent boundaries.

The OpenAI provider in the installed AI SDK translates a named `web_search`
tool choice into its native `web_search_preview` alias. Voice supplies a
custom function called `web_search`, so the request was rejected before the
first search. Requiring a tool while making only the custom search function
active preserves the intended first action without selecting the native
alias. A provider-wire regression exercises this serialization, rather than
only substituting a model mock above it.

The research engine also cut completed answers at fixed character counts,
adding a report-truncation marker even when the model had finished its
sentences. Those cuts are removed. Generation and retrieval remain bounded;
deep research gets room for reasoning and keeps thirty seconds within its
existing deadline for one final synthesis from actually-read excerpts if a
later step fails. Cached web pages support excerpt continuation, so the
researcher can read beyond the first section without downloading it again.

The service previously flattened research to prose, discarding any outcome
distinction. Results now carry `complete`, `partial`, or `failed` status with
their answer and sources. A partial investigation must not turn into a claim
that successful page reads never happened. Internal limits and provider errors
are diagnostic context; spoken limitations describe the material unanswered
question.

The browser used to request another Sky response after starting research and
give him the finished report before Sunny spoke. It now yields at the handoff,
sends him status only when research finishes, and shares the report evidence
after Sunny delivers it. A duplicate quick lookup for the same question does
not create a competing answer. Independent tool results, draft confirmations,
and user interruptions still get Sky's attention. Queued and interrupted
reports can both resume without another search; an empty or inaudible
presentation does not count as delivery.

The voice prompts keep clarifications to the missing question, retain an
explicit deep-research request across the next topic turn, and distinguish
Sunny's added findings or judgment from merely echoing Sky. This follows the
explicit trigger/action and concise clarification guidance in the
[OpenAI Realtime prompting guide](https://developers.openai.com/api/docs/guides/realtime-models-prompting).
All examples and verification data are synthetic.

If both synthesis attempts fail, partial results retain actual source excerpts
for Sunny to reason from. Their serialized JSON is capped at twenty-four
thousand UTF-8 bytes, with explicit excerpt limits; source references alone
would leave the speaking session without the facts it needs.

Verification: 118 focused tests and the full `bun run dev:check` gate passed.
A real Astra web investigation completed five model steps, read four RFC/MDN
sources, and returned a coherent comparison. Separate live Realtime browser
probes used synthetic evidence to test the actual prompts, tool selection,
controller, and audio handoff. The complete-result probe preserved deep intent
across topic clarification, selected `research_web` without `lookup_web`, and
let Sunny deliver the evidence and tradeoff without an earlier Sky answer.

The browser probes also exposed a remaining input limitation: spoken product
names can be misspelled in Sky's tool arguments even when the displayed
transcription is correct. A clearer-input repeat preserved the names, but
this is not proof that entity recognition is reliable. Raw private conversation
is not copied into public search queries as a workaround. Audible playback and
spoken wording were verified; subjective vocal naturalness still needs a
listener's assessment. On one failed fixture, Sunny used three sentences
despite the instruction to keep failure acknowledgements to one.

The final partial-result browser probe also passed: the user explicitly spelled
the synthetic product name, Sky selected deep research without a quick lookup,
and Sunny delivered the comparison with a specific remaining durability gap.
She did not call the research failed or narrate truncation/status fields.
Both audio streams were received, her final speech was audible, report evidence
reached Sky only after her speech finished, and End closed the call cleanly.
