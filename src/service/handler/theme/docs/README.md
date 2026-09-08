---
created: 2026-09-03
updated: 2026-09-08
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
| `tokens.css` | Shared colors, spacing, dialog and card values, content sizes, dark and narrow overrides |
| `layout.css` | App frame, sidebar, navigation, headers, columns, mobile drawer |
| `components.css` | Shared cards, section labels, counters, chips, activity rows, disclosure links |
| `dialogs.css` | Modal and Drawer surfaces, headers, titles, bodies, action rows, fixed footers, mobile sheets |
| `chat.css` | Conversation turns, replies, branch actions |
| `composer.css` | Message input, composer controls, reading budget |
| `chat-tools.css` | Tool activity, output, usage, approval prompts |
| `context.css` | Chat context panel, files in context, turn timeline |
| `explorer.css` | File tree, directory listings, document headers, breadcrumbs |
| `document.css` | Reader/editor typography, markdown blocks, code highlighting |
| `editor.css` | Editing status, visible markdown syntax, editable blocks, table tools |
| `frontmatter.css` | Properties, completion, YAML, identity, property overrides in Details |
| `details.css` | Shared Details rail, attachments, backlinks, document outline |
| `day.css` | Today tasks, reminders, streaks, record, swipe deletion, undo |
| `day-rail.css` | Today's meetings, chats, work in progress, attachment footer |
| `week.css` | Week days, priorities, goals, check-ins, scheduling controls |

`automations.css`, `clock.css`, `import.css`, `settings.css`, and `voice.css`
remain imported by their existing components and join the same bundle.

Clock place labels and timezone metadata follow the [clock design](../../clock/docs/README.md).
The reusable meeting dialog and its mobile layout follow the
[meeting composer design](../../meetings/docs/README.md).
The shared link picker follows the [record-link design](../../links/docs/README.md).

Shared foundations load before feature styles. Keep the import order
explicit and check overlapping selectors when changing it. Properties in
the Details rail live with their base property rules in `frontmatter.css`;
reader and editor prose share `document.css`. Avoid adding another copy
of shared rules to make a local change.

## Shared UI toolkit

`theme.ts` owns Mantine defaults and action roles. `tokens.css` owns shared
CSS values; `components.css` and `dialogs.css` turn them into reusable
styles. Feature styles own the content and layout particular to that feature.

Use Mantine's `Button` and `ActionIcon` with an action role:

| `variant` | Use |
| --- | --- |
| `primary` | The main action: save, add, submit, continue |
| `secondary` (default) | Cancel, navigation, and supporting actions |
| `primary-quiet` | A primary-colored action with no resting fill |
| `danger` / `danger-quiet` | Destructive actions, or a quiet stop action |
| `warning` | Proceeding with a known issue, such as a scheduling conflict |
| `delivery` | Outbox's deliberate, filled delivery action |

Choose the role at the call site, without a `color` prop. The role owns its
palette and resting/hover appearance in `actionVariants`; it resolves through
Mantine so light/dark colors, disabled states, loading and focus behavior stay
with the existing components. Built-in variants remain available for deliberate
appearance choices, such as the neutral New chat button and canvas tool toggles.

Changing `skyTheme.primaryColor` updates primary buttons, icon buttons, and
custom CSS accents together. Custom controls use `--sky-accent` and
`--sky-accent-soft`, which derive from that same palette. Syntax highlighting
and status colors keep their own meaning. To change only the primary button
family, set its color in `actionVariants` instead.

Every Mantine `Modal` and `Drawer` receives shared classes from the theme,
including content rendered in portals. Tune `--sky-dialog-padding`,
`--sky-dialog-title-size`, `--sky-dialog-radius`, `--sky-dialog-bg`, and the other
dialog tokens in `tokens.css`. Use `.sky-dialog-actions` for an action row and
`.sky-dialog-footer` for a fixed composer footer. The shared stylesheet owns
sheet stacking, maximum height and safe-area spacing. Dialogs still choose
their size and dismissal behavior; a bottom Drawer with `size="auto"` fits its
content, while an explicit size supports a taller chooser.

The meeting composer intentionally keeps `padding={0}` on its Modal: its
scrolling inner body and fixed footer consume the same dialog padding token.
It keeps its full-screen phone layout. Avoid adding local copies of shared
header, title, padding, radius or sheet rules; an intentional exception should
describe the layout need it serves.

See [2026-09-07 — Shared actions and dialog styling](2026-09-07-shared-ui-toolkit.md)
for the consolidation's rationale and verification.

## Today and date navigation

