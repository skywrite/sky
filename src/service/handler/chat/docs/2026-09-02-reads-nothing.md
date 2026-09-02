---
created: 2026-09-02
updated: 2026-09-02
---

# Reads nothing: a budget of zero keeps the notebook closed

## What happened

A font-consistency mission on a Google Doc ran forty minutes. The wait was
the document agent's, not the notebook's, but the question came up
anyway: why read a week of the notebook before a request that names a
document and asks for a style change? The answer for now is a switch,
not a guess: the person decides per thread.

## What changed

The reading budget gained a first stop, **Nothing**. It is `contextTokens:
0` on the wire, and the rule that makes it mean something lives in the
context model rather than the page:

- `ChatContext` turns under a zero budget read nothing and query nothing.
  `firstTurn` and `evolveTurn` return before the producers, and log a
  turn with zero kept under a zero budget. Every turn still writes an
  entry: an absent turn would be indistinguishable from a recording gap.
- `ChatSession` starts closed when the budget is zero: no baseline
  gather, and the context prompt says the notebook is closed. An empty
  activity block would read to the model as a notebook with nothing in
  it. A budget set later gathers the baseline at the next message and
  runs that message as the first gathering turn.
- `firstTurn` now advances the turn counter instead of setting it to
  one, and the first assembly records the universe whether it happens on
  turn one or after closed turns. Resume reads the universe from
  whichever entry carries it, so nothing there had to change.
- The route accepts zero, marks the start frame `closed`, and answers the
  context route with "Not reading your notebook for this thread." until
  something is read. The story has a `closed` kind.
- The page: the control reads "Reads nothing", its note says what that
  means, the gather line says "not reading your notebook", the files
  count leaves the strip, and the panel shows the closed turns.

## What it is not

It is not the pre-check that decides for the person whether a request
needs the notebook. A request that looks self-contained can still draw on
the notebook: the mission that prompted this got its point sizes and its
tab list from the records of earlier missions on the same document. A
switch the person flips misclassifies nothing. If a check comes later, it
should pick the baseline size and keep the per-question retrieval, not
answer yes or no.
