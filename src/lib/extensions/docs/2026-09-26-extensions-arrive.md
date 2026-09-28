---
created: 2026-09-26
updated: 2026-09-26
---

# Extensions arrive, with HubSpot as the first

The ask was a HubSpot integration that fetches and uploads contacts and
companies, sends a meeting's notes to its deal, and has settings, with
screens where those things belong. HubSpot is too narrow for the core, so
it became the first extension, and the extension host was built to the
size HubSpot needed and no larger.

## What was built

- `lib/extensions/`: the manifest check, the installed-extension listing,
  add and remove, and the shared-package links.
- `commands/all/extensions/`: `add`, `list`, `remove`.
- The command manifest walks installed extensions, prefixing by slug.
- `service/handler/extensions/`: the list route and the run route.
- The client: `extensions.tsx` places screens on profile pages, in the
  explorer's file header, and under Settings › Extensions.
- The bundle build includes extension screens and falls back without them.

The HubSpot extension itself lives outside this repository, in a folder of
its own, installed with `extensions:add`.

## What went wrong on the way

The first build resolved an extension's React and Mantine imports with a
resolve hook calling Bun's runtime resolver. The bundle compiled, then
failed in the browser on a missing helper, and the web app stopped
rendering. Removing the hook made the build throw instead: `Bun.build`
throws on failure rather than returning `success: false`, so the fallback
that was meant to drop the extensions never ran, and the bundle was not
served. Both were fixed the same afternoon. The build now catches the
throw and rebuilds without extensions, and React and Mantine reach an
extension through links in its own `node_modules`, so the bundler resolves
them natively. A copy count in the bundle matched the build without
extensions exactly.

## The day after

A review on 2026-09-27 found the contract types copied into the extension,
no sidebar page, no switch and no Reload on the Extensions page, no timeout
on a screen's command, and writes going straight to disk. All five were
built the same morning: the contract is published as
`@skywrite/core/extensions`, an extension may export a `Page` with a `nav`
entry, the page has switches and Reload backed by a `.disabled` marker and
two commands, a run is bounded to two minutes, and writes go through the
service's versioned save with the people index for name lookups. The
review also found the extension's own type-check had never really run: its
tsconfig lacked the settings Sky's has, so every error was configuration
noise. With the config mirrored, four real errors surfaced and were fixed.

## Verified

- Unit: `bun test lib/extensions service/handler/extensions commands/all/cli`.
- Live: `extensions:add` on the HubSpot folder registered its commands;
  the list and run routes answered; a command outside an installed
  extension's prefix was refused with a 404.
- Browser, with every write blocked: the profile card, the file action and
  its preview, the Extensions list, and the HubSpot settings page rendered
  with no page errors. On the 27th: the sidebar entry and the extension's
  page, the switches; switching off through the route dropped the
  extension's commands from the manifest and the run route, switching on
  brought them back.
