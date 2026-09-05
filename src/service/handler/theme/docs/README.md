---
created: 2026-09-03
updated: 2026-09-05
---

# The web app's shell and client

Notes for `src/service/handler/theme/`. This is the code that serves the
web app's page and builds its client.

## What lives here

- `mod.ts` holds two things. `renderAppHtml` is the one HTML shell every
  page shares: a root element, the bundled script and stylesheet, and the
  18px base size the theme is drawn at. `getThemeAsset` bundles
  `client/main.tsx` with Bun on the first request and keeps the result in
  memory. No build step, no artifacts.
- The client sources are build entrypoints, not imports. The service's
  `--watch` never sees them change. Their mtimes are checked on each asset
  request instead, and the bundle rebuilds when one is newer. Editing the
  client and reloading the page is enough.
- `client/` is the React client. `main.tsx` turns the path into a page: a
  day, a thread, an import, a document in the explorer, settings, voice,
  automations, a week. `theme.ts` is the Mantine theme. `shell.css` is the layout.
- `http.ts`, one level up, mounts the shell at `/`, at a day's date, and at
  the page paths. `/_assets/:name` serves the bundle.

## Typography

Today and Explorer share `--sky-content-font-size`: 19px on desktop, 18px
at the existing 900px narrow layout. Reminders are one pixel smaller.
Document prose, headings, and table headings inherit the app's system
sans-serif family in both reading and editing. Code and markdown syntax
retain their monospace font.

The shell's 18px UI base stays separate so navigation, buttons, metadata,
and the user's appearance setting keep their existing scale. Explorer's
text-size control multiplies the content size and keeps its saved preference.

## There is no reference page

The app is its own reference. A `/theme` page once held the concept mock
the theme was drawn from, with sample days, horizons and topics. It fell
behind the app it was meant to guide and was retired on 2026-09-03. See
`2026-09-03-the-reference-page-retires.md`.