Today is a primary sidebar destination above Chat, Outbox, and Workstreams. It
always opens the notebook's current day at `/`. Recent days, This week,
and Next week appear beneath it only on day, week, and day-files pages.
Today appears once; the recent-days list begins with Yesterday. The current
day or week keeps its selected state, including direct date URLs and a
day's files. Chat and other sections keep the date list hidden. The mobile
drawer follows the same rule and closes after navigation.

Chat follows Today's date group as a standard navigation row. It starts
a new thread and stays highlighted for any open conversation.

The four primary rows pair their labels with 22px outline icons from
`client/sidebarIcon.tsx`: a sun, speech bubble, outgoing tray, and branching
nodes. Their rounded 1.6px strokes match the footer; inactive icons use the
secondary text color and the selected icon uses the primary accent in both
themes. The nested dates align with the primary labels. Icons are decorative;
the labels and `aria-current` identify each destination and its selected state.

## Sidebar utilities

Voice lives in the chat composer, immediately after Send; its conversation
handoff and lifecycle are described in the [chat design](../../chat/docs/README.md#voice-in-the-conversation).
The main sidebar has no Talk destination.

Automations, Explorer, and Settings share a persistent footer in every sidebar
section. `client/sidebarUtilities.tsx` renders the bolt, folder, and gear as 24px
outline icons in three equal columns, each with a 44px target. The current
section uses the primary accent and `aria-current`; hover and keyboard focus
show the destination's name. Native links support opening a section in another
tab, while ordinary clicks use the app's navigation and close the mobile drawer.

The sidebar's content scrolls inside `sky-side-scroll`, keeping the footer
visible in short windows and long Explorer trees. New automation stays just
above the icons in the Automations section. The mobile footer respects the
device's bottom safe area.

## Typography

Today and Explorer share `--sky-content-font-size`: 19px on desktop, 18px
at the existing 900px narrow layout. Reminders are one pixel smaller.
Document prose, headings, and table headings inherit the app's system
sans-serif family in both reading and editing. Code and markdown syntax
retain their monospace font.

The sidebar centers a 40px sky wordmark above a muted 12px clock. Both use
the app's sans-serif family. The clock keeps tabular digits so changing
the time does not shift the digits around, with the system-time warning
on a second centered line when it differs from notebook time.

The shell's 18px UI base stays separate so navigation, buttons, metadata,
and the user's appearance setting keep their existing scale. Explorer's
text-size control multiplies the content size and keeps its saved preference.

## Text selection and rendered HTML

`client/renderedHtml.tsx` owns `RenderedHtml`, the shared component for
read-only HTML in chat replies, approval previews, automation descriptions
and proposals, notebook link previews, and workstream prose and reports.
Use it with an HTML string and the feature's existing class names.

The component memoizes the `dangerouslySetInnerHTML` prop object by its
HTML string. A new object on every render makes React replace unchanged
text nodes and clears the browser's selection; memoizing just the string
does not prevent this. Background polling and unrelated controls must
leave those nodes intact. Changed HTML must still update normally.

Explorer and import readers manage their HTML through effects that depend
only on the HTML string; Explorer also applies syntax highlighting. They
follow the same rule: unchanged content keeps its existing DOM.

`AGENTS.md` requires the shared component and a browser check covering
selection through polling, a drag across a refresh, selections spanning
paragraphs, and changed content. See
[2026-09-07 — Shared HTML keeps selections](2026-09-07-shared-html-keeps-selections.md).

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

Videos and Chats remain in the main column when Details is closed; both
chat lists follow the [day's hierarchy rules](../../day/docs/README.md#videos-and-chats-in-the-days-record).

`day.css` scopes these rules to the day's own blocks. `sky-day-priority`
marks Most important explicitly, so an absent priority list never makes
another section look like the priority. Shared cards elsewhere retain
their existing appearance.

## Explorer's document header

The header uses the same 1000px maximum width and side padding as the
reader and editor. Breadcrumbs align with the document's left edge and
the controls with its right edge, with the save status vertically centered
beside them. Long status messages and conflict actions can wrap. On phones,
the controls leave room for the menu button, with the path on a full-width
line below, aligned with the document text.

## There is no reference page

The app is its own reference. A `/theme` page once held the concept mock
the theme was drawn from, with sample days, horizons and topics. It fell
behind the app it was meant to guide and was retired on 2026-09-03. See
`2026-09-03-the-reference-page-retires.md`.

The prompt page is in `client/settingsPrompts.tsx`, with styles in
`settingsPrompts.css`. It reuses the Markdown editor in a local mode with explicit
Save. See the [prompt library design](../../../../_shared-ts/prompts/docs/README.md).
