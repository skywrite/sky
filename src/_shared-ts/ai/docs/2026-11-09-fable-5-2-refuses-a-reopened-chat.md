---
created: 2026-11-09
updated: 2026-11-09
---

# Fable 5.2 refuses a chat that was reopened

## What was wrong

A web chat on Fable 5.2 answered its first message.
The service restarted, the thread came back from its snapshot, and the next message failed:

```
Anthropic API error (400): messages.1.content.0: Invalid `signature` in `thinking` block.
The block is bound to a different conversation. [...]
The `system` prompt differs from the one this block was created with.
```

Retry failed the same way every time.
A chat's model is fixed after its first message, so the thread could not be moved to another model either.

## Why

Fable 5.2 and Mythos 5.2 tie each reply's reasoning to everything sent before it:
the system prompt, the tool list and the earlier messages.
When that reasoning comes back in a later request, the API compares it with what the request now holds and requires a match.
The earlier models that run this check enforce it only for accounts created on or after 2026-08-31.
These two enforce it for every account, so a chat that worked on Fable 5.1 fails here.

A restored thread does not send what it sent before.
`createSession` builds the prompt's clock from the time of the restore, not from the thread's start,
and adds the file list of the restored conversation.
The reply's reasoning belongs to the first rendering, so the mismatch is permanent:
nothing the person does in that thread brings the first rendering back.

A chat that never went through a restart did not fail.
On the same evening another chat on the same model took its follow-ups.

Chat changes content it already sent in other places too.
These were found by reading the code and have not been seen failing:
the third system segment carries the live plan, the legal review and the writing drafts;
the task tools exist only once a plan does;
earlier attachments can be swapped for references;
the request budget can trim earlier messages;
the closing-step and yield notices ride one request only.

## What changed

`resolveProfile` adds `thinking.blockBinding.prefixMismatchBehavior: 'drop_block'`
for `claude-fable-5-2` and `claude-mythos-5-2`.
The Anthropic adapter sends it as `thinking.block_binding.prefix_mismatch_behavior`
and adds the `thinking-binding-controls-2026-08-01` beta header the API requires for it.
The API then drops the reasoning it cannot match and answers.
The visible conversation and the tool results are untouched.

The token count that runs before a chat request copies `thinking` and the headers from the real request
(`inputTokenLimit.ts`), so it carries the setting too.

The setting lives in `resolveProfile`, not on the presets.
A thread keeps its own copy of the model configuration it started with,
so a preset edit would not reach a chat that already exists, the broken one included.

Verified live on 2026-11-09 with two requests through `resolveProfile`:
a reply, then a follow-up with the clock line of the system prompt changed.
Without the setting the follow-up returned the 400 above.
With it the follow-up was answered.

## What was rejected

- **The setting on every model that accepts it.**
  On the earlier models the check is not enforced for older accounts, and a request that names a behavior opts in.
  Reasoning that reaches those models today would start being dropped.
- **Removing the reasoning from the history before sending.**
  The API accepts only a contiguous run removed, and the same removal has to be replayed on every later request.
  The setting does the same job without Sky keeping that record.

## What it costs, and what is still owed

Dropped reasoning is not billed.
The model thinks again where it was dropped, which can raise output tokens on the turn after a restart.

Anthropic describes the setting as a stopgap.
The durable fix is to stop changing what was already sent:
keep the rendered prompt with the thread and replay it,
deliver plan and draft state as messages,
and keep the tool list fixed for the life of a thread.
Until then the setting is what keeps a Fable 5.2 chat answering.
