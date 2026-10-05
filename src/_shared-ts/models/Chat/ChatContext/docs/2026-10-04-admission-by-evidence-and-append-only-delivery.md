---
created: 2026-10-04
updated: 2026-10-04
---

# Admission by evidence, and context that only grows

## What was wrong

Thirty days of chats (128 conversations, 499 turns, saved transcripts and
recovery snapshots) said the same thing three ways:

- The budget was a target. 79% of rebuilt turns shipped at least 97% of the
  reading budget, whatever the question. The relative floor (35% of the
  turn's top score) sat around 8, and a same-day message scored recency 5 +
  type 2 before any evidence: one grazing word match cleared it.
- Half of what shipped had no query behind it. The median turn's query
  results were 72k estimated tokens; the median shipped context was 300k.
  The rest was recent chatter that shared a common word with the question.
  A question about one video shipped 264 documents, 94% of them unrelated
  Slack messages matching "video" or a first name.
- Every change rewrote everything. The context was one system segment,
  rendered in score order; two of every three turns changed it, and 81% of
  the tokens in a rewrite were the same documents as the turn before. Cache
  writes were 95% of the chat bill on the Anthropic models, and GPT-6 showed
  the same shape: a changed segment put the first changed byte near the top.

## What changed

**Admission.** A scored document ships when a query returned it, when its
lexical match clears `CHAT_SCORE.admissionLex` (4 of 8 — a near-unique
header or name match, or several good ones), when it is a day's ledger or
summary inside the baseline window, or when it is pinned. Everything else is
refused (`cut: 'floor'`). The budget caps the admitted set. `ContextAssembler`
gained an `eligible` predicate for this; the scorer is unchanged and still
orders the admitted for the walk. Scoring tag `s5`.

**Delivery.** The first assembly renders once, as the context segment, its
documents in path order within each type so the same set is the same bytes
whatever the scores did since. A document admitted later renders as an
addition the session places at the head of the person's next user message,
labeled as the assistant's retrieval; a shipped document is never taken back
within the session. `RebuildReport` carries `activityMarkdown` (the segment)
and `additionsMarkdown`; the log records `added`. A request refit shrinks
the segment only.

## Rejected

- **Raising the relative floor.** Any fraction of the top score still moves
  with the top score; a strong query hit would raise the bar past documents
  the question did want, and a weak turn would lower it onto chatter.
- **Rendering the segment append-only but keeping it in the system prompt.**
  Appending to the segment changes the prefix of everything after it, so the
  whole history would be re-written on both providers. Additions have to
  come after the history.
- **Removing a document from the context when its evidence fades.** That is
  an edit of the request's prefix; it also edits the history on the models
  that bind thinking to it. The cap decides what newcomers fit; what the
  model has seen, it keeps seeing.
- **Delivering additions as a mid-conversation system message.** The
  providers take one (Anthropic on the Opus 5, Fable 5 and Sonnet 5.5 lines;
  OpenAI anywhere), but the AI SDK does not: with `instructions` in use it
  refuses any system message inside `messages` ("Use the instructions option
  instead"), seen live on Opus 5.5. The labeled user block caches the same
  and works on every model, so it is the one path.
- **Rendering the segment in score order.** The first live run re-wrote the
  whole prompt on turn two with no document changed: the order within the
  segment had. Path order within each type is the fix.

## Verified

- Unit: assembler `eligible` and path-ordered subset render; ChatContext
  admission, shipped-stays, refit-shrinks-segment-only; ChatSession
  delivery as a labeled user block with the segment byte-identical.
- Live, 2026-10-04: see the README's Verified list — on Anthropic, turn two
  read the whole first request back from cache and wrote only the addition;
  on OpenAI the same held once the conversation key went out as the prompt
  cache key (without it, GPT-6 read nothing on an identical prefix).
