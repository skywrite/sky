---
created: 2026-09-08
updated: 2026-09-08
---

# Drafts are read here

The chat prompt applied Slack formatting as soon as the model drafted a
message. Its subject-and-underline example was fenced, and replies followed
that shape: long prose in a monospace block, with literal formatting marks
and lines extending beyond the reading column. The destination was dictating
how the user reviewed the draft in Sky.

The shared prompt now separates drafting from delivery. Chat drafts use
readable Markdown; the Slack tool payload receives native Slack syntax when
the user sends. The wording is preserved during that conversion. Code fences
are reserved for code, structured data, or explicitly requested source syntax.

A prompt change alone cannot repair replies already in a conversation, and
active sessions retain the prompt they started with. The client therefore
recognizes legacy Slack draft fences when it renders completed and restored
replies. It reuses the Markdown document parser and Slack converter, removes
the decorative underline, and renders the recovered paragraphs and lists
through the existing safe HTML export and `RenderedHtml` component. The
recognition is limited to Slack-labelled fences or the old subject/underline
pair in unlabelled or plain-text/Markdown fences. It does not guess whether
arbitrary code is prose. Code inside a draft remains literal, and HTML remains
escaped. The transcript, model history, and approval payload are unchanged.

Long literal lines also wrap inside the chat column. This keeps remaining
code and raw content readable on narrow screens without losing indentation.

Unit coverage exercises legacy and labelled drafts, nested fences, normal
Markdown and code, CRLF, and inert HTML. An isolated browser regression uses
synthetic replies to check desktop and mobile widths, selections spanning
paragraphs, a mouse drag across polling, changed replies, completed turn
events, and reloads.
