---
created: 2026-09-06
updated: 2026-09-22
---

# Browser voice

Design notes for `src/commands/lib/voice/` — session configuration, persona
prompts, starting context, and notebook and web research for browser calls.
The web page and its service side are written up in
`src/service/handler/voice/docs/`. Voice previews remain available in
Settings and at `/voice/audition`.

## Current design

The browser starts voice from the waveform after Send in Chat. The chat
retains its typed draft, shares its prior conversation with both speakers,
and keeps completed speech for later text replies and filing. The UI and
transcript handoff are described in the
[chat design](../../../../service/handler/chat/docs/README.md#voice-in-the-conversation).

Browser voice sessions start with a bounded notebook
snapshot: profile and remembered preferences, goals, current week and
day, recent daily summaries, people, open projects, and pending decisions.
`commands/lib/voice/initialContext.ts` gathers local records and a limited
view of the service index without a model call. Collection failures and
omissions travel with the evidence; local context remains usable when
the service is unavailable.

In the browser, Sky hosts the conversation with `gpt-realtime-2.1`, using
`medium` reasoning effort and normally speaking in `marin` (she/her). Calls open with a
simple hello, including the profile's first name
when available. Greetings and social check-ins stay brief and social; they
do not trigger notebook priorities, capability menus, or offers of work.
Both speech prompts specify conversational cadence and the same conversation
rules: questions, answers, volunteered details, and corrections carry across
speakers. Neither repeats a pending or answered question. Changing addressee
continues the exchange without another round of greetings or requests for
context. A brief statement, agreement, or pause can complete a turn. Invented
three-person exchanges show check-ins in both speaker orders and a question
left pending while the other voice answers a presence check.
Quick reads are prompted to run silently. The browser also mutes messages
marked `commentary` and excludes them from displayed and mirrored speech,
while keeping generation, tool calls, and audio drain running. Final answers
and legacy audio without a phase remain audible. Explicit shared-assignment
acknowledgement turns request one final-channel reply. Pauses are fine.
When the topic is missing, Sky asks one short question. An explicit request
for standalone deep research stays active when the user supplies the topic
on the next turn; it goes directly to Sonny. Separate assignments to Sky and
Sonny retain their requested depth and speaker.

Shared public/notebook research uses the browser-local `research_together`
tool, with separate `web_question` and `notebook_question` arguments. The
controller starts Sky's Qwen public lookup and Sonny's Astra notebook
investigation concurrently. Only the public question reaches `lookup_web`;
the notebook request includes conversation context and `notebook_only: true`.
That flag removes web tools from Sonny's investigation, including its recovery
path. It returns internal evidence without claiming a fresh market comparison.

Sky and Sonny each acknowledge their own assignment in one brief sentence,
in that order, while both retrievals are already running. These scheduled
turns confirm who is doing what without a duplicate preamble or early findings.
Only after both acknowledgements does Sky give the web overview, followed by
Sonny's notebook comparison and Sky's synthesis. Retrieval may finish in either order. The
controller queues only the next eligible speaking stage, and advances after
completed, nonempty speech and drained audio. Sonny receives the actual public
result before his comparison; Sky receives both results for her final turn.
All stages preserve their full persona and disable tools for that presentation.
Findings interrupted or left unspoken by failed/silent responses stay available
for resumption without repeating retrieval. Acknowledgements are transient:
silent or refused acknowledgements advance, and user speech discards any
remaining acknowledgements while preserving the research. They do not appear
as findings-ready counts or source evidence. One failed source
limits the comparison without discarding the other; two failed sources skip
an empty final synthesis. Standalone research retains its separate behavior.

`lookup_notebook` uses Qwen on Cerebras for a quick missing fact.
`lookup_web` uses the same fast model for public web questions and specific
pages. Both search and read before answering; web lookup receives the public
question without the notebook snapshot. Web runs require a page-read step
when search candidates are available but no page has been read; a failed
first read leaves other candidates available within the same bounded run.
Current questions include today's date and instructions to verify older
announcements against maintained official references. Sky's handoff preserves
the user's product names and question scope. Quick web research allows six
model steps for a follow-up search and read, within the existing twenty-second
and six-tool-call limits; its final step is reserved for spoken synthesis.
`research_notebook` starts Sonny's iterative Astra research in the
background. Sonny presents the result through a second Realtime session,
normally in `ash` (he/him), while Sky remains available for conversation.
`research_web` gives him the same background path for deeper web research.
The first web step requires the sole active custom search function; naming
`web_search` in OpenAI's tool-choice object would select the SDK's native-tool
alias and fail before retrieval. Research results keep explicit complete,
partial, or failed status, answer text, and source references through the
service boundary. Finished prose is never cut at a character boundary.
Deep investigation reserves thirty seconds of its three-minute budget for
one recovery synthesis from already-read evidence if a later step fails.
Web excerpts can be continued from their cached UTF-8 byte offset. An excerpt
boundary is not a failed investigation or a spoken disclaimer.
Extraction, section reads, and snapshot continuations follow the
[shared web reader contract](../../web/docs/README.md).
Standalone deep research can combine notebook and public evidence when needed,
with private notebook details kept out of external search queries by default.

Address him directly, such as "Sonny, say hello," or ask to hear from him.
Both speech prompts establish Sky (she/her) and Sonny (he/him) before notebook
context. "Sunny" is treated as the same spoken name; a presence check addressed
to him goes directly to his voice instead of Sky answering for herself.
Sky uses the browser-local `invite_sonny` handoff for greetings, conversation,
and questions Sonny can answer from existing context. She yields the turn
without another spoken explanation. Requests for deeper investigation
still start research, and Sonny reports at the next pause. Say "Sonny,
continue" to hear queued findings or resume an interrupted report. Earlier dated notes use his
former names, Sunny and Scout.

Starting standalone background research yields without an extra Sky response. Sky can
still answer independent questions or action results while it runs. She gets
the research status when it finishes, and the source evidence after Sonny
has actually spoken his report. Sonny leads with the useful findings and
their implications. Partial findings remain usable; a wholly failed attempt
gets one brief acknowledgement without invalidating earlier successful reads.
A completed presentation with no audible transcript stays available to resume.

The browser's speech sessions and research engines receive the initial
notebook snapshot. Sky answers directly when she has enough context. For
today's or this week's priorities, her instructions require a current task
read before choosing, unless a relevant result was already fetched in the
conversation. Delivery checks apply to secondary recommendations too; an
irrelevant old task can simply be omitted. Recorded plans and unchecked boxes
do not establish unfinished work; the user's completion corrections take
precedence over older notes. When a question rests on a diagnosis of a
person or situation, Sky checks the diagnosis against the record before
commenting on the response to it, and keeps assessments to what the person
said or did, the strongest contrary fact, and observed versus inferred.
Saved chats found by lookup or research are past output; Sky's own earlier
turns carry no weight of their own. See
[past chats are not evidence](../../chat/docs/2026-09-10-past-chats-are-not-evidence.md).

Browser-only `search_email` searches Gmail messages and reads matching bodies,
including Sent mail. It uses known topic, recipient, and date context to
check delivery claims instead of looking through a recent Inbox page. Results
preserve message labels, timestamps, recipients, and content with explicit
read limits and partial-result status. Searches never mark mail read or
change the mailbox. Ambiguous authorized accounts are returned for resolution.

Completed spoken turns are mirrored between the speech sessions, and each
research question carries the conversation details it needs. Quick lookup,
mail-search, thread-read, inbox-list, and day-list results also reach Sonny
silently, bounded to twenty-four thousand characters per shared excerpt.
He receives the source evidence before a same-turn invitation, including
truncation notices. Action results are excluded from that evidence feed.
Sonny's speaking session has no tools: a spoken suggestion to check something
does not start a lookup. He can assess supplied evidence and offer his own
reasoning; Sky handles retrieval and background research. The calendar remains
separate from the notebook research prompt.

Sky can schedule and update calendar events through the curated command tools.
It calls the scheduler's fast interpretation and scored contact lookup before
asking for missing details; see [lookup before questions](../../../../lib/calendarScheduler/docs/2026-09-08-lookup-before-questions.md).
Preparation and receipt reads run immediately; sending or saving waits for the
spoken confirmation of the stored event details. The
[calendar workflow](../../../../lib/calendarScheduler/docs/README.md#chat-and-voice)
owns those rules and verification.

The browser coordinates one speaking turn at a time and interrupts
playback when the user speaks. Interrupted or failed reports remain
available through **Resume research** or a spoken request to continue; resuming
reuses the saved findings without another Astra run. Settings offers
independent Sky and Sonny voice pickers, with previews; changes apply to
the next call.

The browser research defaults are
`default-cerebras-qwen-3.8` with voice-local reasoning disabled for notebook
lookup and set to `low` for web lookup, and
`default-gpt-6-astra-high`. Voice runs in the browser; the terminal commands,
WebSocket transport, native audio helper, and old `ask_notebook` delegate
have been removed. Text/chat model roles and shared profiles are unchanged.
This code remains in voice until the
overlapping libraries can be extracted separately. Voice auditions do not
gather the notebook snapshot.
Notebook prompt overrides still take precedence, and prompt/context
changes take effect in newly started sessions.

## Notes

- Test a diagnosis before judging the response to it; weigh saved chats as past output:
  [2026-09-10 — past chats are not evidence](../../chat/docs/2026-09-10-past-chats-are-not-evidence.md)
- Carry questions and answers across speakers and leave room after a reply:
  [2026-09-08 — shared conversation continuity](2026-09-08-shared-conversation-continuity.md)
- Remove the terminal transport while preserving browser calls and previews:
  [2026-09-07 — remove the voice CLI](2026-09-07-remove-voice-cli.md)

- Let both speakers acknowledge their assigned work while retrieval starts:
  [2026-09-07 — research acknowledgements](2026-09-07-research-acknowledgements.md)
- Coordinate Sky's public overview, Sonny's notebook comparison, and Sky's
  synthesis, with identities and resumable speaking stages:
  [2026-09-07 — shared research conversation](2026-09-07-shared-research-conversation.md)
- Fix Astra's custom web-tool choice, preserve research results, and let Sunny
  deliver them without a competing Sky answer:
  [2026-09-07 — research results and the speaking handoff](2026-09-07-research-handoff-and-results.md)
- Verify current priorities and sent mail, and give Sunny the underlying evidence:
  [2026-09-07 — priorities and sent mail](2026-09-07-priorities-and-sent-mail.md)
- Remove task pitches from greetings and simplify the speaking style:
  [2026-09-07 — conversational voice](2026-09-07-conversational-voice.md)
- Require page reads before web synthesis and improve freshness checks:
  [2026-09-07 — reliable web lookup steps](2026-09-07-web-lookup-reading.md)
- Give both research paths working web retrieval and distinguish failed
  searches from missing evidence:
  [2026-09-07 — voice web search](2026-09-07-voice-web-search.md)
- Let Sunny join ordinary conversation and make Sky's replies and handoffs
  more natural:
  [2026-09-07 — Sunny joins the conversation](2026-09-07-sunny-conversation.md)
- Two speech sessions, quick Qwen lookup, iterative Astra research, bounded
  read-only tools, and synthetic live verification:
  [2026-09-07 — two voices with notebook research](2026-09-07-two-voice-research.md)
- Give voice enough context to answer grounded personal questions and
  reason about priorities without searching on every turn:
  [2026-09-07 — voice starting context](2026-09-07-voice-starting-context.md)
- The original proposal, before the implementation above:
  [2026-09-06 — two voices, one conversation](2026-09-06-two-voices-one-conversation.md)
