---
created: 2026-09-06
updated: 2026-09-07
---

# ai:voice

Design notes for `src/commands/all/ai/voice/` — the terminal voice
session (`ai:voice`) and the audition opener (`ai:voice:audition`). The
session configuration, persona prompts, greetings, and notebook research
code live in `src/commands/lib/voice/`; the web page and its service side
are written up in `src/service/handler/voice/docs/`.

## Current design

Terminal and browser voice sessions start with the same bounded notebook
snapshot: profile and remembered preferences, goals, current week and
day, recent daily summaries, people, open projects, and pending decisions.
`commands/lib/voice/initialContext.ts` gathers local records and a limited
view of the service index without a model call. Collection failures and
omissions travel with the evidence; local context remains usable when
the service is unavailable.

In the browser, Sky hosts the conversation with `gpt-realtime-2.1`, using
`medium` reasoning effort and normally speaking in `ash`. Calls open with a
simple hello, including the profile's first name
when available. Greetings and social check-ins stay brief and social; they
do not trigger notebook priorities, capability menus, or offers of work.
Both speech prompts specify conversational cadence and give short examples.
Quick reads are prompted to run silently. The browser also mutes messages
marked `commentary` and excludes them from displayed and mirrored speech,
while keeping generation, tool calls, and audio drain running. Final answers
and legacy audio without a phase remain audible. Pauses are fine.
When the topic is missing, Sky asks one short question. An explicit request
for deep research stays active when the user supplies the topic on the next
turn; it goes directly to Sunny rather than a parallel quick preview.
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
`research_notebook` starts Sunny's iterative Astra research in the
background. Sunny presents the result through a second Realtime session,
normally in `marin`, while Sky remains available for conversation.
`research_web` gives her the same background path for deeper web research.
The first web step requires the sole active custom search function; naming
`web_search` in OpenAI's tool-choice object would select the SDK's native-tool
alias and fail before retrieval. Research results keep explicit complete,
partial, or failed status, answer text, and source references through the
service boundary. Finished prose is never cut at a character boundary.
Deep investigation reserves thirty seconds of its three-minute budget for
one recovery synthesis from already-read evidence if a later step fails.
Web excerpts can be continued from their cached UTF-8 byte offset. An excerpt
boundary is not a failed investigation or a spoken disclaimer.
Deep research can combine notebook and public evidence when needed, with
private notebook details kept out of external search queries by default.

Address her directly, such as "Sunny, say hello," or ask to hear from her.
Sky uses the browser-local `invite_sunny` handoff for greetings, conversation,
and questions Sunny can answer from existing context. He yields the turn
without another spoken explanation. Requests for deeper investigation
still start research, and Sunny reports at the next pause. Say "Sunny,
continue" to hear queued findings or resume an interrupted report. Earlier dated notes use her
former name, Scout.

Starting background research yields without an extra Sky response. Sky can
still answer independent questions or action results while it runs. He gets
the research status when it finishes, and the source evidence after Sunny
has actually spoken her report. Sunny leads with the useful findings and
their implications. Partial findings remain usable; a wholly failed attempt
gets one brief acknowledgement without invalidating earlier successful reads.
A completed presentation with no audible transcript stays available to resume.

The browser's speech sessions and research engines receive the initial
notebook snapshot. Sky answers directly when it has enough context. For
today's or this week's priorities, his instructions require a current task
read before choosing, unless a relevant result was already fetched in the
conversation. Delivery checks apply to secondary recommendations too; an
irrelevant old task can simply be omitted. Recorded plans and unchecked boxes
do not establish unfinished work; the user's completion corrections take
precedence over older notes.

Browser-only `search_email` searches Gmail messages and reads matching bodies,
including Sent mail. It uses known topic, recipient, and date context to
check delivery claims instead of looking through a recent Inbox page. Results
preserve message labels, timestamps, recipients, and content with explicit
read limits and partial-result status. Searches never mark mail read or
change the mailbox. Ambiguous authorized accounts are returned for resolution.

Completed spoken turns are mirrored between the speech sessions, and each
research question carries the conversation details it needs. Quick lookup,
mail-search, thread-read, inbox-list, and day-list results also reach Sunny
silently, bounded to twenty-four thousand characters per shared excerpt.
She receives the source evidence before a same-turn invitation, including
truncation notices. Action results are excluded from that evidence feed.
Sunny's speaking session has no tools: a spoken suggestion to check something
does not start a lookup. She can assess supplied evidence and offer her own
reasoning; Sky handles retrieval and background research. The calendar remains
separate from the notebook research prompt.

The browser coordinates one speaking turn at a time and interrupts
playback when the user speaks. Interrupted or failed reports remain
available through **Resume Sunny** or a spoken request to continue; resuming
reuses the saved findings without another Astra run. Settings offers
independent Sky and Sunny voice pickers, with previews; changes apply to
the next call.

The browser research defaults are
`default-cerebras-qwen-3.8` with voice-local reasoning disabled for notebook
lookup and set to `low` for web lookup, and
`default-gpt-6-astra-high`. The terminal keeps its existing single voice
and `ask_notebook` delegate, with the improved initial context; the new
two-voice research experience is browser-only. Text/chat model roles and
shared profiles are unchanged. This code remains in voice until the
overlapping libraries can be extracted separately. Voice auditions do not
gather the notebook snapshot.
Notebook prompt overrides still take precedence, and prompt/context
changes take effect in newly started sessions.

## Notes

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
