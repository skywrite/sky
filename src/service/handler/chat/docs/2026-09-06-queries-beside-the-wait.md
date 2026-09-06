---
created: 2026-09-06
updated: 2026-09-06
---

# Queries beside the wait

The page reduced context searches to a count and showed the model wait
as a dashed text line. The full GraphQL was already in the context log,
but there was no way to inspect it from the conversation.

The activity row now sits with the user's message. Its query disclosure
stays mounted when the assistant's first token arrives and when the reply
finishes. Moving it from a waiting component into the reply would close a
query someone had opened while waiting.

The context model announces `context-queries` with its turn number and
full active query set. The first producer returns the query together with
its results, so the first announcement follows that producer; evolved
queries are announced before execution. The service retains the live set
so a reload during retrieval does not wait for the context log to catch
up. Completed and restored turns derive their sets from that log. The
Context timeline exposes the same text.

The set includes queries carried forward from earlier turns. It is
context provenance, not a claim that every query ran again. A closed
notebook shows no query set. An initial query returning zero paths is
still recorded: an empty search is useful evidence when investigating
why a reply did not find something.

Progress wording follows the current context/model event. Quiet reading
and thinking phases vary their wording every eight seconds without
inventing percentages or additional model calls. The timer runs across
phase changes; streaming, tool output, and approval cards provide their
own visible activity. Reduced-motion preferences disable the pulse.
