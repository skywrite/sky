---
created: 2026-09-04
updated: 2026-09-04
---

# An answer with no body is named, not echoed

## What happened

Two turns in ten minutes failed with the line "turn failed — Bad Request".
Both were the same question, on a plain Haiku profile with a notebook
context; the retry a minute later, same thread, same context, answered.
The AI error log had the same two words and nothing else.

"Bad Request" is the HTTP status text. The SDK prints it only when the
answer's body is empty or unreadable — the provider's own rejections
always carry a reason, and the SDK passes that on. So an answer that says
only its status came from something in front of the API, and the one
useful thing to know is that sending again tends to work. The engine
clamped the SDK's message and threw it as the turn's error; the session
logged the same; the page and the terminal showed the two words.

## The rule

`turnErrorMessage` (ChatEngine/turnErrorMessage.ts) decides the line a
turn fails with:

- An API call error with a status and no body — empty or whitespace — is
  named: "api.anthropic.com answered 400 with an empty body. Try sending
  it again." The host comes from the call's URL, the status from the
  answer.
- A retry the SDK gave up on is judged by the error it gave up on.
- A provider's own reason stands as it was — "prompt is too long: …" says
  what it says. So does a call that never reached the API, and any other
  error.

The engine's catch clamps that line as before; the session logs it; the
hosts show it.

## Verified

- 2026-09-04 — a bodiless 400, a blank-bodied 503, and a 529 inside a
  retry the SDK gave up on each name the host and the status and say to
  send again; a 400 with a reason, a call that never connected, a plain
  error and a string keep their message (helper test). An engine whose
  invocation rejects with a bodiless 400 throws a TurnError carrying the
  named line (engine test).
