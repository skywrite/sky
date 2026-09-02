# 2026-09-02 · Keep a file with the day

**Ask.** Drag a file onto the day and, instead of importing it, move it into
the day's attachments directory.

**The path question.** The first draft said the browser copies, because a
drop never hands over the file's location. That was one step short: the
service is local, so it can find the original itself. A probe page settled
what a drop actually carries in Chrome 152 on macOS: drag types `Files`
only, a File with name, size, type and modified time, an entry whose
"path" is a virtual slash-and-name in an isolated sandbox, and no
file-system-handle API at all. From those three facts the service found the
dropped file on the Desktop in one shot, size equal and modified time equal
to the millisecond, and Spotlight agreed with a single hit.

**Shape.** One drop, one dialog, one more answer to "What is it?": *Just a
file*. A file no door takes opens the Keep form directly. The form says
which of two things will happen before the button, so a move is never a
surprise. The directory is the record, the same as the desktop sweep;
nothing goes into the day file. Undo lives in the toast for eight seconds;
Remove goes to the Trash.

**Edges designed for.** A Finder duplicate keeps the original's modified
time, so two identical files can both match; the service prefers the Desktop
and Downloads and asks when both hold one. A file dropped from Mail or
another tab has no original on disk and is kept as a copy, with the upload
progress shown. A file already among the day's files says so and offers
nothing to move. A name gets the day's prefix unless it already carries a
date, the way the desktop renamer does it.

**Verified live** on a scratch notebook with a second service: the paperclip
and the page-wide drop both moved a synthetic PDF out of Downloads and Undo
put it back; a drop on the Files block kept a copy; a notetaker `.txt`
offered *Just a file* and its import job was removed afterwards; Remove
emptied the day of the copy; the phone sheet sits at the bottom, sized to
the form, with focus on Keep rather than the keyboard.

**Then the pad.** JP dropped a 423 MB Zoom recording on his real day page.
`.mp4` counted as a recording, so the page uploaded all of it to the import
route first, the read-back refused it over the transcription cap, and the
Keep form appeared under a sentence about trimming voice memos. Two changes
came out of that. Recordings over the cap, and videos, never go to the
import upload: they open Keep directly, in a quarter of a second. And the
day got what was asked for in the first place: a **Files** button that opens
a drop pad, where a dropped file simply moves in, no questions, with Undo in
the toast. The dialog flows stay for everything dropped elsewhere.

Verified live on the scratch service: the pad moved a Downloads PDF in with
no dialog and Undo put it back; two files at once became "Moved 1 file to
today, kept 1 copy"; a transcript dropped beside the pad still opened "New
meeting from a text file"; a 30 MB video dropped beside the pad opened Keep
in 263 ms without an upload; dragging over the page opened the panel.

**Ruled, later the same day.** A `.vtt` the read-back had refused came up
as the Keep form, and JP overruled the fallback: a file dragged onto the
day is an import, the flow the day had before, and the Files pad was made
for keeping. So the drop is one thing and the pad is the other. The import
queue takes every dropped file to the import dialog; a refusal there is a
refusal with Remove, never a Keep form. *Just a file* left the kind row,
the Keep form left the dialog, and the paperclip on the phone is the
import's picker again. One keep-side lesson stayed with the import: a
recording over the transcription cap is refused before its bytes go up, in
the read-back's sentence, so a Zoom video never uploads just to be told no.
What is left for the phone, where the pad is not shown, is a rung: a Files
button that keeps from the picker.
