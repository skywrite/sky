---
created: 2026-09-04
updated: 2026-09-04
---

# The page waits through a restart

## What happened

A web search ran while another session saved a server file. The service
reloads on every save under it, and that reload pushed its open
descriptors past the recycle line, so the process restarted twice in
fifteen seconds. The turn died with it. The page said "— thinking · 146s —"
and kept counting: a reload in place leaves the browser's socket open and
mute, so the page never saw the connection close, and its "connection
closed" line never fired. The thread was not kept, so nothing of it
survived either.

The terminal has the opposite shape. Its turn runs in its own process;
only its notebook queries touch the service, and those wait for a restart
on a fixed schedule of about ninety seconds. Nothing of the reply lives in
the process that restarts. On the web the reply lives there, so waiting
can bring the connection back but not the reply — and the page should at
least know which of the two it has.

## The rule

- The service speaks at least every ten seconds while a turn runs: a
  `heartbeat` frame when nothing else. A model can think for a minute
  before its first token; the heartbeat is how the page tells that from a
  dead connection.
- Silence past twenty-five seconds is a lost connection, however the socket
  looks. The frame reader (`turnStream.ts`) ends the stream with a
  `Silence`, and the page treats a stream that closed without its turn
  frame the same way.
- The page then waits for the service the way the terminal does, on the
  same schedule, with "sky is restarting" where the reply would be. Open
  tool runs are marked ended; what they were doing is unknown until the
  service says.
- When the service answers, the thread as it holds it is the truth. A turn
  still running there is followed by the poller; a thread that reached the
  reply shows it; a thread that came back without the message, or not at
  all, lost its reply to the restart, and the page says so under the
  message: "sky restarted while replying. Send it again."
- A send the service never received waits the same way and goes out once
  the service answers — a message it never had is safe to send again.

## What it is not

The reply does not survive a restart; nothing in the process does. A
thread that is kept comes back from its snapshot at its last completed
turn, so the message just sent is not there yet — the snapshot is written
as a turn ends, not as it begins. Writing it as the turn begins, so the
restored thread can say "restarted while replying" from the service's
side, is the next rung. Restarts that wait for an idle service, and turns
that run outside the process, are the ones after.
