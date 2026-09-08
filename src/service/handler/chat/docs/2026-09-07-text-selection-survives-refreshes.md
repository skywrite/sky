---
created: 2026-09-07
updated: 2026-09-07
---

# Text selection survives background refreshes

Selecting part of a completed reply could lose its highlight before the
reader copied it. The chat and import lists refresh every 2.5 seconds in
the app shell, causing the conversation to render again even while idle.

The reply supplied a new `{ __html: turn.html }` object on each render.
React 19 compares that prop by identity and assigns `innerHTML` when it
changes, including when the HTML string is identical. The browser then
loses the text nodes that anchor its selection. An isolated browser check
selected "Atlas plan" in a finished reply: after the next background
refresh, the selection was empty and the original text node was detached,
although the reply's words were unchanged.

`RenderedHtml` in `theme/client/chat.tsx` memoizes the HTML prop object by
its string. Both completed replies and rich approval previews use it.
Unrelated renders preserve the existing text nodes; changed HTML still
updates the displayed content. The memoization depends on the HTML string,
so a fresh turn object from a server read does not invalidate it.

Polling remains active. The correction belongs at the HTML rendering
boundary, where an unrelated update previously replaced unchanged text.

Verified with the real client bundle in isolated Chromium and synthetic
responses: a phrase survives two sidebar refreshes; a mouse drag continues
through a refresh; selections spanning paragraphs and inside a rich
approval preview remain intact. In each case the original text nodes
stay connected with no content mutations. Active thread polling also
preserves a selection when it returns fresh turn objects with the same
HTML, and a later changed reply appears correctly. `bun run dev:check`
passes.
