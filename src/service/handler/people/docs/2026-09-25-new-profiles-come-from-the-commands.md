---
created: 2026-09-25
updated: 2026-09-25
---

# New profiles come from the commands

A person saves a new contact and a new organization from the People page.
Neither file looks like the rest of the notebook.

The person's file is named after the moment it was made:
`people/2026/2026-02-12_093400_Jane-Doe.md`.
Every other person lives at `people/2026/ja/Jane-Doe.md`.
Its frontmatter carries `orgs` and `org_refs` holding empty lists, `[]`,
though there are no organizations.

The organization is worse.
It sits in `orgs/2026/`, not under a sector and subcategory.
It has no overview, no kind tag and no Wikipedia link.
Its website is written twice, as `site` and as `sites`.

The page had its own copy of creation.
`person:new` and `org:new` already knew how to make these files.
The page did not use them.

## What it does

The commands' creation moved into shared modules, and the page calls them.

- A person: `newPersonMarkdown` writes `person:new`'s fields, blank until known,
  under the name heading and a Background section.
  The folder is the year and the first two letters of the first name.
- An organization: `draftOrganization` reads the website and Wikipedia and asks a
  model for the category, kind and overview, as `org:new` does.
  `organizationDocument` writes the file `org:new` writes.
- `createNumberedFile` names a namesake `-2`, `-3`, and never overwrites.
- A list with nothing in it is left out.
  Clearing a person's last organization removes `orgs` and `org_refs`.
- One website is `site`; several are `sites`.
  The page swaps one for the other in place.
- An edit keeps the blank line after the frontmatter.
  The page used to drop it.
- A year alone is written `met: 2021`, as people files write it, not quoted.

## What it costs

Creating an organization takes a few seconds.
A headless browser reads the website, Wikipedia is searched, and a model answers.
A person save that names a new organization waits for that.
If the lookup fails, the save is refused with the reason.
Organizations already made stay, and a retry reuses them.

Tests stand in for the lookup, so they never reach the network or a model.
