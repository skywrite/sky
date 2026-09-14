---
created: 2026-09-13
updated: 2026-09-13
---

# Discard what was never sent

A plan item's "Get Sky's help" opened a temporary chat and sent the request
at once. Nothing on the page could be changed first. Every help chat ran on
the thread's default model. The person asked for the request to wait in the
composer instead.

Now the button opens the temporary chat with the request drafted, and stops.
The model picker, the reading budget, and the Temporary switch all apply
before the first message. The person tunes the thread, edits the request,
and sends. Sending is the person's action, as it is for "Discuss with Sky"
on the tracking page and for chats started from a selection.

That left a thread with nothing sent and no way to end it. The end button
appeared only once a turn existed. The service's end route knew only started
threads. An abandoned help chat left its draft in browser storage under an id
nobody would open again, and its temporary setting in the service's memory
until the next restart.

The rule now: the end button shows whenever the thread holds anything, a
turn or a draft in the composer. With nothing sent there is nothing to save,
so it reads Discard whatever the filing choice. Once a turn exists it reads
Save & close or Discard by that choice, as before.

Discard means: this thread id is done, forget it and everything attached.
On the page that is the draft, text and attachments. In the service that is
the tuning chosen before the first message, or the thread itself. The end
route answers `ended` with the ids it let go, the thread and its reply
threads, and the page clears each one's draft. An id the service never held
still answers 404. For a thread the page knows never started, that reads as
nothing to end, and the draft goes.
