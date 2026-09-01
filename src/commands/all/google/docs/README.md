---
created: 2026-09-01
updated: 2026-09-01
---

# google — Workspace commands

The group's root commands, and where the depth lives:

- `google:auth` connects accounts (tokens stay in the keychain via `context.secrets`).
- `google:find` searches Drive by name or content.
- `google:read` reads one page of a Doc (markdown), Sheet (csv, first tab) or
  Slides (text) by URL or file id — paged at 40k chars, tab-aware, and exposed
  to ai:chat as the auto-approved `google_read` tool. Uploaded Office files are
  read through their native Google twin (converted once, reused).
- `google:agent` is the write side: a sub-agent that creates and edits Docs,
  Sheets and Slides from a mission. Its docs live in
  [`agent/docs/`](../agent/docs/README.md).
- `google:browser` sets up the local browser session the agent drives for
  anchored comments and suggested edits.
- `google:email:*` (Gmail) and `google:calendar:*` have their own trees;
  Gmail's docs live in [`email/docs/`](../email/docs/README.md).

Shared plumbing sits in `lib/` (account resolution, cross-account file
probing, the shared read path) on top of the API client in `#lib/google`.

## Narratives

- [2026-09-01 — google:read becomes the chat's read path](2026-09-01-google-read-chat-tool.md)
