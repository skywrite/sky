---
created: 2026-10-20
updated: 2026-10-20
---

# Beeper pages iMessage only forward

**What was wrong.** A voice note the owner sent in an iMessage chat the door
already tracked never arrived, run after run, while the same runs picked up
WhatsApp and Signal messages. The chat's state held the newest sortKey from
first contact as its cursor, and the incremental walk asked Beeper for the
messages `after` it.

**Root cause.** Beeper Desktop's iMessage bridge (`local-imessage`, provider
`platform-sdk`) does not honor cursors the way the other bridges do. Measured
2026-10-20 against three networks on one Mac:

- First page, everywhere: newest-first, 20 messages, `limit` ignored, and the
  page's cursors are its max and min sortKey.
- WhatsApp and Signal: `after newestCursor` answers nothing, which is right;
  `before oldestCursor` answers the older page.
- iMessage: `before oldestCursor` answers no items at all, and `after` any
  cursor from a newest-first page answers the chat's history from its very
  beginning, ascending, 21 a page. A cursor Beeper cannot place, an id or a
  timestamp, is ignored and the first page comes back.

So the incremental walk started a year back, paged forward 21 at a time, and
hit the 500-message cap long before today. First contact fared better only
by accident: the newest page, then a `before` page that came back empty.

**Fix.** The walk never asks for `after`. Every run reads the newest page and
pages `before` only while a page is still entirely newer than the floor: the
window's boundary on first contact, else an hour before the newest message
the chat has shown, kept in its state as `newest` in place of the cursor. The
ids already seen keep a message from landing twice. When Beeper refuses the
older page the window still needs, the run says so in a note, so a busy
iMessage chat's first contact names what it could not reach. The heartbeat
runs the sync every minute: it was every five, and the tick counter restarts
with the service, so on an edit-heavy day the fifth tick rarely came.

**Rejected.** Walking iMessage forward from the start of history each run:
thousands of messages for an old chat, and the cap before today. Reading
iMessage from the Mac's own database instead of Beeper: the names already
come from it, but message bodies there are typedstream blobs and the door
would carry two readers; kept for the day the bridge's limits bite harder.
