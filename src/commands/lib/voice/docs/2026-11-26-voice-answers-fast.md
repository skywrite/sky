---
created: 2026-11-26
updated: 2026-11-26
---

# Voice answers fast

## What was wrong

Voice was meant to feel like a phone call with someone who knows the notebook.
Timed on real spoken calls (a synthetic voice asking eight questions through a headless browser against the running
service), it felt like waiting on a search:

- The speaking model knew nothing.
  Its prompt had no date, calendar, lists or people, so it handed almost every question to the backend, and answered
  "what day is it" on its own with a made-up date.
- The backend had no fast way into the notebook.
  A typed chat message runs the chat's retrieval before the model sees it; a spoken one does not, and the backend's
  only notebook search was `ai_research`, a separate agent that took 26 to 32 seconds on these questions.
  After a research report it re-read whole sources too.
- Sol ran at high reasoning effort, and answers ran long: some took over a minute to say.
- One rejected message from the service would have ended the call on both sides, which ruled out telling the speaking
  model anything mid-call.

## What changed

- The speaking model's prompt carries a short page of what Sky knows right now (`page.ts`), built from the reads the
  call already makes, with a byte cap per part and 6,000 bytes in all.
  The prompt says to answer from the part that matches the question, and to delegate when no part covers it, to look
  further, or to change something.
  The service keeps the page's "today" current with silent notes, counted as told only once delivered.
- Voice adds `search_notebook`, a lookup on the service's search index, and pages `read_file` to 8,000 characters with
  `find`: a short file still comes back whole, and a long one is paged in full rather than from chat's first-200,000
  characters cut.
  The backend prompt orders the work: answer from what is known, else one quick lookup and a narrow read, and research
  only when asked or when the quick look finds nothing.
- `ai_research` runs past its delegation.
  A run still going after a second answers its turn that it is running; one that fails sooner answers like any tool,
  so Sol can correct the call.
  When it finishes, Sol hears what it found or that it failed, and the lead is read aloud.
  Ending the call aborts it, and research now passes the stop to its model loop, so `/end` returns at once.
- Sol runs at `low` effort with `text.verbosity: low`, both prompts ask for one or two sentences, and Live acknowledges
  delegated work at once.
- Notes the service sends carry a `sky-note-` event ID, and a rejection naming one is skipped instead of ending the call.
- Two fixes outside voice that its lookups depended on: the search index labelled every journal entry (a day's
  `journal/` folder) as a note, so a journal search found nothing; and it rebuilt every record after any notebook change,
  about 1.5 s paid by the first search after each turn a call saved.
  It now keeps each unchanged document's entry, and a rebuild after one change takes tens of milliseconds.

## Measured

Time from the end of the question to the first sound of the answer, one call per question, measured on the browser's
clock after all of the above.

| Question | Before | After |
|---|---|---|
| What day is it today? | wrong date, 1.3 s | right, 1.3 s |
| What's on my to-do list today? | 5.8 s | 1.3 s |
| What's on my calendar today? | 4.7 s | 1.1 s |
| What are my goals for this year? | 4.0 s | 1.2 s |
| Which decisions are still pending? | 5.0 s | 1.3 s |
| What did I write in my journal last weekend? | 34.0 s | 8.7 s |
| What was my last meeting about? | 33.6 s | 7.3 s |
| Did anyone email me about a contract this week? | 13.7 s | 6.6 s |

The first five are answered from the page with no backend call.
Questions that need a lookup now say a short acknowledgement 1.4 to 2.0 s after the question; the journal question read
its three entries at once.
A request for research was answered "digging into it" after 7.7 s, and its findings were spoken about 50 s in while the
conversation went on.

## Tried and changed

- **An 800 ms acknowledgement wait.**
  It was meant to spare quick answers a needless "let me check", but Sol's first word takes about 0.9 s even at low
  effort, so the wait never skipped an acknowledgement; it only added silence.
  Looked-up questions first sounded at 2.4 to 2.7 s with it, against 1.5 to 1.9 s without.
- **A page without pending decisions.**
  Live answered "which decisions are still pending" from the to-do list.
  Each common question needs its own part of the page, and the prompt now says to delegate when no part covers it.
- **Judging overlap by Live's transcript stamps.**
  Live stamps the question's last words at its end of turn, so an instant reply can carry an earlier stamp than the
  question's end although nothing played over it.
  The browser's audio is what tells whether Sky talked over the user.

## Rejected

- **Qwen 3.8 on Cerebras as the backend.**
  Benchmarked on the same voice prompt and tools: about twice as fast as Sol at high effort to a first word (1.7 s
  against 3.2 s), but Sol at low effort was faster still (0.9 s) and Qwen was unreliable.
  It once wrote imitation tool calls as its answer and once chose the image tool for a question about decisions, and
  an output cap that suits Sol cut a third of its answers off mid-thought.
- **A one-second acknowledgement.** The API caps `acknowledgement_delay_ms` at 800.
- **Client delegation**, where Sky runs Sol itself and streams partial results.
  It is the only documented way to speak results as they stream, but it moves the whole tool loop into Sky.
  Background research covers the long case; the short ones are now short.
- **Changing `read_file` for chat too.**
  Chat reads before the model runs and can afford whole documents; voice pages them in its own adapter, so chat's tool
  and prompt cache are unchanged.
