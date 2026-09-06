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
  automations, a week. `theme.ts` is the Mantine theme. `shell.css` imports
  the shared foundations and feature styles.
- `http.ts`, one level up, mounts the shell at `/`, at a day's date, and at
  the page paths. `/_assets/:name` serves the bundle.

## Stylesheet ownership

`client/shell.css` is the CSS entrypoint imported by `main.tsx`, after
Mantine's styles. It contains an explicit, ordered list of imports. Bun
bundles these into the existing `/_assets/main.css`; the browser still
loads one stylesheet.

Keep changes with the feature they affect, including its responsive rules:

| File in `client/` | Owns |
| --- | --- |
| `tokens.css` | Shared colors, syntax colors, content sizes, dark and narrow overrides |
| `layout.css` | App frame, sidebar, navigation, headers, columns, mobile drawer |
| `components.css` | Shared cards, section labels, counters, chips, activity rows, disclosure links |
| `chat.css` | Conversation turns, replies, branch actions |
| `composer.css` | Message input, composer controls, reading budget |
| `chat-tools.css` | Tool activity, output, usage, approval prompts |
| `context.css` | Chat context panel, files in context, turn timeline |
| `explorer.css` | File tree, directory listings, breadcrumbs |
| `document.css` | Reader/editor typography, markdown blocks, code highlighting |
| `editor.css` | Editing status, visible markdown syntax, editable blocks, table tools |
| `frontmatter.css` | Properties, completion, YAML, identity, property overrides in Details |
| `details.css` | Shared Details rail, attachments, backlinks, document outline |
| `day.css` | Today tasks, reminders, streaks, record, swipe deletion, undo |
| `day-rail.css` | Today's meetings, chats, work in progress, attachment footer |
| `week.css` | Week days, priorities, goals, check-ins, scheduling controls |

`automations.css`, `clock.css`, `import.css`, `settings.css`, and `voice.css`
remain imported by their existing components and join the same bundle.

Shared foundations load before feature styles. Keep the import order
explicit and check overlapping selectors when changing it. Properties in
the Details rail live with their base property rules in `frontmatter.css`;
reader and editor prose share `document.css`. Avoid adding another copy
of shared rules to make a local change.

## Typography

Today and Explorer share `--sky-content-font-size`: 19px on desktop, 18px
at the existing 900px narrow layout. Reminders are one pixel smaller.
Document prose, headings, and table headings inherit the app's system
sans-serif family in both reading and editing. Code and markdown syntax
retain their monospace font.

The sidebar clock also uses the app's sans-serif family, with tabular
digits so changing the time does not shift the digits around.

The shell's 18px UI base stays separate so navigation, buttons, metadata,
and the user's appearance setting keep their existing scale. Explorer's
text-size control multiplies the content size and keeps its saved preference.

## Today's hierarchy

The sidebar keeps Today and Yesterday as relative labels; older days use
full weekday names. Each row shows `MM-DD` in aligned digits, with the
full `YYYY-MM-DD` available on hover and in its semantic `time` element.
The compact display comes directly from the day key, without converting
it through a timezone. Navigation still uses the full date.

Below the day's heading, a muted task count uses the existing Done today
record for completed work and adds open Most important, Commitments, and
To-dos to the total. Reminders and streaks stay separate. The count follows
the saved view after completion, deletion, or Undo, and is hidden when the
day has no tasks.

The header lives inside the day column and shares its 1000px maximum width
and side padding. The date and progress align with the content's left edge;
the rail's chevron, while the rail is folded, sits at its right edge. On
phones, the controls sit above the full date and progress so the menu
button does not push the heading away from the content.

A small page icon right after the date opens the day file. The words "Day
file" stay as its hover hint and accessible name. The note
`2026-09-05-the-day-file-becomes-an-icon.md` tells why the link left the
button row.

The rail has no button. It folds from the chevron in its top-left corner;
folded, the same chevron waits at the header's end, pointing back, and
brings it back. A document's rail folds the same way. The note
`2026-09-05-the-rail-folds-from-its-corner.md` tells why the Details
button went.

Most important is the day's one filled card, including its all-done state.
The plan starts directly below the header, with 24px of top padding on
desktop and 12px on narrow screens, without an extra introductory heading.
The other plan sections and the day record sit directly on the page, with
less padding and subtle dividers between neighboring sections. "The day so
far" introduces the record after the plan.

`day.css` scopes these rules to the day's own blocks. `sky-day-priority`
marks Most important explicitly, so an absent priority list never makes
another section look like the priority. Shared cards elsewhere retain
their existing appearance.

## There is no reference page

The app is its own reference. A `/theme` page once held the concept mock
the theme was drawn from, with sample days, horizons and topics. It fell
behind the app it was meant to guide and was retired on 2026-09-03. See
`2026-09-03-the-reference-page-retires.md`.
