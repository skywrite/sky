---
created: 2026-09-03
updated: 2026-09-03
---

# A tool's own lines reach the page

## What happened

A document mission ran forty minutes while the page said only "thinking",
with a count of seconds. The person watching had no way to tell work from
a hang. The terminal would have shown the mission narrating itself the
whole time: "Mission started", each batch applied, "Still working, model
thinking" every two minutes. On the web those lines went into a buffer
nobody read: the service's command context is built with a `BufferedOutput`.

## What changed

- The session's tools get their own command service, built on a context
  forked with an `EventOutput`. The producers keep the quiet context; a
  gather is not a tool and should not read as one.
- `toolOutputSink` turns the output events into three tool events. A
  command run one level under the session's context is a tool; deeper
  runs speak for the tool that composed them. Lines lose their colors and
  the terminal's bullet; stages become lines; in-place ticks are the
  terminal's and only the closing count reaches the page; streamed pieces
  gather until a line ends or the run does.
- The routes keep one run per call with the thread, capped at its newest
  400 lines, and stream `tool-started`, `tool-line`, `tool-finished`. A
  line from a tool nobody announced starts its run, so a host without
  boundaries still gets its lines shown. A run still open when the turn
  ends takes the turn's outcome.
- The page holds runs beside the cards. The chip of a running tool
  carries the time since it started and the last thing it said under it;
  a click opens everything; once done, the lines fold and stay. The
  model's own record of a call and the run it produced are the same
  entry: whichever comes first makes the chip, the other fills it in.
- The day's list shows the latest line of a running tool where it showed
  nothing before.

## What it is not

It is not the saved record. The transcript's context log keeps the tool
trail it always kept; the runs are the page's, for the life of the thread
on the service, like the cards.
