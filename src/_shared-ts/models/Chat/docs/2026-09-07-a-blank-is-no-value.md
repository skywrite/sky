---
created: 2026-09-07
updated: 2026-09-07
---

# A blank is no value

A chat asked the Google agent to create a new doc, and the page asked for
a go. The rule says a mission that only creates runs without one; the card
showed no target and no import. On the same thread the first call failed
before it started, with no output, and the model tried again. Another
thread saw the failure spelled out: `Unknown model profile: ""`.

The model had filled the optional string parameters it had nothing to say
about with empty strings. `file: ""` is a string, so the approval rule
read it as a target and asked, and the card hid it because there was
nothing to print. `reasoning: ""` is a string, so the runner looked up a
profile named nothing and failed the call before any Google work.

## What changed

- `withoutBlankStrings` in `commands/lib/chat/notebookTools.ts`: a string
  that trims to nothing is dropped from a tool's input. False, zero and an
  empty list stay; they say something.
- Every tool input passes through it twice, at the two places the raw
  input used to land: the approval policy, before a tool's own exemption
  and session key read it, and `runToolCommand`, before the command runs.
  The web session's approval card reads the cleaned input too.

## Rules

- A model's blank is the model's way of leaving a field out. Treat it so,
  everywhere, rather than teaching each command to tolerate it.
- The rule for asking is about what a call does, never about the shape of
  what the model typed.

## Verified

- `notebookTools_test.ts` — blanks drop and real values stay, the original
  untouched; a blank target runs without asking and a real one still asks;
  the command receives only the fields that say something.
- Live: pending the next mission from a chat.
