---
status: shipped
created: 2026-09-01
updated: 2026-09-01
---

# Fable 5.1 joins the catalog; reasoning stays on Opus 5

## What shipped

`default-fable-5.1` → `claude-fable-5-1`, effort `xhigh`, adaptive
thinking: the same shape as `default-fable-5`. Addressable everywhere a
profile name goes (`ai:chat --reasoning`, `summary:* --model`, the settings
pane). No role was repointed and `default-fable-5` stays.

`summary:day`, `summary:week` and `week:checkin` keep their own
`default-fable-5` default; moving them is a separate call.

## Why reasoning did not move

The ask was profiles for "Opus 5.1 and Fable 5.1" with `reasoning` on
Opus 5.1. The Models API (`sky ai:claude:models`, checked 2026-09-01)
lists no Opus 5.1: the 5.1 generation is Fable only, and the newest Opus
is `claude-opus-5`, which `reasoning` already uses. A profile with an
invented id would load fine and 404 on its first call, so none was
created. The real choices for `reasoning` are Opus 5 as is, or Fable 5.1
at twice the per-token price.

## What was checked for Fable 5.1

Three breaking changes versus Fable 5, per the API migration guide:

- **Forced tool choice returns a 400.** No caller sets `toolChoice`, so
  nothing changes.
- **Thinking blocks are bound to the model that produced them.** A chat
  that resumes on another profile loses the earlier reasoning; the API
  drops those blocks server-side, unbilled. Same as any model switch.
- **Thinking blocks are bound to the conversation prefix** ("preserved
  thinking"). Editing an earlier turn invalidates every later block.
  Enforced only for API accounts created on or after 2026-08-31; older
  accounts get the mismatch recorded, not rejected. Not audited here:
  whether `ai:chat` context assembly rebuilds the prefix between turns.
  Run that check before Fable 5.1 becomes a role default.

Pricing is unchanged from Fable 5 ($10 / $50 per MTok); cache reads drop
to $0.25 per MTok.
