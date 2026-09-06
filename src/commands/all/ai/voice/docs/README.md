---
created: 2026-09-06
---

# ai:voice

Design notes for `src/commands/all/ai/voice/` — the terminal voice
session (`ai:voice`) and the audition opener (`ai:voice:audition`). The
session configuration, persona prompts, greetings, and the `ask_notebook`
delegate that both transports share live in `src/commands/lib/voice/`;
the web page and its service side are written up in
`src/service/handler/voice/docs/`.

- Two voices in one conversation — a host and a researcher who leaves
  and returns. A design, not built:
  [2026-09-06 — two voices, one conversation](2026-09-06-two-voices-one-conversation.md)
