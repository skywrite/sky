---
created: 2026-09-06
updated: 2026-09-06
---

# One Sources list under a reply

A reply that searched the web ends in a list of the pages it read, headed
`Sources:`, appended by the session when the turn ends. The model often
names its sources too, in the same shape, at the end of its own text. A
saved turn then carried two lists back to back, and the page folded only
the last one: the reply body still showed the model's list above a
"Sources · 20" fold, on the live page and again after a reload.

Now `withSources` (`#universal/ai/sources.ts`, shared with the page) takes
the reply's own list off first and writes one list: the reply's addresses
in its own order, then the searched pages it did not name, each once.
`splitSources` strips every trailing list, so the page folds older
transcripts that carry two the same way, and a reply that has just
finished is folded through the same pair of calls as a saved one.

Verified 2026-09-06 on a saved chat whose third reply carried two lists of
the same twenty addresses: the page shows the body without either, and one
"Sources · 20" fold under it.
