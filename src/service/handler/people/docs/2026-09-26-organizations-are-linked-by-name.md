---
created: 2026-09-26
updated: 2026-09-26
---

# Organizations are linked by name

Saving a person on the People page wrote a second list beside `orgs`:

```yaml
orgs:
  current:
    - Atlas
org_refs:
  current:
    - name: Atlas
      path: orgs/tech/software/Atlas.md
```

`org_refs` repeated every organization with its file's path.
It existed for one case: two organizations with the same name,
where the name alone could not say which one a person worked at.

That case is rare, and it cost every person file a block of machine data.
It also put file paths in frontmatter, which break when a file moves.
Every other reference in the notebook is a name.

## What it does

`org_refs` is gone: the page neither writes nor reads it.
A person's organizations are the names in `orgs.current` and `orgs.past`.
A name says which organization it means because two organizations never share
one (`2026-09-26-two-organizations-never-share-a-name.md`).
Inside Sky, each name still resolves to its organization's record,
for links and an organization's people.

Saving a person rewrites `orgs` only when its names change.
An `org_refs` block written earlier stays until someone removes it;
nothing reads it.

People may still share a name. They are linked by name too, and the
interaction score decides which one a bare name means.
