---
created: 2026-09-01
updated: 2026-09-25
---

# Meeting from a file — the import

Design notes for `src/service/handler/import/` and the page that fronts it,
`theme/client/import.tsx`.

## What is built

A document, a transcript, a recording, a screenshot or a video's `.srt` dropped on the
day page becomes an **import job**, and so does text dragged onto it out of
another app: the upload is staged under `<user-data>/imports/<id>/`,
read back at once, and, on Start, the matching command runs inside the
service the way the terminal runs it. Everything the job says travels as
server-sent events.

- `readback.ts` — what a file is, before anything runs. A `.vtt` is parsed
  for its length, speakers and turns, and an `.srt` the same way (its cues
  count from zero, so it says nothing about the clock); a `.txt` for its
  stamped turns; a recording for its size (its length comes from the container, probed by
  the host); a screenshot for its size and its pixels (`lib/media/image`
  reads the header); a dragged text for its lines and its first words;
  a document for its format, leaving the work time to the person.
  A file sky does not take, or cannot, gets a sentence.
- `jobs.ts` — the job store: memory first, a `job.json` beside each upload
  so a restart still knows what was there (a job that was running when the
  service died reads as failed, with the file kept). A filed import and a
  refused file leave the store ten minutes after they settle, at the next
  look, upload and all; a restart clears them at once. Failed and cancelled
  runs stay, for a Start to pick up. `JobPrompter` is how a
  running command's question reaches the browser: parked on the job until
  an answer comes back.
- `mod.ts` — the routes, over a host of seams so tests script the world.
- `createImportHost.ts` — the production host: the door commands run
  in-process through `CommandService`; the pipeline's run record is keyed
  at upload and read back when a stopped job is opened again; the first minute of a recording is
  heard through the pipeline's own transcription call and a small model
  names the kind; the day's calendar is read the way the meeting check
  reads it.

## The person's side

The Links picker is available before Start and during review; after filing
it lives in Details. Persistence and reference rules are documented in
[Links between notebook records](../../links/docs/README.md).

One door for every file kind. The kind picks the command:

| Dropped | Door |
| --- | --- |
| `.vtt` | `meeting:new --from-zoom-vtt` |
| `.srt` | `video:new --from-srt` — a video's transcript; a Loom's, a caption file's |
| `.txt` | the kind chosen in the dialog: `meeting:new --from-text` (first), or `message:new --from-text` — a chat's export |
| text dragged in | the same two doors on the text, staged as `selection.txt`: a message first, a meeting first when its lines carry a notetaker's stamps |
| audio | the kind chosen in the dialog: `meeting:new` and `event:new` with `--from-voice-memo`, or `journal:new`, `notes:new`, `message:new` with `--from-audio` |
| image | `message:new --from-image` — a screenshot of a conversation |
| `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.md` | `notes:new --from-file` — a note about work, with the document attached and summarized |

Screenshots dropped or selected together form one import and one message.
The dialog lists every file, and the job keeps the complete group when reopened.
Other file kinds remain separate imports. Each screenshot retains its capture
time so `message:new` can read the conversation in capture order; size limits
apply to each image, and a refused image blocks the whole group.

Document imports open **Record work** with an editable activity suggested from
the filename, the viewed day, an empty work-time field, and optional notes.
The person supplies the time or range; neither the document's dates nor its
modified time may supply the work time. Add to day saves the note and attachment
before summarizing and enriching it, and opens the chosen day if it was changed.
The dialog shows summarization progress and explains that it is safe to close;
closing it leaves the work running. Completion uses the same temporary bottom
notification surface as a saved chat, with Open note or a failure's retry path.
The Files page's Create note action uses this same flow.

Document retries use the import job's identity, not the file's content hash:
the same PDF can represent separate work sessions. `notes/lib/fromDocument.ts`
keeps a checkpoint under `note-imports/` in user data, preserving the allocated
readable filename, summary, and enrichment. A failed summary returns the saved
note's path, so the import can save explicit links and offer Open note and
Retry summary. Retrying appends the summary once to the current note, preserving
the person's edits. A successful retry reconnects the import page's event feed.

