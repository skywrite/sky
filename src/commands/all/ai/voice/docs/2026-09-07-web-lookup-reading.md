---
created: 2026-09-07
updated: 2026-09-07
---

# Reliable web lookup steps

A browser request for the latest public model returned a no-readable-page
answer. Replaying the public query found usable search results and accessible
official pages, so a persistent network or page-access failure was not
reproduced. The research loop nevertheless allowed an automatic model step
to finish immediately after search snippets. The evidence guard would then
correctly reject the answer, even with usable page candidates waiting.

Web research now starts with a required search, or a required read when the
question already supplies an allowed public URL. Successful search leads,
attempted pages, and actual page evidence are tracked separately. When there
is no page evidence and an untried candidate remains, the next model step
requires `read_web_page`. A blocked first page can therefore be followed by
another candidate before the final synthesis step. The existing time, call,
download, and evidence limits still apply. Missing configuration and empty
results do not force a nonexistent page read.

The replay exposed another defect: a historical release announcement could
be mistaken for the current latest release. Both web modes now receive
today's date and instructions to prefer maintained catalogs, reference
documentation, and changelogs; historical announcements need a freshness
check. Search snippets remain navigation aids, and final claims and source
attributions must be supported by pages actually read.

Prompt changes alone did not reliably correct Qwen with reasoning disabled.
Three live comparisons using `low` reasoning all selected current official
references and answered the latest-model question correctly, in 1.39–3.45
seconds. Web lookup therefore uses `low` in its local clone of the default
Qwen profile. Notebook lookup keeps `none`, explicit alternative profiles
retain their settings, and shared chat profiles are not modified. These
samples support the choice without establishing universal factual accuracy.

Regression tests exercise the actual tool controls: a model that would stop
after snippets must read a page; a blocked page followed by a readable
candidate fits the four-step fast budget; empty and missing-key searches
retain their real limitations. Both web modes receive the freshness context.

## Browser follow-up

The first live browser checks exposed failures that the direct backend
question did not. Sky expanded the current-model question into release
announcements and extra details, changing which evidence the researcher
sought. Another run read an announcement index, searched for the specific
source, and exhausted the four-step lookup budget before it could read that
source. Qwen then emitted textual tool-call markup in the answer position,
which left Sky without a useful report despite successful network access.

The host prompt and web-question contract now preserve exact product/model
terms and the user's requested scope. Quick web lookup allows six model
steps, enough for search, read, follow-up search, follow-up read, and synthesis.
It retains the twenty-second deadline and six-tool-call limit, and the last
step explicitly requests a spoken answer with tools disabled. Raw tool-call
markup is rejected as unfinished synthesis. Notebook lookup keeps four
steps. Regressions verify the extra page read and the bounded final step.

Review also found a shared download-budget race: two readers could each
calculate remaining bytes before awaiting a chunk and then both consume the
same allowance. The adapter now recomputes shared remaining bytes after the
await, before retaining or counting the chunk. A concurrent-read regression
checks that only one reader can spend the remaining allowance, with an
explicit budget failure for the other.

The final isolated browser test used the same spoken public question with
the production voice controller, prompts, service routes, Qwen lookup, and
two real Realtime sessions. Sky invoked web lookup, Qwen read the official
developer changelog, and Sky correctly named the current model and release
date. The lookup took 6.9 seconds. Audio was received, no browser or API errors
occurred, and End closed both sessions. Source contents were checked as well
as the transcript; merely mentioning the expected name did not count as a
passing answer. The final targeted suite passed 102 tests, and the full
`dev:check` gate passed.
