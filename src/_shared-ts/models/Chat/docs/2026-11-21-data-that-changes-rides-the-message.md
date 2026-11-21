---
created: 2026-11-21
updated: 2026-11-21
---

# Data that changes rides with the message

2026-11-21. The ask: stop the web chat from losing its prompt cache after a draft is written or edited.

## What was wrong

The web chat's system prompt has three parts: the base prompt, the notebook documents, and the host's instructions.
The host built the third part again on every turn, and put the current drafts into it as JSON, each draft's full text
included.

Both providers cache a request as a prefix, in the order tools, system prompt, messages.
A change is billed again together with everything that follows it.
The third part sits ahead of the whole conversation, so one edited word in a draft re-billed every message, every
tool result and every retrieved document that had arrived since the first turn.

It was worse on OpenAI.
OpenAI writes a cache entry only where a message ends, unless a request marks other places, and the chat marks none.
A change inside the system prompt therefore left nothing to read: the whole request was billed as new, the notebook
documents with it.

Every message that followed a draft change paid this, and a drafting conversation changes a draft on most turns.
The cost was invisible in the product: the reply was the same, only the bill differed.

There is a second cost on the newest models.
Claude Fable 5.2 and GPT-6.2 tie a reply's reasoning to everything sent before it.
A changed system prompt makes the reasoning of every earlier reply unusable, so the model works without it.

## What the providers ask for

Both now say the same thing, almost in the same words: build the system prompt and the tool list once, send them
unchanged, and put every update in a new message at the end, where it stays.

- Anthropic: [Change tools or instructions without failing the prefix check](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/change-tools-or-instructions),
  under "Update the date, files, or other context": put an updated value in its own text block of the user message
  about to be sent, state it only when it changes, and leave it there.
- OpenAI: [Keep the prefix unchanged](https://developers.openai.com/api/docs/guides/keep-prefix-unchanged): append new
  instructions and data to the end of the context instead of rewriting what was sent.

## What changed

A host's tool factory now returns two things where it returned one.

- `instructions` are standing instructions: the same text for the whole conversation.
- `referenceData` is data that changes while the conversation runs.

`ChatSession` compares `referenceData` with the copy the conversation last carried.
When they differ, it places the new copy in the message the person just sent, ahead of their words, under a label that
says the app supplied it and that it replaces every earlier copy.
An unchanged turn adds nothing.
A copy that was sent is never edited or removed, so the request only grows at its end.

`ChatEngine.appendReferenceData` does the placing and `ChatEngine.referenceData` answers what the conversation carries.
The answer comes from the history itself, kept beside the message as `providerOptions.sky.referenceData`, which no
provider reads.
A restored, branched or shortened conversation therefore answers for the messages it actually holds, and a restart
does not send a second copy.
A conversation rebuilt from the transcript alone carries none, so its next message sends the current data.

Retrieved documents keep their place at the head of the message.
`workingContext.ts` finds them again by their exact leading text and length, so the data goes after them and before
the person's words, and the join between them is kept as it was.

The web chat's drafts list is the first user of this: `writingDraftList` in `lib/writingVoice/draftChat.ts`.
It returns nothing while a conversation has no draft, so a chat that never drafts carries no list at all.
The standing draft instructions stay in the system prompt, and now say where the list arrives.

A spoken session has no later message, so `service/handler/voice/chatTools.ts` puts the data into the instructions it
starts with.

## What a host must do

Keep `instructions` the same from turn to turn.
Anything that can change between two turns belongs in `referenceData`.
A value read from a store, a counter, a status or today's date is such a thing even when it looks like instructions.

## What was rejected

- **A system message that moves to the end of each request.**
  It keeps the cache, since nothing before it changes.
  It breaks the reasoning check instead: the reply that read it was produced after text that the next request no
  longer holds.
- **The providers' own one-turn messages.**
  Anthropic has a turn-scoped system message and OpenAI appends top-level instructions after the input on GPT-6.2 and
  later.
  Each covers some models of one provider, and the chat runs on several of both.
- **Sending only what changed.**
  A list of changes makes the model rebuild the current state from several messages.
  A whole list that says it replaces the earlier ones is harder to misread, and a list is a few hundred tokens.
- **Keeping the list in the system prompt and marking a cache point before it on OpenAI.**
  That would save the notebook documents on OpenAI and still re-bill the conversation on both providers.

## What it leaves

- The live plan and the legal review are still JSON in the host's instructions, and still re-bill the conversation
  when they change.
  They can move to `referenceData` the same way.
- OpenAI requests still carry no cache markers of their own, so any other change inside the system prompt costs the
  whole request there.
- A service restart renders the base prompt again, with a new clock, which costs every open conversation one full
  request.
- Old copies stay in the history.
  They are small, and they are the first thing a later clearing of old content can drop.

## Verified

Unit tests cover the engine, the session, the web chat and the spoken path:
the system prompt is identical across five turns while the data appears, repeats, changes and empties;
each change is sent once, ahead of the person's words;
no message already sent is rewritten;
a restart adds no second copy;
an edit made in a draft's frame reaches the model with the next message.

The same three-message exchange was sent to three models both ways, with about twenty thousand tokens of documents
and a first message of similar size.
The table shows how much of the previous request each follow-up read from the cache.

| Model            | List in the system prompt | List with the message |
| ---------------- | ------------------------- | --------------------- |
| GPT-6.1 Sol      | 0%, 0%                    | 100%, 100%            |
| Claude Opus 5.5  | 52%, 51%                  | 100%, 100%            |
| Claude Fable 5.2 | 52%, 51%                  | 100%, 100%            |

On Claude the old shape still read the base prompt and the documents, and re-billed the conversation.
On OpenAI it read nothing.
Every model named the current draft and its revision in both shapes, so reading the list from the conversation costs
nothing in accuracy.
