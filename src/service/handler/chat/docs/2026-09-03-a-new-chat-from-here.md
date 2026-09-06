---
created: 2026-09-03
updated: 2026-09-03
---

# A new chat from here

A morning's chat began as "I need help with the week" and went down the
finances. The other items needed the same opening and a different road.
That is a branch: a chat that keeps the first N turns of another and goes
its own way after them. Both keep going.

## What a branch is, in the files

The branch's file holds only what comes after the shared turns, and a
`parent:` key naming the chat it left and the turn it left after. The
shared turns live once, in the parent's file. The branch files in a
folder beside its parent carrying the parent's name —
`09-12_Help-with-the-week.md` keeps its branches in
`09-12_Help-with-the-week/` — and a branch of a branch files flat in the
same folder; the key says who is whose. The parent's file is never
touched and never moves: its branches are whatever points at it.

A branch loads as the whole thread it is. The store reads the parent's
file (and its parent's, up the lineage), takes the prefix through the
branch point, and joins the branch's own turns and log entries to it. The
session shows all of it and the model reads all of it; when the branch
saves, the inherited turns are left out again. A crash snapshot is the one
place a branch is written whole, parent turns included: a parent may not
have a file yet when the snapshot is taken, and insurance must not depend
on one. The parent key beside them says how many turns are inherited.

## What branching writes: nothing

Branching makes a thread and pins a name. The name is the family's — the
titler over the shared turns, or the name the thread already carries —
pinned on the thread the branch left, so the parent's filename, which is
the branch folder's name, is known before either saves. The parent keeps
that name when it does save.

The parent must be a file by the time a branch saves, and only then. When
a branch is ended, a parent that has no file yet is filed first, lightly:
the pinned title, no tag, rel or memory work. The parent's session then
writes back to that file like a resumed chat, so it goes on talking and
its own ending appends. Discarding a parent after that leaves its file as
it stood.

## Around it

- A saved chat opens as a thread to continue, from the rail's Chats
  section, writing back to its file — the door for branching a morning's
  chat in the afternoon.
- A branch's own retrieval keeps its whole lineage out, the way a resumed
  chat kept its own file out; and a branch a search brings into another
  chat's context brings its parents in with it, so the turns it stands on
  come too.
- Over GraphQL a chat carries `parent`, `inherited`, `branches` and
  `thread`, the whole conversation assembled.
- The terminal reads branches — the resume picker lists them under their
  day with the turn they left from, and resuming one loads the whole
  thread — but does not make them.
- Words: branch, parent, branches. The action is "New chat from here…", at the right end of the reply's details row, level with "Reply details".

## Verified

- 2026-09-03 — a prefix at a turn keeps the turns and log through it; a
  branch joined to its prefix is the whole thread and splits back
  (lineage tests). The store lists a branch from the folder beside its
  parent with its key, loads it whole with the parent among its
  ancestors, alone without a root, and by the key's count as a snapshot;
  a branch saves beside its parent holding only its own turns; a pinned
  title names the file; a resumed branch writes back own turns only
  (store tests). A session branched at turn 1 shows the inherited turns,
  files its own beside the parent; a session filed mid-life writes its
  ending back to the same file (session tests). The route makes a branch
  with the turns inherited and marked, lists it under its live parent,
  pins the parent's name, and on ending files the parent first and the
  branch beside it; a saved chat opens as one thread, found again the
  second time (route tests). A branch over GraphQL carries its parent and
  count, its parent lists it, and its thread reads whole (resolver test).
