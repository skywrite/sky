---
created: 2026-09-10
updated: 2026-09-10
---

# Past chats are not evidence

## Symptom

Sky's own review of its coaching named the pattern: an answer criticizes
the user's response to a situation while adopting the user's read of it
untested. The pushback lands one layer down, and the starting assumption
gets harder to question.

Two shapes showed up in the record (details synthetic):

- The user brought a read of a colleague. The answer escalated it, supplied
  motives the record did not state, and asserted a fact the user then
  corrected. The critique that followed sounded challenging and left the
  speculative story intact.
- A later chat cited the earlier chat as confirmation. Saved chats come
  back through retrieval next to messages and meeting notes, so one guess
  can return as several apparent confirmations.

A third failure Sky named, an accusation built on an empty search, was
already fixed on 2026-09-05 (dda92f24): an empty result describes the
record, never the world.

## Root cause

- The chat prompt had no rule on any of it. Its guidelines were four
  bullets. Nothing separated observed from inferred, nothing said to test a
  premise before criticizing the response, and nothing said what a saved
  chat is.
- Saved chats are notebook documents. Retrieval queries `chats` like any
  root, and the query producer is told to always query chats when a prior
  conversation is referenced. Every document arrives with its path in a
  comment, so `actions/ai-chats/` is visible, but no rule weighed it. The
  line "when a memory conflicts with a notebook document, the notebook
  wins" made a past Sky verdict outrank a memory note.
- The write side already had the rule. The memory distiller and the
  person-profile distiller both say AI turns are never a source
  ([2026-08-29 — the distiller harvested its own answers](../../../../_shared-ts/models/Memory/docs/2026-08-29-distiller-harvested-its-own-answers.md)).
  The read side never got the matching rule. Sonny's prompt had it for the
  live call only: Sky's confident recommendation is her assessment, not
  independent evidence.

## What shipped

Four prompts, content edits only (`updated:` bumped, schema unchanged):

- `commands/lib/chat/prompts/chat.prompt.md` — a Weighing Evidence
  section. A four-grade ranking: the user now; captured words and actions;
  the user's turns in past chats; Sky's past turns and memory notes. Saved
  chats named as past output with no evidentiary weight of their own, and
  the user's agreement in a past chat not a second source. The
  personnel-assessment bar: what the person said or did with source, the
  strongest contrary facts, observed versus inferred, no supplied motives.
  The premise rule: test the diagnosis before commenting on the response
  to it.
- `commands/lib/voice/prompts/voice.prompt.md` — the premise rule and the
  assessment bar, two bullets under Understanding the user.
- `commands/lib/voice/prompts/ask-notebook.prompt.md` — the saved-chat
  rule for voice lookups and research, which search the notebook including
  chats.
- `commands/all/ai/research/prompts/research.prompt.md` — the same rule
  for the chat's research agent, so a report cannot launder a past verdict
  back into chat as a finding.

Prompts render at session creation, so live chats and calls keep the old
text; new ones pick it up.

## Rejected

- A required three-heading template on every personnel answer. It would
  fire on "what is Bob's role" and reads as ceremony. The bar is stated as
  what the answer must show, not a form.
- Stripping Sky's turns from retrieved chats. The user's corrections only
  make sense against what was said; the distiller rejected the same idea.
- Zero weight for the whole saved chat. The user's turns in a past chat
  are the user's statements; a correction recorded there is evidence. Only
  Sky's turns, and the user's agreement with a Sky framing, carry none.

## Watch for

- Over-correction into hedging: every people question answered with "the
  record cannot say". The bar asks for the strongest contrary fact, not for
  refusal.
- The rule rides on the model noticing a folder name in a path comment. If
  it does not hold, the follow-up is a "prior AI chat" marker in the
  context label beside the day label (`models/Chat/ChatContext/dayLabel.ts`).
