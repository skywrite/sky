---
created: 2026-10-24
updated: 2026-10-24
---

# A new chat opens on GPT 6.1 Sol Ultrafast

## What shipped

`ROLES` gains a fifth role, `chat`, pointing at `default-gpt-6.1-sol-ultrafast`
(`gpt-6.1-sol`, `reasoningEffort: high`, `serviceTier: 'ultrafast'`). Both chat
surfaces take their default from it: the web composer's `defaultModel` and
`sky ai:chat`'s `--ai-reasoning` default. `reasoning` keeps Opus 5.5, so
summaries, meetings, extraction, and the saved chat's own summary stay there.
Settings → AI → Models lists the new role as **Chat**, and `ai.roles.chat`
overrides the default like any other role.

## Why a role of its own

Chat is the one long, tool-driven loop where latency compounds across steps, so
Ultrafast's 2.8 s against 9.9 s for the same short answer (measured 2026-10-08)
buys the most there. The one-shot analyses on `reasoning` do not repay the tier:
Ultrafast is $12/$60 per MTok against Opus 5.5's $4/$20, and Sol standard is
$2/$10.

## What was rejected

- Repointing `reasoning`. It would have moved every summary, meeting, and
  extraction call to a 6x Sol price for a latency win only chat feels.
- A `CHAT_PROFILE` constant beside `ROLES`. The chat default would then be
  invisible in Settings and unable to follow a person's own preset.
- Folding chat into `balanced` or `fast`. Those describe kinds of work, not one
  surface's startup state, and either would have moved existing call sites.

## What to watch

- A chat saved under another preset keeps it; only new chats open on Chat.
- `default-gpt-6.1-sol-ultrafast` is OpenAI-only. A person who keeps only an
  Anthropic key must point `ai.roles.chat` at a preset they have before a new
  chat will run.
- `ai.roles.chat` replaces the shipped fallback just as the other roles do, so
  the settings pane and the CLI default stay in agreement.
