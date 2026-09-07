---
created: 2026-09-07
updated: 2026-09-07
---

# Voice web search

Browser voice had notebook and action tools but no web retrieval. Chat's
separate web adapter did not make those tools available to voice, and its
empty-array handling of search configuration and provider failures would
not distinguish those failures from an actual empty search.

Voice now owns its web retrieval alongside its notebook research code:

- Sky uses `lookup_web` for a quick public fact or a specific page. Qwen
  searches and reads within the existing small lookup budget.
- Sunny uses `research_web` for a deeper investigation. Astra can follow
  leads and compare source pages while Sky continues the conversation.
- Both deep research modes can combine notebook and web evidence where
  the question needs it. Ordinary conversation and greetings still use
  `invite_sunny` without starting research.

The web adapter calls Perplexity Search with the service's existing
`PERPLEXITY_API_KEY`. Search results provide leads; a successful page read
is required before a web answer can pass the evidence check. URLs of read
pages remain attached to the result and reach both voices as reference
text. Spoken replies identify sources naturally rather than reading URLs.
Quick lookup evidence is also supplied to Sunny before a conversational
handoff, including when Sky requests the lookup and her turn together.

Web lookup receives only its public question, without the initial notebook
snapshot. The browser also avoids appending private conversation to
`research_web` requests. When deeper reasoning combines private and public
evidence, its instructions permit only public search terms authorized by
the question; private notebook-only details are not search terms by default.

Page reads validate public HTTP(S) destinations, pin the resolved address,
and validate each redirect. Search responses, downloaded bodies, extracted
text, tool calls, and total execution time have separate bounds. Empty
results, missing configuration, rejected credentials, blocked pages,
unsupported content, and timeouts return distinct failures. Search snippets
alone do not become a grounded answer when the page cannot be read.

The browser's existing turn control handles both kinds of background
research: acknowledge the job, wait for a speaking gap, deliver Sunny's
report, preserve interrupted reports for resumption, and cancel on End.

## Verification

A live browser call with synthetic speech exercised both real web paths.
Qwen searched and read Mozilla's HTTP 429 reference before Sky answered.
Astra read four Mozilla pages to compare HTTP 401 and 403, and Sunny
delivered the comparison with source attribution. Both connections received
audio, playback intervals did not overlap, no browser or API errors occurred,
and End closed both connections.

The final targeted voice, controller, service-route, and settings run passed
95 tests. The project's lint and extension checks passed independently;
the full gate encountered unrelated workstreams changes still in progress.

Focused tests cover public-only lookup context, mixed notebook/web research,
the page-evidence requirement, provider failures, blocked pages, URL and
redirect checks, DNS pinning, bounded reads, and cancellation. The browser
regression also checks that a public web request does not pick up an unrelated
private conversation. These checks do not establish physical microphone echo
performance or guarantee every website permits text retrieval.