The dialog settles **what** (for audio, sky's guess from the first minute
is preselected) and **when** (proposed from the file's time and length,
checked against the calendar within the meeting check's fifteen minutes;
for a screenshot, when it was taken, and the calendar is not asked; for an
`.srt`, from the file's time and length, and the calendar is not asked
either — a video is not a meeting).
A when the person changed is passed as a stated argument, which the
command keeps over anything the words say; left as proposed, it is passed
as the file's clock, which the pipeline resolves the words against and
falls back on when they give no time. Either way the write-up says what
was settled, and the check's time field shows it (`startArgs.ts`).

Four stops need the person, and each is the CLI's own prompt given a form:
the names review (`form`), the write-up corrections (`text`, in a loop),
the clarifying questions after a voice memo (`text`, one at a time under
the `questions` stage: the words above each question, Skip answers
nothing, Skip the rest answers null and ends them;
`commands/all/meeting/docs/README.md`),
and the action items (`place`: tick what you'll own, and a chip on every
row says when it happens — Today, Tomorrow, a day this week, another day,
a time, or the Next list; one chip in the lead sentence moves the whole
batch; the terminal keeps its multiselect). They arrive as `prompt` events
and are answered through `POST /import/:id/answer`; the answer rides on the
`answered` event, so after Accept the page can show where each item went,
grouped by day, with the day a link away. Where an item lands is
`commands/all/meeting/docs/README.md`. A screenshot has one stop:
`message:new` shows the conversation it read and the fields beside it, and
asks for corrections in the same loop; the platform is a `select` when the
screenshot did not say. The screenshot moves into the day's attachments
without a question — the upload was sky's staging copy, not the person's
file — where the terminal asks. A text filed as a message goes the same
way: the conversation read out of it, one check, and the text kept with
the message.

