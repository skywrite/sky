---
created: 2026-10-08
updated: 2026-10-08
---

# One go stands for every chat

A go on a Google doc used to live inside the chat it was given in, and a
plain "Allow" covered one call. Several chats on one doc, over a week,
asked every time: each new chat started with no grants, the per-file
button was the quiet second choice, and an edit a tool reported did not
count as a grant even after the person had just allowed it. The design
counted each chat and each click separately; the person counted the doc.

## What changed

- **A go is about the file, not the chat or the tool.** The grants left
  the chat file for one ledger under the user data dir,
  `state/ai/file-grants.json`: a JSON map, file id → when, how (`allowed`
  or `created`), where from, and what the tool reported the file to be
  (`commands/lib/chat/fileGrants.ts`). Both hosts read it through
  `SessionBlessings`; the approval policy consults it on every miss, so a
  grant from a terminal chat covers the web thread that starts next.
  Per-tool scoping (`tool:fileId`) is gone: the key is the file id.
- **Any Allow on a file-scoped card is the standing grant.** The card no
  longer offers "Allow for this file" and the terminal no longer offers
  "don't ask again"; the one go does that. "Not now" stays the per-call
  refusal, and a refusal is never recorded.
- **A file a tool created is granted at birth**, as before, but for every
  chat. A file a tool edited lends its title, kind and link to the grant
  the go already made, so the ledger reads as a list of documents, not of
  ids.
- **The chat file no longer carries `approvals:`.** The ledger is the only
  source of truth for the gate. Old chats keep the key they have; nothing
  reads it, and a restored or branched thread seeds nothing from it — a
  grant revoked in the ledger must stay revoked.
- **A paste is still permission for now.** A pasted file reference blesses
  the file for the process, as before, and is not written down.

## The file

- Written whole under a process lock with an atomic rename; the lock lives
  under the system temp dir because the ledger itself may sync between
  machines. A read re-checks the file's stamp (inode, mtime, size), so a
  write by another process is seen without a watcher.
- Pretty-printed, newest first. Deleting a key revokes the grant; a key is
  a grant whatever its value holds, so a hand-edited entry keeps its
  standing. A file that is not JSON grants nothing and is never
  overwritten: the next go reports it by path instead.
- Seeded once from history when it landed: every saved chat's `approvals:`
  keys, and every file a Google doc record says the agent created.

## Rejected

- **Deriving the set from saved chats through the service index.** A
  temporary or unsaved chat never contributes — the thread that prompted
  this was never saved — and the gate would depend on the index being up,
  from both hosts.
- **An append-only log.** The state is a set; a revoke would be a
  tombstone or a hunt through lines; the folder's neighbours
  (`automations.json`, `token-ratios.json`) are key-value files rewritten
  whole, and the lock-and-rename helper already existed.

## Verified

- `commands/lib/chat/fileGrants_test.ts` — a grant is seen by another
  handle without a restart; the first grant is the record and later ones
  fill its blanks; the file reads newest first and a deleted key revokes;
  a broken file grants nothing and is never overwritten.
- `commands/all/ai/chat/lib/approvals_test.ts` — a grant reaches the
  ledger for every chat, a mention stays in the process, a refused grant
  still stands for the process.
- `commands/lib/chat/notebookTools_test.ts` — the policy awaits an
  asynchronous ledger check.
