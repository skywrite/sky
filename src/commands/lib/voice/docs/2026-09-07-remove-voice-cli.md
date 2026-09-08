---
created: 2026-09-07
updated: 2026-09-07
---

# Remove the voice CLI

Browser calls own the Sky and Sonny conversation. The older terminal command
kept a separate single-speaker WebSocket session, native audio transport, and
notebook delegate that no longer served that experience.

Remove `ai:voice` and the `ai:voice:audition` browser-opening wrapper, along
with the terminal audio code and its tests. Browser calls, voice settings,
and the receive-only audition page at `/voice/audition` keep their existing
routes. No package dependency is exclusive to the removed commands.

The shared notebook module retains source labels and the answer type used
by browser research. Its old `ask_notebook` execution path is removed, as
is the terminal-only PCM session configuration.

Voice design notes now live beside the surviving voice library. Earlier
dated notes remain unchanged and describe the transports that existed then.
Command discovery follows source files; rebuild the command manifest after
removal so help and completion no longer advertise the deleted commands.
