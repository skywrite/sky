---
created: 2026-10-11
updated: 2026-10-11
---

# The reading budget counts the model's tokens

## What looked wrong

Opus 5.5 and Fable 5.1 have 1M windows, and the chat's reading slider
stopped them at its 500k step; before 10-05 they reached 750k. Nothing had
capped them. The slider counted four-character estimates, and on 10-05
(`bf8f7f85`) the window fit began dividing by each model's learned ratio —
about 1.8 of its tokens per estimate on Opus 5.5, 1.43 on Fable 5.1 —
instead of a fixed 1.25. At 1.8 a 750k read is about 1.35M of the model's
tokens, so the honest end of that slider was 500k. The old 750k was never
delivered: since 09-25 the request fit (`ChatEngine/requestBudget.ts`, 85%
of the window) trimmed it to roughly 450k on Opus 5.5 before sending.

The fault was the unit. A person reads "500k tokens" as what the model
counts, and a second, private kind of token made a correct window limit
look like an arbitrary cap.

## What changed

- The budget is in the model's tokens: the slider, `--ai-max-context`,
  `CHAT_READING`, a thread's settings, `ChatSession.contextTokens`.
  `readingCap(window)` is the window less the prompt, tools and reply, so a
  1M window reaches 750k.
- `ChatSession` holds its model's ratio (`tokenRatio`, from `ratioFor`) and
  gives `ChatContext` the text the budget holds, `estimatedTokens(budget,
  ratio)`. It keeps that ratio while the model stays, so the assembled text,
  and the prompt cache with it, holds still between turns; `setModel` re-reads
  it for another model.
- What a session hands a host — rebuild reports, the reduction notice — is
  restated in the model's tokens (`models/Chat/modelTokens.ts`); the Context
  panel restates the saved log the same way (`timelineOf(log, turns, ratio)`).
- The default budget is 500k: 300k estimates was about 540k of Opus 5.5's
  tokens.

Research is unchanged: a chat hands it the estimate its budget holds, and it
counts in estimates throughout.

## What stays an estimate

The context log and the saved budget (`recovery.contextTokens`,
`settings.contextTokens`, `stats.budget`) stay four-character estimates.
Rewriting them would change every saved chat's hidden trailer, and old and
new records would need telling apart. A restore converts with
`budgetFromEstimate(estimate, ratio)` once the thread's model is known
(`restoredModelPrefs`), at the ratio of the model it runs on now: the exact
size in the model's tokens, landing on a stop within a twentieth of one,
since the ratio drifts between save and restore. So the thread reads the text
it always read. A 500k budget saved now comes back as 500k; a 300k saved
before this change comes back as the roughly 540k it always read on Opus 5.5,
and so does one saved under a retired profile that now opens on Opus 5.5.
Converting at the ratio of the model that last ran was tried first: live
chats saved under the retired Opus 5 profile, with no model recorded, came
back at the fixed 1.25, reading a third less than they had.

Rejected: saving the ratio beside the budget. Exact, but more machine data
in the notebook's chat files.

## A page open across the change

A page loaded before the change still sends the old number, the estimate its
thread was saved with, and the routes refuse a locked thread's message whose
budget differs. `sameBudget` reads a number that restates to the thread's
budget as that budget. A locked thread never takes its budget from the page,
so the allowance cannot change one.
