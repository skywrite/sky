---
created: 2026-09-26
updated: 2026-09-30
---

# Extensions

An extension is a folder that adds to Sky: commands, screens, settings.
Version 1 is built: an extension runs inside Sky and can do whatever it
wants, because its author is its only user. The format evolves once other
people use these things. How it works is in
[lib/extensions/docs](../../../src/lib/extensions/docs/README.md).

The manifest is the folder's package.json, with Sky's few fields in a
`sky` block. Identity is `author/slug`. The first extension is HubSpot.

Extensions live in one public repository,
[skywrite/extensions](https://github.com/skywrite/extensions), one folder
per extension under `extensions/<author>/<slug>/`, grouped by its author's
GitHub handle: `extensions/skywrite/hubspot` is the first. A folder is
installed from a local checkout with
`sky extensions:add <folder>`; installing by name from the repository
comes later. An extension names Sky's packages as peer dependencies and
installs nothing of Sky's: the host links them in.

## Notes

- [2026-09-26 — Security, sandboxing, networking and permissions, later](2026-09-26-security-sandboxing-and-permissions-later.md) —
  what was considered and set aside, with the sandbox rules measured on
  macOS, for the day a second author appears.
