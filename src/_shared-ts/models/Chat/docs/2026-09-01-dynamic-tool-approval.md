---
created: 2026-09-01
updated: 2026-09-01
---

# Blessed files skip the approval round

Every gated tool call used to cost two things beyond the keypress: the
generation paused at the SDK's `tool-approval-request`, and after the
answer the whole chat model was re-invoked to continue — one extra model
round per approval, even for a file the user had already said "don't ask
again" about.

## The mechanism

AI SDK ≥7 accepts a per-tool *function* in `toolApproval`. Returning
`'approved'` executes the call inline in the same generation — verified
live: the run completes in one `streamText` invocation, the tool executes,
and the content carries a request+response *pair* sharing an `approvalId`
instead of a lone pending request.

That pair is the engine subtlety: ChatEngine's approval loop used to
trigger on any `tool-approval-request` part, which would have started a
spurious round after an inline-approved turn already finished. Pending now
means *a request whose approvalId has no response part*.

## What gets blessed (the ai:chat CLI host)

`SessionBlessings` (chat/lib/approvals.ts) holds two tiers:

- **Durable** — `tool:fileId` keys from explicit "always" answers and from
  files the session itself created (a `files` entry with `action: created`
  reported through the tool-result hook). Durable keys persist in the
  transcript's `approvals:` frontmatter (autosave and save both union with
  what the file already holds) and reseed on `--resume`.
- **Mentions** — file ids harvested from the user's own message text
  (Google URLs, or standalone id-shaped tokens carrying a digit). A paste
  is permission for now, not a standing grant: process-lifetime only, and
  deliberately tool-agnostic — pastes land before the turn's tool
  discovery has populated the registry.

Create missions and files the model surfaced on its own still prompt;
denials still stick for the turn. The interactive handler keeps a blessing
check as a belt, but blessed calls normally never reach it — the config
answers first, and the host prints one dim `auto-approved` line instead of
the mission block.

## Layers touched

`toolApproval` is now `ToolApprovalConfig` (static or per-call function)
through ChatEngine, ChatSession's ToolFactory, and
`createToolApprovalConfig({ isBlessed, onAutoApproved })`; hosts that pass
static maps (web service, ai:research) are unchanged. ChatDocument gained
the `approvals:` key; ResumeSession carries it out of `loadResumeSession`.
