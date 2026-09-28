---
created: 2026-09-26
updated: 2026-09-28
---

# Extensions

An extension is a folder that adds to Sky: commands, screens in the web
app, settings. Version 1 is trusted code: an extension runs inside Sky and
can do whatever Sky can. See `docs/topics/extensions/` for the rulings and
for what was set aside until other people write extensions.

## The folder

```
<extension>/
  package.json     the manifest
  commands/        its commands, named by path under its slug
  lib/             helpers, never commands
  ui/index.tsx     its screens, when it has any
```

The manifest is the folder's `package.json`. The standard fields mean what
npm says: `name` is the slug, plus `version`, `description`, and an `author`
object with `name`, `email` and `url`. Sky's own fields sit in a `sky` block:
the format version `manifest`, the display `name`, and `categories` from a
fixed list whose first entry is the shelf. `manifest.ts` checks all of it
and names the first field that is wrong.

Identity is `author/slug`. The author is the GitHub profile in the author
URL, else the owner of the repository URL, so two authors can each ship an
extension with the same slug.

## Installing

`sky extensions:add <folder>` checks the manifest, links the folder into
`~/.sky/extensions/<author>/<slug>`, runs `bun install` there, links Sky's
own packages — `@skywrite/core` and `@skywrite/commands`, from the
checkout's `packages/` — into the extension's `node_modules`, links React
and Mantine in too when it has screens, and rebuilds the command manifest.
An extension names Sky's packages as optional peer dependencies, so its
install fetches nothing of Sky's; `linkSharedPackages` is the one place
that says what Sky provides. `sky extensions:list` and
`sky extensions:remove` do what they say; remove only unlinks.

Installed means present in that folder. Switched off means an empty
`<slug>.disabled` file beside it: the folder stays, nothing loads from it.
`sky extensions:enable` and `sky extensions:disable` write that marker, as
does the switch on Settings › Extensions. Nothing else records state.

## Commands

The command manifest walks every installed extension's `commands/` folder
beside the configured command dirs, and prefixes each name with the slug:
`commands/contact/fetch.ts` in the hubspot extension is
`hubspot:contact:fetch`. An extension names nothing outside its prefix, so
it cannot shadow a core command. Chat tools, automations and the web all
reach extension commands through that one manifest.

## Screens

`ui/index.tsx` exports any of:

- `ProfileCard` — a card on person and organization pages;
- `FileAction`, with `appliesTo(file)` — a control in a file's header;
- `FileCard`, with the same `appliesTo` — a card in a file's column, which
  a meeting's page shows;
- `Settings` — its page under Settings › Extensions, built from the same
  blocks as the other settings pages;
- `Page`, with `nav: { label }` — a page of its own at
  `/extensions/<author>/<slug>`, behind an entry in the sidebar beside
  People & Orgs and Places.

The contract is `client/extensionContract.ts`, published as
`@skywrite/core/extensions`, so an extension imports the types instead of
redeclaring them. Each screen receives `run`, which runs one of the
extension's own commands through `/extensions/_api/run` and answers with
the command's result and printed lines. A run is given two minutes; the
page is told when one takes longer. A button in a screen is the terminal
command, run as-is.

The screens compile into the web app's bundle at boot
(`service/handler/theme/mod.ts`): the build replaces
`client/extensionsGenerated.ts` with one import per extension. Because the
extension resolves React and Mantine through the links made at install,
there is one copy of each on the page.

Two guards keep an extension from taking the app down. A screen that throws
while rendering is replaced by one line naming its extension. A build that
fails with the extensions is retried without them, so a broken extension
costs only its own screens.

Settings › Extensions lists what is installed, with a switch per extension
and Reload. Both read the folder again, rebuild the command manifest and
end in a fresh page, since the screens live in the page's bundle. A command
file added to an extension's folder is not seen until Reload, or until any
terminal command refreshes the manifest.

## Writing the notebook

An extension writes files the way Sky's own profile writer does: through
the service's document save, published as `@skywrite/core/documents`, which
carries a version and answers a conflict instead of overwriting an edit
that landed meanwhile. The same package exports the people index, the
matching surface Sky's own name resolution uses.

## Notes

- [2026-09-26 — Extensions arrive, with HubSpot as the first](2026-09-26-extensions-arrive.md).
