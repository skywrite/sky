---
created: 2026-09-07
updated: 2026-09-07
---

# Shared HTML keeps selections

The [chat selection fix](../../chat/docs/2026-09-07-text-selection-survives-refreshes.md)
identified how a fresh `dangerouslySetInnerHTML` prop object causes React
to replace text nodes even when their HTML is unchanged. Background
polling then clears a selection or interrupts a drag.

The same pattern remained in automation descriptions and proposals,
notebook link previews, and workstream prose and report previews.
Automation descriptions already memoized their HTML strings, but still
created new prop objects on every render.

`RenderedHtml` now lives in `client/renderedHtml.tsx` and all those views,
including chat, use it. It retains the prop object for identical HTML
while accepting changed content. Existing class names and markdown
rendering stay with each caller. Explorer and import readers already
assign HTML only in effects keyed by the HTML string, so they preserve
selection through unrelated renders.

The project instructions now require the shared renderer for read-only
HTML and an audit of equivalent call sites when fixing a shared rendering
bug. Browser verification must exercise selection through background
refreshes and confirm that actual content changes still reach the page.

Verified in isolated Chromium with the real client: automation descriptions
and proposals, notebook link previews, workstream prose, and workstream
report previews all retain their selections through the shell's background
poll. The selected text nodes remain connected and unchanged. The automation
page also preserves a range spanning paragraphs and a mouse drag across a
refresh; changed automation and workstream text appears after a refetch.
The notebook fixture and service responses are synthetic. The full
`bun run dev:check` gate passes.
