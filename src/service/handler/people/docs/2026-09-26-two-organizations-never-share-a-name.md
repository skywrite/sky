---
created: 2026-09-26
updated: 2026-09-26
---

# Two organizations never share a name

Other files name an organization by name alone:
a person's `orgs`, a meeting's `who`, a note's `rel`.
So a name has to say which organization it means.

The People page allowed a second organization with an existing name,
behind a checkbox, and offered "Create a separate organization" for an
imported company whose name was taken.
`org:new` refused a same-named file, but `--force` created it anyway,
and it compared file names, not the names organizations go by.

## What it does

Two organizations never share a name.
Names are compared as their file names would be: case, spacing and punctuation
aside, so "Atlas Inc" and "Atlas, Inc." are one name.
Alternate names (`alt:`) count.

- The People page refuses a clash when an organization is created, renamed,
  or given an alternate name.
  The same-name checkbox and the separate-organization choice are gone.
- `org:new` refuses it too, with no override.
  `--force` is gone, and a file of that name for another organization gets
  `-2`; nothing is overwritten.
- A person who writes an organization's name another way is linked to it.
- Where two organizations already share a name, a person is linked to neither
  until one of them gets a name of its own.
- An organization's alternate names resolve, as a person's other names do.
