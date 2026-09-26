---
created: 2026-09-26
updated: 2026-09-26
---

# A rename reaches the files that name them

A person corrects a contact's name on the People page: `Jane Doh` was a
misspelling for months, and the profile now says `Jane Doe`.
The profile keeps `Jane Doh` as another name, so nothing breaks.
But every meeting, message and note that named her still says `Jane Doh`,
and new captures kept writing it.

Two things kept the old spelling alive.
Auto-linking took a person's name from the profile's file name.
And the people list the model reads showed her twice, once per spelling.

## What it does

New files use the current name.
Auto-linking now writes the first name a profile lists, and matches any name it
lists, whatever the file is called.
The model's people list shows each person once, under that first name.
It matches an organization's `alt` names too.

Old files can be updated from the profile.
When other files still use another spelling, the page says so under the name:
"Also written Jane Doh in 3 files."
Update previews every file by kind, with each change, before anything is written.
Changing the name in the editor opens the same preview for the name it replaced.

It works like a rename in an IDE:
- Names change only in frontmatter references: `rel`, `who`, `from`, `to`, `cc`,
  `org`, and a person's `orgs` for an organization.
- A name is matched by the profile it resolves to, not by text.
  A namesake, a bare first name, or a link to a file whose name holds the
  spelling stays as it is.
- The profile's file takes the new name, as `person:new` names files.
  It moves last, so an update stopped partway can simply run again.
- Every place a file writes out the old path in full follows the file:
  the context records chats and summaries keep, and links.
  A plain find-and-replace of the whole path, not a parse of each format,
  so it keeps working as those formats change.
  The path must start and end whole: `Jane-Doh-2.md` and `archive/people/…` stay.
- Only those characters change. Quotes, lists, comments and the rest of each
  file stay byte for byte. What the files say is never edited.
- A file changed after the preview is left alone and listed, and so is a value
  that cannot be edited exactly.
- When only the file name is behind, the profile's details offer the rename.
