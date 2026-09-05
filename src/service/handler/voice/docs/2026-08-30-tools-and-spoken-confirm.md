---
created: 2026-08-30
---

# Voice tools and the spoken confirm

The web voice session went from one tool (ask_notebook) to a working
set: day lists, Slack unread and drafts, Gmail reading and drafts. Two
decisions shape it.

## The tool set is curated, not inherited

`createVoiceHost` used to offer every chat tool with
`needsApproval: false`. That inherited tools with no voice shape
(clarify → create pairs, image generation) and paid for their schemas
on every spoken reply — a realtime session re-bills the whole
conversation, tool definitions included, per response. `VOICE_COMMANDS`
now names the set; a command joins the voice by being added there and
decorated `@AIChatTool`.

## Writes that leave the machine wait for a spoken yes

The gate lives in the route, not the prompt. A call to a tool whose
decorator says `needsApproval` parks server-side and answers
`{needsConfirmation, approvalId, summary}`; the model reads the summary
aloud and asks. `confirm_action {approvalId}` — single-use, 2-minute
expiry — executes the parked call; `cancel_action` discards it. No
prompt drift can bypass the gate, because the service never ran the
tool in the first place.

The split, as built:

- **No gate** — reads (`day_items`, `slack_unread`,
  `google_email_inbox_view`, `google_email_read`) and day-list writes
  (`day_items_add`, `day_items_done`), whose read-back is the check.
- **Gated** — every Slack and Gmail draft tool. Drafts are never sent
  by construction; the gate covers writing into the user's real
  composer at all.

A service restart drops parked approvals with the thread — the model
just asks again; the browser-held call survives.

Verified live 2026-08-30 through `/voice/:id/tools`: park → cancel runs
nothing; park → confirm created a real Slack self-DM draft, a gated
update rewrote it (confirmed via Slack's own draft list), and a gated
Gmail reply draft landed in-thread with correct RFC headers — both
cleaned up afterwards. Route tests cover park/confirm/cancel,
single-use, and the ungated pass-through.
