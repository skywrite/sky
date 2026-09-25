---
created: 2026-09-23
updated: 2026-09-23
---

# A chat returns to its day

The person opens a chat from an earlier day — continued from its file on
that day's page, or a thread left open since then — and works in it for a
while. They press Save & close. The page turns to today.

That is the wrong day. The chat belongs to the day it started; its file
lives under that day, and that is the page the person came from. Landing
on today means finding the way back by hand, and the "Chat saved" notice
shows up on a day the chat has nothing to do with.

## What it does

The thread carries its day. The service already stamped every live thread
with the day it started — the list uses it to file live chats under their
day — but the thread's own read-back left it out, so the page had nothing
to go on. Now `GET /chat/:id` carries `day`, and the page keeps it with the
rest of the thread's state.

Ending a thread goes to that day. Today's chats still land on `/`; a chat
from another day lands on `/<day>`, where the day's record refreshes with
the saved file and the notice shows. The header's back button goes to the
same place and names the day — "‹ Tue, Sep 22" — so the destination is
visible before the press.

A chat whose day is not known yet, or is today, goes to today. That is
what happened before, so nothing changes for a new chat.

## What it does not do

A branch made from an earlier day's chat is stamped with the day it was
made, though its file lands beside its parent under the earlier day. It
still returns to today. Returning it to the parent's day means stamping a
branch with its parent's day on the service, which is its own change.

A temporary help chat opened from an item on an earlier day's page is also
stamped with the day it was made. Returning it to that page means the
shell remembering where the chat was opened from, which is another change.
