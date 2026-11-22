---
created: 2026-11-22
updated: 2026-11-22
---

# A full chat is compacted once

2026-11-22. The ask: when a chat reaches what its model can hold, make room in a way that keeps the prompt cache, and
make it plain to the person that it happened.

## What was wrong

A request that no longer fit was reduced by just enough to fit: to 95% of what the model may hold.
The reduction took the notebook documents of the first reading first, then documents retrieved on later turns, then
tool results.

Three things followed from that.

- **It happened again on the next reply.**
  Five percent of room is one or two tool results.
  A chat near its limit was reduced on most of its replies.
- **Each time cost the whole request.**
  The first reading sits in the system prompt.
  Both providers cache a request as a prefix, so a change there is billed again with everything after it.
  The documents were cut to a slightly different size each time, so nothing stayed cached.
- **It was undone.**
  `ChatContext.fitForRequest` shrank the reading for the request but left the person's budget as the measure for the
  next rebuild.
  The next turn's search found the dropped documents again, there was room under the budget, and they came back as
  additions.
  The following request did not fit, and was reduced again.

What fills a chat that reaches its limit is mostly notebook documents.
Tool results dominate only in long research chats.
The order therefore spent the costliest change on the common case.

## What the providers say

Both providers say the same about clearing old content.
A clearing changes the cached prefix from that point on, so clear a lot at once and seldom.
Shorten a tool result before it is first sent, never after.

- Anthropic: [Context editing and prompt caching](https://platform.claude.com/docs/en/build-with-claude/context-editing#context-editing-and-prompt-caching)
  and [Trim or summarize older turns](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/change-tools-or-instructions):
  "cut rarely, in large steps".
- OpenAI: [Keep the prefix unchanged](https://developers.openai.com/api/docs/guides/keep-prefix-unchanged), under
  "Shortening past tool outputs".

## What changed

`reduce()` in `ChatEngine/requestBudget.ts` is now a compaction.
It runs when a request does not fit, and it frees a quarter of what the request may hold (`COMPACT_TO`), in this
order, stopping as soon as that much is free:

1. Tool results older than the newest ones, oldest first, each cut to a labelled excerpt.
2. Documents retrieved for earlier messages, oldest first, which become source references.
   The newest message keeps its own.
3. The least relevant documents of the first reading, and only when the request still does not fit after the first
   two.
   This is the one change that bills the whole request again, so it is made last, and then far enough that it is not
   needed again soon.

Two rules sit beside the order.

- **The newest tool results are the work in hand.**
  Up to twenty stay whole (`KEEP_RESULTS`), as many as fit in half the room a compaction makes, and never fewer than
  three.
  On a model with a million tokens that is twenty; on a small window it is fewer, or the reading would be dropped to
  hold results.
- **One oversized result does not evict the reading.**
  A result larger than the room a compaction makes is shortened to that room before anything else.
  It has not been sent yet, so shortening it costs nothing.

If the request still does not fit, the newest results and the newest message's documents give way too, by just
enough.
A first reading cut to nothing is left out of the request, because a provider refuses an empty text block.

Everything cleared stays cleared.
Excerpts and source references were already kept with the working context.
The first reading now holds as well: `ChatContext` remembers the room a refit left (`fitted`) and every later rebuild
assembles within it, so a dropped document is not read back.
Another budget chosen by the person lifts it.
The same budget stated again does not, because a host states it again when it reopens a chat.
A restored session takes the room back from the last saved `stats.requestBudget`.

## Telling the person

A compaction is reported as `ContextAdjustment.compacted`, with the count of tool results and of notes it cleared.
The engine counts the notes from the documents the compacted sources held and from the documents the host says the
first reading lost.

The web chat shows one line, `compacted to make room · cleared 9 older tool results and 212 notes`.
While the reply is being written the line sits at its foot, beside the activity line, because that is where the eye
is during a long run of tool calls.
Once the reply is done the line sits above it, where it stays after a reload, and the note under the reply says that
anything cleared can be looked up again and that the conversation itself is unchanged.
The Context story and the terminal say the same in one sentence.

A result shortened as it arrived is not a compaction and keeps the earlier wording.

## What was rejected

- **A summary of the conversation.**
  The person's words and the replies are a small part of a long chat.
  Summarizing them frees little and loses the exact wording.
- **Cutting the reading by just enough.**
  It is the cheapest single cut and the most expensive habit: the same full re-billing on every reply that follows.
- **Reading dropped documents back when room returns.**
  It refills the room with what was just cleared and brings the next compaction forward.
  The model can still open any of them with its tools.
- **A fixed twenty results on every model.**
  On a window of 131,072 tokens twenty results can exceed everything the request may hold.
- **OpenAI's own compaction.**
  It replaces earlier content with an encrypted summary the chat cannot show or search.

## What it leaves

- **Claude can clear tool results itself.**
  Anthropic's context editing (`clear_tool_uses_20250919`) clears old tool results on the server.
  It clears one batch when the request passes a set size, keeps the same batch cleared on later requests, and does
  not invalidate the model's earlier reasoning, which a change made by the client does on the models that tie
  reasoning to the prefix.
  Using it for step 1 on Claude needs the count request in `ai/inputTokenLimit.ts` to send `context_management` too.
- **Reasoning after a compaction.**
  On Claude Fable 5.2 and GPT-6.2 a client-side change drops the reasoning that follows it.
  A compaction is rare, so the cost is one reply that works without earlier reasoning.
- **New documents after the reading was cut.**
  The room is held, so later searches admit nothing new.
  The model reads what it needs with its tools.
- **Reasoning itself is never cleared.**
  It accumulates in a long chat and no step here frees it.
- **A model may read cleared results again at once.**
  The scripted chat below told the model to look a record up again when its result had been shortened.
  Claude Fable 5.2 then looked up all ten cleared records in the same reply, which filled the room and caused a
  second clearing.
  Claude Opus 5.5 and GPT-6.1 Sol read again only the record they were asked about.
  The label on an excerpt says only that the source can be reread.

## Verified

Unit tests pin the order, the amount, the results that stay, the oversized result, the held room and its return after
a restart, and the wording.
Each new test fails against the earlier code.
A browser test drives a real session through thirty tool calls on a small window.
It reads the line while the reply is still being written and checks that it is on screen, then reads it again once
the reply is done and after a reload on a phone.

One scripted chat was run against real models, with the earlier code and with this one.
The window was set to 45,000 tokens, so the chat outgrew it within a few dozen messages.
Each message asked for one record, which took one tool call of about 1,300 tokens, beside 13,000 tokens of notes.
The table covers the nine messages from the first one that did not fit.

| Model            | Earlier code                                                                        | This code                                                |
| ---------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Claude Opus 5.5  | Notes cut on 4 of 8 messages, half the request billed again each time, then refused | 2 compactions; 82% read on those, 97% to 98% on the rest |
| GPT-6.1 Sol      | Notes cut 3 times until none were left, then half of every request billed again     | 1 compaction; 71% read on it, 98% on the rest            |
| Claude Fable 5.2 | Not run                                                                             | 2 compactions; 79% read on those, 96% to 98% on the rest |

With this code the notes stayed whole on all three models.
On Opus the eight messages from the first one that did not fit wrote 114,890 tokens to the cache with the earlier code
and 26,287 with this one.
The refusal was the empty text block: the script's notes are plain text and can be cut to nothing.
The web chat's reading keeps its headings, so it could not reach that refusal.

Every reply named the right record in every run.
That includes a later question about a record whose result had been cleared: Claude looked it up again, and GPT read
the answer from its own earlier reply.