A run that stops — a failure, a cancel, a restart — leaves the pipeline's
run record behind, keyed by the file's bytes at upload. Opening the job
again shows what it would pick up at ("Picks up where the run from Today
0:06 stopped, at Checking the write-up") with *Start over* beside it, and
Start runs the same command, which reads the record on its own. The
record itself is the transcript pipeline's: see
`commands/all/audio/transcript/docs/README.md`.

## Routes

| Route | Does |
| --- | --- |
| `POST /import` | multipart `file` (+ `lastModified`), repeated in matching order for a screenshot group → one job, read back; optional `day` selects a document's work day; or a `text` field alone for a dragged text |
| `GET /import` | the rows for the Running block |
| `GET /import/:id` | one job, plus the journal types the dialog offers |
| `GET /import/:id/events` | SSE: every event so far, then live until the job settles |
| `POST /import/:id/start` | `{kind, when, whenStated?, dayStated?, category?, journalType?, fresh?, summary?, body?}` — runs the door command; document notes require `summary` and accept a range in `when`; `fresh` starts a transcript pipeline over |
| `POST /import/:id/answer` | `{promptId, answer}` |
| `POST /import/:id/cancel`, `/remove` | abandon the run; forget the job and its file |

## Events

`listen`, `calendar`, `plan` (the command's steps), `stage` (the step
running now, with its detail), `tick` (a real count), `line` (a log line —
the terminal's words, uncolored), `text` (a streamed piece: the transcript,
the write-up), `prompt`, `answered`, `state`. Each carries `seq`; a
reconnecting client drops what it has seen.

## How commands report progress

Commands stay plain. Inside a command, progress is a method call on the
output handler and a question is an await on the prompter:

- `output.plan(steps)` — the steps ahead, in a person's words, once the
  command knows its inputs. `meeting:new` plans transcribe (audio only),
  names, write-up, file, action items.
- `output.stage(id, label, detail?)` — the step running now. A child
  command reports its step by the same id the parent planned it under.
- `output.tick(done, total, unit?)` — a real count, never an estimate.
- `output.write(delta)` — streamed text, the transcript and the write-up.
- `await context.prompt.form(...)` — a question; `context.signal` is the
  host's cancel.

The one generator in the framework is the runner,
`commands/lib/core/runCommand.ts`: it turns those pushes into a stream a
host reads with `for await`, with each question arriving as a `prompt`
event that carries its own `reply`. The terminal renders the same calls
through `ConsoleOutput`; the route here reads the runner's stream and
relays each event to the page. Command-name maps are gone: the ladder is
the command's own plan.

## The seams underneath

- `commands/lib/output/OutputHandler.ts` — `plan`, `stage`, `tick` beside
  `log` and `write`; `EventOutput` turns them into events, `ConsoleOutput`
  prints them, `BufferedOutput` records them for tests.
- `commands/lib/prompt/` — `Prompter`, the way back into a command:
  `ClackPrompter` on the console (unattended when there is no terminal),
  `UnattendedPrompter` headless, and the runner's `EventPrompter` here.
  `CommandContext.prompt` carries it through every composed child;
  `CommandContext.signal` carries the cancel.

## Narrative

- `2026-09-24-an-event-from-a-voice-memo.md` — the event door takes
  `--from-voice-memo` as the meeting door does; `--from-audio` stays as
  its alias.
- `2026-09-06-finished-imports-leave.md` — what a filed import and a
  refused file leave behind, and when they go.
- `2026-09-01-meeting-from-a-file.md` — the design, the seams, what changed
  in the pipeline commands.
- `2026-09-03-a-screenshot-is-a-message.md` — the image door: the read-back,
  and what it took for `message:new` to run from the page.
- `2026-09-05-a-video-from-its-transcript.md` — the `.srt` door: the
  read-back, and what it took for `video:new` to run from the page.
- `commands/all/meeting/docs/2026-09-03-action-items-land-on-days.md` — the
  action-item step: a when on every row instead of everything to Next.

## A drop is an import

Every file dropped on the day, and every file the composer's paperclip
takes, comes through this dialog: a door takes it, or the read-back says
why not and the file leaves with Remove. A recording over the transcription
cap, or a screenshot over the vision model's, is refused before its bytes
go up, in the read-back's own sentence.
Keeping a file with the day as it is — a PDF, a Zoom video, anything — is
the Files pad's job, never this dialog's: `../../day/docs/README.md`.

Text dragged onto the day comes through the same dialog, which asks what
it is. The page takes a drag carrying `text/plain` and no `text/uri-list`,
so a dragged link or image is not an import. It ignores a drag that began
on the page itself, and leaves text let go in a field to the field. The
When it proposes is the moment of the drop: a dragged text has no clock
of its own, so none goes to the meeting door, and the calendar is not
asked.

## Dropping on a meeting

The Meetings section also takes unscheduled meetings. Its heading and the
blank space below the rows, before Chats, light the whole section blue.
The space is padding inside Meetings, with no separate box or label, so
a drop there belongs to Meetings. The area remains
available while the calendar loads, when there are no meetings, or when
the calendar cannot be read. A drop selects Meeting, keeps the viewed
day, and takes only the clock time from the file's proposal. That time
stays editable in the shared dialog. Start states only the selected day
(`dayStated`), so the file cannot move it to another day. The recording's
clock remains a proposal: the meeting time described in the memo wins.
Editing the clock time or dropping on an individual calendar slot states
the full date and time.

The day's Details rail accepts a transcript or recording on a timed past
meeting marked `no record`. The row turns blue and says `drop to import`;
leaving it or dropping clears the highlight. It owns the drop, so the
section highlight and page overlay stay out of the way and the file
enters the queue once. Moving back to the section restores its highlight.

Each queued file carries the selected slot's title and full date/time.
The shared dialog opens with Meeting selected and that time filled in,
even if the audio listener later guesses a journal. Start follows the
usual `meeting:new` flow. Other file kinds keep their normal import door.

A slot chosen by dropping is an explicit time: `whenStated` carries that
fact through Start even when it equals the file's proposed time. The
pipeline keeps it over times mentioned in the recording. A stopped
import retains those fields when opened again.

Narrative: [2026-09-05 — a file dropped on its meeting](2026-09-05-a-file-dropped-on-its-meeting.md).
The section target is described in [2026-09-05 — an unscheduled meeting belongs to a day](2026-09-05-an-unscheduled-meeting-belongs-to-a-day.md).
