---
created: 2026-09-01
updated: 2026-09-01
---

# google:read becomes the chat's read path

Until now the only door from ai:chat to a Google file was `google:agent` —
even for "what does the doc say". That path pays three times: the approval
gate (every gated tool call also costs an extra model round: the stream
pauses at the approval request and the whole chat model is re-invoked to
continue), a full reasoning sub-agent spun up per mission, and the user's
attention. The house norm everywhere else is reads-auto, writes-gated
(`google:email:read`, `google:email:inbox:view`, `slack:unread`); Docs were
the outlier only because the agent was the sole surface.

## What changed

- **Shared read path.** The agent's rich read semantics moved into
  `lib/readWorkspaceFile.ts`: resolve a file id, convert an uploaded Office
  file to its native twin (once, reused), export one page, surface tab
  structure. `paginateRead` (the 40k-chars-per-call pager with the
  self-directing `[Truncated …]` marker) lives there now; the agent's
  `read_file` tool imports it from the new home and is otherwise untouched.
- **`google:read` upgraded onto it.** New abilities: `--offset` continues a
  truncated read; `--tab-id` reads a single Doc tab as plain text; a URL
  copied from a specific tab reads that tab; multi-tab Docs return a tabs
  list mapping titles to tabIds; a 404 probes the other connected accounts
  and names the one that can see the file. One behavior change on the CLI:
  exports longer than 40k chars now page (the marker names the offset to
  continue from) instead of printing whole.
- **Exposed to ai:chat auto-approved.** `@AIChatTool({ needsApproval:
  false })` — a read is one tool call: no approval prompt, no extra model
  round, no sub-agent. The result carries a `files` array (title + url for
  the file read, plus a twin when one was just converted), which the chat
  host records on the transcript rel like agent mission files. The chat
  system prompt now steers read/summarize asks to `google_read` and keeps
  `google_agent` for changes; the voice host picks the tool up automatically
  (it only ever gets auto-approved tools).

## Why the id in the result matters

The result's `id` (the twin's id for uploaded files) and the tabs' `tabIds`
are exactly what a follow-up `google_agent` mission needs to target the same
file — the read tool is the cheap way for the chat model to acquire them.
Follow-ups on the same session's files still pay the approval round; taking
that tax out (per-call approval decisions, session-blessed files, a session
workspace registry) is the next rung, not this one.
