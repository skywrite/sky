---
created: 2026-09-03
updated: 2026-09-06
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

## 2026-09-06: the time stays

A mission ran for nineteen minutes with the counter on its chip, and the
moment it ended the fold showed the tool's name and the summary, and the
time was gone. The counter's last reading was still in the page at that
moment; the folded row never printed it, and after a reload nothing could,
because the run recorded when it started and not when it ended.

- The routes stamp `finished` on the run as the tool ends, and on any run
  still open when the turn ends. The `tool-finished` frame carries it; the
  thread record returns it with the run.
- The folded row reads `Google Agent Output · 19m28s — what it did`. A
  run from before this has no end time and shows no time, rather than a
  wrong one.

## 2026-09-08: a call, readable

A research run's lines reached the page as the terminal had them: `→
notebook_query {"graphql":"{ documents(where: {bodyContains: \"Atlas\"…`,
the call's input as JSON, its quotes escaped, cut at a hundred characters
so a query lost its date bounds and its fields. Asked: any query should be
presented nicely, no escapes — and the whole record should read like a
conversation, not a log.

- The research command narrates each call in full. `describeCall`
  (`research/lib/narrate.ts`) prints `→ notebook_query` and the query
  under it as graphql-js prints it — a long argument list breaks where a
  reader would break it — and `→ notebook_read <path>`, `→ person_lookup
  <name>` with the field whole on the line. A query that does not parse
  is shown as the model wrote it. The terminal gets the same lines, dimmed
  and indented under the run.
- The page reads a line that begins with the arrow as a call
  (`toolLines.ts`): the name, and what it asked on the line or dedented
  from beneath it. The older JSON form is read too, and a record cut
  mid-way is read as far as it goes and marked cut, so the runs already
  on the service render without escapes the moment the page reloads.
- Everything a tool said is a card (`toolLinesView.tsx`, `toolLines.css`):
  a call carries its name like a sender's and what it asked — a query as
  a block colored by token, a notebook file as a link to its page; any
  other line is the tool's words, and several paragraphs read as
  markdown. The cards flow with the page rather than in a scroll of their
  own; the fold above closes them.
- The same reading serves the run's parameters and result: `FieldsView`
  shows an object field by field, a string as its text with its
  paragraphs kept, a `graphql` string as the colored block, a list one
  item per line, anything nested as JSON — where `JSON.stringify` had put
  the escapes back. A value the size of a brief scrolls in place; the page
  does not grow by it.
- The last thing a running tool said, under its chip, is one line:
  `notebook query · { documents(…) { path markdown } }`.

What it is not: a structured channel for calls. The arrow at the start of
a line is the convention, spoken by the terminal's words; a tool that
narrates its calls prints the arrow, the name, and the input whole.

Verified 2026-09-08: parse, compact, dedent, and token tests (client);
`describeCall` tests (research); tsc, oxfmt, oxlint on the touched files;
headless captures over synthetic threads — the older cut record, the new
narration, a running chip — in light and dark, and a saved thread's real
mission run opened on the page.
