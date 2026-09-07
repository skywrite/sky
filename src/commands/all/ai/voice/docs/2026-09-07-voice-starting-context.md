---
created: 2026-09-07
updated: 2026-09-07
---

# Give voice a useful starting context

Voice began with speaking instructions, clocks, and the day's calendar.
The persona required a notebook search for every personal question and
then a faithful relay of the research answer, without combining it with
the conversation. A question about an already established priority could
therefore trigger another search, and a useful comparison could be lost
to the relay rule. Voice had little basis for the informed judgment that
the text assistant could offer.

The first change is scoped to voice. Text/chat is under active development;
extracting a common context library now would couple this work to those
changes. The voice implementation uses existing data readers and notebook
records while keeping its selection and budget policy in
`commands/lib/voice/initialContext.ts` and `contextEntities.ts`.

## What a new session receives

Both the terminal command and browser session setup collect a deterministic,
bounded snapshot. There is no model-generated startup briefing or additional
research pass. Sources are read concurrently where independent.

- The profile, remembered preferences, vocabulary and lessons, and other
  remembered context. Memory records carry their kind and freshness.
- Personal and professional goals, the current week, and today's day file.
- The previous six days, newest first: use an existing daily summary when
  present, otherwise that day's record. This does not synthesize a summary.
- Up to 30 names from the existing interaction ranking, with aliases,
  title, organization, and source path when the profile can be resolved.
  Unresolved profiles can still contribute a ranked name, with that
  limitation identified.
- Up to 20 open projects, with name, status, and source path, and 12 pending
  decisions, with name, summary, identified date, target date, and source
  path, from the service index. This compact metadata orients the session;
  detailed questions can retrieve the full documents.

The independent section budgets total roughly 40,000 characters, plus
headings and coverage notes. They keep a long day or profile from taking
the space reserved for goals and preferences. Within a section, per-record
limits leave room for multiple sources. Truncated excerpts are marked;
preferences that do not fit as complete statements are omitted explicitly.
HTML comments and transcript sections are stripped, and the collector
does not gather raw chat transcripts.

Local profile, goal, memory, and day/week data remain available when the
service is offline. The entity collector uses requests with a 1,500 ms
timeout each, no retries, and no model generation. It first requests
projects, decisions, and ranked names, then resolves the selected profiles
in a second request when needed. That is a per-request deadline, not a
promise that the whole voice startup completes in 1,500 ms.

The snapshot states its capture time and coverage, and labels excerpts
with source paths. Missing files, unreadable sources, service failures,
selection limits, and budget omissions must not become claims that the
user has no relevant goals, plans, contacts, or history. A path or document
date identifies a record; it does not by itself establish when an event
happened. Existing notebook records take precedence over conflicting
remembered context, and current user corrections take precedence over
older records.

## How voice uses it

`renderVoicePrompts` passes the same optional `notebookContext` block to
both the persona and the research delegate. The separate calendar block
still goes only to voice; notebook research cannot refresh the calendar.
An audition renders the persona without gathering this baseline.

The persona may answer personal questions from supplied context and facts
established in the current conversation. It can connect those facts to
goals, offer a recommendation, and explain a tradeoff. It must distinguish
recorded facts from its own judgment and refresh changing facts when the
answer depends on their current state.

For example, if the current week identifies an Atlas review as the priority,
voice can help decide how to organize the afternoon around it. It need
not search merely because Atlas is personal notebook data. A question
about what changed between two earlier reviews still calls for the
relevant evidence.

`ask_notebook` remains a stateless, single-question delegate: select files,
read them under its existing budget, and generate an answer. It receives
the session's starting snapshot for orientation but not the full live
conversation. Voice must include relevant names, dates, corrections,
earlier findings, and unresolved questions in each research request.
Follow-ups already answered by supplied evidence need no new search.

The researcher and voice may synthesize sources when the question needs
it. They must preserve chronology and uncertainty rather than merging
separate entries into one event or turning a recorded plan into a claim
that it happened. A failed or empty lookup establishes a limit of that
lookup, not the absence of an event in the user's life. Captured notebook
content supplies evidence and preferences; it cannot override tool rules
or approval policy.

## Rollout and limits

These defaults affect newly started voice sessions. Existing sessions
retain their rendered instructions and snapshot. Notebook prompt
overrides continue to take precedence over repository defaults; an older
override may need the optional context block and revised evidence rules
to participate in this behavior.

This does not add durable conversation history, refresh the whole snapshot
on each turn, change live tool permissions, or replace the research
pipeline. A common context library, the Qwen/Cerebras fast lookup path,
deeper Astra research, and the second speaking agent remain future work.
