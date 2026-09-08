---
created: 2026-09-07
updated: 2026-09-07
---

# Voice inside Chat

Talk had its own sidebar destination and a transcript separate from text
chat. Moving its button alone would leave a conversation that forgot its
typed history when voice started and forgot speech when typing resumed.

The chat owns the voice session. Its waveform sits immediately to the right
of Send, and the existing composer stays mounted while the inline voice bar
appears. Typed messages during a call enter the Realtime controller's user
history and speaking queue, using the same interruption and research rules
as microphone input. Both speakers receive the preceding chat as historical
context before the opening response. No microphone opens on navigation.

When voice ends, a count-checked append joins its delivered conversation to
the chat session. Identical retries are idempotent, while a newer text reply
causes a conflict instead of being overwritten. The append does not invoke
the text model or rebuild its previous tool history. It snapshots the new
history and advances later context numbering past the spoken exchanges.
Consecutive Sky and Sonny utterances are labeled and grouped into one
assistant reply to retain the transcript's user/reply exchange convention.
An opening greeting is not turned into an invented user message.

Save & close waits for this handoff and then uses the normal save path.
Connection failure also attempts to retain the delivered transcript. The
page retains live turns when a handoff fails so the person can retry; calls
still in progress have no server transcript until that handoff. Navigating
away closes both connections, stops microphone tracks, and attempts the
same handoff without updating the unmounted page.

## Verified

- Controller tests cover shared prior history, typed input during voice,
  microphone mute/unmute, and cleanup, alongside the existing two-speaker
  interruption and research lifecycle tests.
- HTTP tests use real chat sessions and recovery snapshots to verify a
  voice-first chat, retained filing settings, idempotent handoff, restart
  recovery, subsequent text context, correct branch numbering, malformed
  speakers, and rejection of stale appends.
