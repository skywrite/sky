---
created: 2026-09-05
updated: 2026-09-05
---

# The budget is a slider, and the model's window ends it

## What happened

Two chat turns on the Cerebras Qwen profile failed because the request was
196,699 tokens against the 131,072 the host serves a request — the chat
asked for its usual 300k of notebook. Nothing told the page or the terminal
that a model could take less; the budget was a row of buttons that offered
300k and 500k to every model alike.

## The rule

The budget is a slider with seven stops — Nothing, 25k, 50k, 100k, 300k,
500k, 750k — under the composer with the model picker. The thumb follows a
drag; the budget changes when the thumb is let go, and applies from the
next message.

A profile may declare `contextWindow`, the tokens its host serves in one
request (`_shared-ts/ai/models.ts`; the Cerebras Qwen profile says
131,072). The budget that fits leaves room for the rest of the request —
the system prompt and the tool schemas, the reply with its thinking — and
for the estimate being four characters a token where the host's tokenizer
counts more (`universal/ai/readingBudget.ts`: 131,072 leaves 79,257 to
read). A budget past that drops to the highest stop that fits, 50k there.
The slider ends at that stop; the stops past it stay drawn, grayed, out of
reach, and the note says whose window ends it. The routes fit a budget to
the model it will ride with — the one being chosen, else the thread's — so
a model switch lowers a budget that no longer fits, live thread or not;
the terminal fits `--max-context` the same way and prints the lowering. A
profile with no window declared is not capped.

## Notes

- Mantine's slider reports a pointer's stop a frame late and its release
  at once, so a quick tap is released before its stop arrives. The control
  keeps the latest stop as it arrives and commits on release when it is
  known, else once the slider has been still for half a second; the thumb
  holds the target until the service answers.
- The client bundle rebuilds on the sources' mtimes at each asset request,
  so a page edit needs no service restart.

## Verified

- 2026-09-05 — on the real page through Playwright: a slow click, a quick
  click, a drag and an arrow key each post their stop once, in order, and
  the strip follows. Route tests: the window rides on the choice; a 300k
  choice on the small-window model drops to 50k while 25k stays; the wide
  model takes 300k again; a live thread switched to the small-window model
  has its budget lowered and its context reassembled within it. Helper
  tests: the stops, the nearest stop, the cap and the fit.
