---
created: 2026-09-08
updated: 2026-09-08
---

# Saved chat titles open their documents

Both day chat lists sent every title to the conversation page, including
saved markdown transcripts. The conversation's saved label did not link to
the document either. Logging a chat to `day.md` did not provide another
route in the web day: capture entries are filtered out of Done today.

Saved titles now open their notebook documents in Explorer, where their
properties, relationships, and backlinks are available. Continue chat is
a separate action in both lists. The conversation header also links to its
saved document. These are ordinary encoded document links, supporting
copying the address and opening another tab.

The shared day hierarchy retains each row's document path separately from
the target used to continue its conversation. This matters when a live
continuation replaces a saved row: its title still opens the document,
while Continue chat reuses the active thread. Unsaved chats keep opening
their conversations without offering a document that does not exist.

Verification covers saved branches, a live continuation, and an unsaved
branch in the hierarchy tests. The browser check exercises both day lists,
document navigation, Continue chat, the header link, filenames with spaces
and brackets, and the phone layout against a temporary notebook.
