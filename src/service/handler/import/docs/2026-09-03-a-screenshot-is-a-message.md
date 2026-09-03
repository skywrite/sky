---
created: 2026-09-03
updated: 2026-09-03
---

# 2026-09-03 — A screenshot is a message

A screenshot of a conversation dropped on the day got "Sky cannot take this
file. Sky doesn't take .png files." The terminal had taken screenshots for
months: `message:new --from-image` reads the dialogue off one or more of
them with a vision model, asks for corrections, and files a message under
the day. The web had no door for it.

## What was wrong

Two things, one visible and one not.

- `readback.ts` knew three sources — transcript, text, audio — and refused
  every other extension by name. That is the sentence in the dialog.
- `message:new` asked its questions through clack directly: the platform
  select, the corrections line, "Move screenshot to attachments?". Run
  inside the service there is no terminal on the other end; the command
  would have sat on the service's stdin at its first question. The audio
  path of the same command had the same two prompts, so the message door
  the dialog already offered for a voice memo would have stopped there too.

## What the fix is

- A fourth source, `image`: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, and
  `.heic`/`.heif`, which the door converts before the model sees them. The
  read-back says "Screenshot · 1170 × 2532" from the file's header
  (`lib/media/image`), instantly and without a decoder, and offers one kind:
  a message. A file over the model's 10 MB of base64 — 7.5 MB of file — is
  refused before it uploads, the way an oversize recording is.
- The start runs `message:new --from-image <staged file>`. The When left
  as proposed is the screenshot's own time, the moment the model resolves
  "Today" and "5 min ago" against; a visible timestamp wins over it, and a
  When the person changed wins over both, as a stated argument.
- `message:new` asks through `context.prompt` — the terminal answers with
  clack as before, the page with its forms — and reports its steps:
  Reading the screenshot · Checking it with you · Filing. At the check it
  writes the conversation it read as streamed text, so the page shows it
  above the fields the way it shows a meeting's write-up. The move into
  the day's attachments is a question on the terminal and a given on the
  server: an upload is sky's staging copy, and nothing else keeps it.
- The command returns the absolute path of what it filed. The day a
  message goes under is the conversation's — often yesterday's, from the
  screenshot's date separator — not the day it was dropped on, and the
  host cannot know which without being told.

## What was left

- One screenshot is one import. The terminal takes several at once and
  reconstructs one conversation across them; a drop of several files
  becomes several imports here. A job with several files is the next rung.
- `notes:new --from-image` is the other door a screenshot could go through
  — a whiteboard, a page, a slide. It still asks through clack directly and
  is not offered by the dialog.
- The calendar is not consulted for a screenshot. A conversation is not a
  meeting.
