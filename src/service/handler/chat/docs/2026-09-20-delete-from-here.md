---
created: 2026-09-20
updated: 2026-09-20
---

# Delete from here

A chat goes wrong at some turn. A bad answer, a wrong path, a question the
person wishes they had not asked. Branching fixes what the model sees next,
but the wrong turns stay in the thread. They save into the notebook with
it, and are searched and distilled later like everything else.

The person asked for the other half: go to the question, delete from here,
and keep nothing of that turn or what followed.

## What it does

Every question carries the same options menu a reply has. It sits at the
foot of the bubble, so on a phone it opens below the words rather than over
them. It holds one item, "Delete from here…".

Choosing it opens a confirm under the question. No dialog. The confirm says
how many questions and replies go. Everything that would go is drawn faint
while it is open, so "from here" is something the person can see. Escape
answers no from anywhere on the page. The Delete button never takes the
focus: a closing menu hands the focus back to its own button, and a repeated
Enter must not delete.

On Delete the thread is kept through the reply before that question. What
follows leaves the session: the turns, the context log entries, the model's
own history with its tool results, the tool runs, the answered cards, the
usage and timings. The document universe is the one the kept entries leave.
The recovery snapshot is rewritten at once, so the removed text is off the
disk, not waiting for the next turn.

The question's text goes back into the composer, unsent. Most deletes are
"let me ask that differently". If something is already typed there, the
question joins it after a blank line. Nothing typed is ever replaced. A
quiet line under the last turn says what happened and leaves with the next
message.

## How the thread is cut

`POST /chat/:id/unwind` takes `{ turn, key }`: keep the thread through reply
`turn`. The key is the one branching uses. It names the conversation through
that reply, so a page showing an older conversation is refused rather than
obeyed. The page never counts turns itself. It walks back from the chosen
question to the last reply the service issued a reference for. A reply the
page alone is showing, such as one a restart interrupted, is never a place
to cut.

The session is not edited in place. `threadSeedAt(turn)` already derives the
thread as it stood through a reply, for reply threads and branches. The cut
opens that state as a new session under the same id and start time. That is
the path a restart takes for every thread, many times a day. The snapshot
path depends on the id and the start time, so the new session's first
snapshot replaces the old file.

`turn: 0` keeps nothing. A thread with no messages writes no snapshot, so
the old one is removed, the thread leaves the list, and the id holds only
its tuning again. That is the state of a chat before its first message, and
the page's next send starts a new conversation there. A thread that had a
draft linked before its first message is rebuilt empty instead, link kept.

## What cannot be deleted

Turns already in the thread's notebook file. The write-back gate refuses any
save whose conversation shrank, and that guard is not loosened here. A saved
chat opened to continue can still lose the turns added since.

Turns a branch inherited. They belong to the chat it left.

Turns that a branch or reply thread still open was made from. A branch's
file holds only its own turns and the turn it left after. Cut the parent
below that turn and the branch saves without its opening. So the delete is
refused, and the answer names what is open. The page checks the same thing
before it asks, from the marks it already shows, so the person sees the
refusal instead of a confirm that cannot succeed.

The refusal says to discard the open branch, not to close it. Saving a
branch files its parent first, and those turns are then in a file and cannot
be deleted at all.

The read-back's `fixed` is the count of messages at the head of the thread
that the first two rules cover. The page offers no delete on them.

## What stays

What a tool already did stays done. A posted message stays posted. A delete
takes only the record of it from this thread. The confirm names each
approved call among the turns that go, in amber, before the person answers.

Files clipped into a deleted question stay in the day's attachments, and a
writing draft saved from a deleted reply stays a file of its own. Both are
the person's artifacts, not chat history.

The token usage log keeps its counts. The spend happened.

One limit: a turn that failed wrote its question to the AI error log, and a
delete does not reach into that log.

There is no undo. A copy kept for undoing would be the history the person
asked not to keep.

The terminal chat has no delete. It has no branching either.
