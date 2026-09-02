---
created: 2026-09-01
updated: 2026-09-01
---

# 2026-09-01 — Meeting from a file

The web app can now take a Zoom transcript, a notetaker's text, or a voice
memo dropped on the day, and run the same pipeline the terminal runs.

## Why the seams, not generators

The command framework already had an async-generator protocol for prompts
(`runWithPrompts`), with one user. Turning every `run()` into a generator
would have been viral through composition — this pipeline is four commands
deep — and `runParallel` could not interleave two generators' questions.
The two seams that already half-existed did the job instead:

- **Output.** `OutputHandler` is forked into every composed child and had
  `write()` for streamed text and `child(name)` at every boundary. A new
  `EventOutput` turns those into events; `CommandService` now calls
  `commandStart`/`commandEnd` on the child's handler, which the interface
  declared and nothing called.
- **Prompt.** `CommandContext.prompt` is new: `text`, `confirm`, `select`,
  `multiselect`, `form`, and `interactive`. The console fills it with clack
  (the transcript review reads exactly as before, one item at a time); a
  headless run is unattended and skips the questions it used to hang on.

## What changed in the pipeline commands

- `audio:transcript:create` streams the transcription (`stream: true`),
  falling back to the plain call if a stream fails before its first word;
  a streamed reply reports no length, so the file is probed for it.
- `audio:transcript:clean` asks its review through the prompter. It had no
  non-TTY guard: run from the service it would have sat on the service's
  stdin.
- `audio:transcript:summary` streams the write-up as it is written and
  asks "Any corrections?" in a loop through the prompter, re-showing the
  fields after each round.
- `meeting:new` accepts action items through the prompter (the `isTerminal`
  gate is gone), opens the editor only on the console, keeps a stated `when`
  over the extracted time, and attaches the recording and its transcript
  on the voice-memo path.
- `journal:new`, `notes:new`, `message:new`, `event:new` open the editor
  only on the console; `journal:new` and `message:new` now return what they
  filed.

## Later the same day — progress as a vocabulary, the runner as the stream

The first cut derived the page's ladder from command boundaries and a map
of command names to labels, and the row's second line from the last log
line. Both were the web knowing the pipeline by heart. The design settled
on after a long back-and-forth about async generators:

- Commands stay plain async functions. They report with three new methods
  on the output handler, `plan`, `stage`, `tick`, in the words a person
  reads, and ask with `await context.prompt.…`. Only a command body could
  yield; any helper can call.
- The framework has exactly one generator, `runCommand`, which turns those
  pushes into a pull stream a host reads with `for await`. A question is a
  `prompt` event with its own `reply`; stopping the loop cancels the run
  through `context.signal`.
- The terminal renders the same vocabulary through `ConsoleOutput`: a
  stage is the cyan phase line the phases always had, a tick counts in
  place.

`meeting:new` announces its plan; the transcript pipeline reports its steps
by the same ids; action items tick as they route. The import route reads
the runner's stream and the page draws whatever plan any command sends,
so the other four doors need no wiring of their own.
