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

## Later the same day: the fold

The first cut left a finished run as it was when the person last touched
it: a run opened to watch it work stayed open, a wall of lines under the
reply. Asked for: once the tool is done, one line with a caret, and the
lines behind it on a click.

- Ending folds the run. The chip gives way to one line — `▸`, the tool's
  name, and what it did — and a click on it turns the caret down and
  unfolds the lines; a click again folds them.
- What it did is a small model's one line. As a run ends with more than
  one line, `toolOutputSink` hands its newest lines (up to 120) and how it
  ended to a summarizer; `summarizeToolRun` asks the fast role for at most
  twelve plain words and the routes stream the answer as `tool-summary`,
  keeping it on the run as `summary`. A run of one line is its own label
  and asks for nothing.
- Until the line lands, or when none comes (the model failing or taking
  over twenty seconds logs to the AI error log and yields nothing), the
  run's last line stands in. The reply keeps streaming meanwhile. A quick
  reply can end the turn — and its stream — before the line lands (seen
  live: a tool that answered in one word); it is on the thread by then,
  and the page reads the thread back at two, six, and fifteen seconds
  after the turn until every ended run that said more than one thing has
  its line.

## Later the same day: what the call was about

A search ran and the page said `web search`: a chip with the tool's name
and nothing else. Asked: make it clear what it is searching for. The
message above had said, in the person's words; the chip should say, in
the call's.

- The model's record of a call (the session's `tool-call`, as its step
  ends) carries the call's input. `callSubject` turns it into one line:
  the field a tool acts on when it has one of the usual names (`query`,
  `url`, `path`, `mission`, `message`, `text`), else the call's first
  string; the first line only, spaces collapsed, cut to a chip's width;
  an address without its scheme and `www.`. The routes stream it on the
  `tool-call` frame as `subject`.
- The routes keep it on the run. A run that spoke for itself takes the
  subject once the record lands. A tool that ran without a word — a web
  search — had no run on the thread at all, only a chip the page made
  for itself and lost on a reload; it gets a run for its record alone. A
  call that asked first is recorded before it runs, and the run that
  follows takes that record over rather than standing beside it.
- The chip shows the subject after the tool's name: `web search · atlas
  roadmap reviews`, `web fetch · example.com/atlas/roadmap`. Two searches
  in one step are two chips, where they folded into one.

What it is not: a running chip with its subject. The model's record
lands as its step ends — after a command-backed tool has run and folded
— so the fold's line, what the tool did, stands for that run, and the
subject rides its record for a reload. A record at the moment of the
call would come from the engine's stream, which has the part; that is a
later rung.
