---
created: 2026-11-22
updated: 2026-11-22
---

# A chat reads what its model holds

2026-11-22. The ask: remove the cap on a chat's context.
A chat should use as much of its model as it needs, and make room when it gets close.

## What was there

Every chat had a reading budget: how much of the notebook Sky may read into it.
A slider above the composer set it, in seven stops from Off to 750k, and a new chat started at 500k.
The budget travelled with every message, was checked against the model's window, and became fixed with the model
and the effort at the first message.
A saved chat kept its budget and got it back when it was reopened.

The budget did two jobs that no longer need a person.

- **It kept a request from overflowing the model.**
  The request guard does that now, for every step of a reply, and
  [compacts a chat that no longer fits](../../../../_shared-ts/models/Chat/docs/2026-11-22-a-full-chat-is-compacted-once.md).
- **Its Off stop kept the notebook closed.**
  Where it is turned on, the check that asks first whether a message needs the notebook decides that for each message
  ([2026-09-17](2026-09-17-ask-first-whether-a-message-needs-the-notebook.md)).
  Without that check a web chat always reads.

It also cost reliability.
The budget was saved as an estimate and converted back through a ratio that moves, so a reopened chat could come back
at another size than its page showed, and the page's next message was refused as a settings change.

## What changed

A chat's reading budget is what its model holds: the window, less room for the prompt, the tools and the reply
(`readingCap`).
A profile that declares no window reads the fixed default, because there is nothing to measure against.
Nobody chooses it, on any model.

- **The page** has no slider.
  Where it was, the settings panel shows what the chat holds now against all its model can hold, as a count and a
  thin track, and the summary above the composer carries the same count: `212k of 1M context`.
  The count is the chat's last model request as the provider counted it, plus the reply to it.
  The engine reports it with each turn (`heldTokens`), the turn's log entry keeps it, and the routes send it with the
  reply and with the thread, so a reloaded page shows it at once.
  A chat saved before the count was kept shows the size of its last turn's first request until its next reply.
  A model that declares no window shows the count alone.
- **The routes** take no budget.
  A message, a settings change and a voice transcript carry the model, the effort and the filing choice.
  A page loaded before this change still sends `contextTokens`, and the routes ignore it.
- **The host** answers one question, `ChatSettingsHost.readingBudget(contextWindow)`.
  The routes apply it wherever they apply a model (`applyModel`), so the budget follows the model and the two cannot
  disagree.
- **A reopened chat** takes the budget of its model.
  The saved budget is not read back, and the session no longer saves one.
  Each turn's log entry still records the budget that turn ran under.
- **The settings a page reads** still carry `contextTokens`.
  It is what the chat's model leaves for the notebook, and zero tells the page that the chat reads none.
- **The terminal** reads what its model holds by default.
  `--ai-max-context` still sets a ceiling for one run, and a ceiling the window cannot take comes down to the window.

The lock on model and effort after the first message is unchanged.

## What was rejected

- **A lower line on OpenAI.**
  OpenAI bills a whole request at double once its input passes 272K tokens.
  Stopping there would mean compacting a chat at about a quarter of what the model holds.
  The ruling was to use the whole model on every provider and accept that price.
- **A share of the window for the notebook**, such as half.
  It is one more number to explain, and the request guard already keeps any reading within the model.
- **A switch to keep the notebook closed.**
  The per-message check is the way to skip a reading, and the terminal keeps `--ai-no-context`.
- **Showing the point of compaction as the maximum.**
  A chat is compacted before the model is full, to leave room for the reply and further tool steps.
  The page shows the model's own window, which is the number people know, and the conversation says when it was
  compacted.

## What it leaves

- A first reading larger than the model is cut to fit before the first request, and the conversation says so.
- The session keeps one total of what it has read.
  Documents a compaction cleared still count toward it, so a very long chat can stop reading new documents on its own
  while the model has room again.
- Other commands keep budgets of their own, fitted to stops: research, the day summary and the Slack recap.

## Verified

Unit tests cover the routes, the restore path and the terminal's default.
The route tests that chose, changed, refused or restored a budget were rewritten for the rule above, and the one that
only tested a locked budget was removed.
A browser test checks that the settings panel offers no context control, and that the count reads nothing held
before the first message and the reply's real size after it and after a reload.
