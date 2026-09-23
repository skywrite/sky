---
status: shipped
created: 2026-09-22
updated: 2026-09-22
---

# Opus 5.5 takes the reasoning role; Opus 5 leaves the catalog

## What shipped

`default-opus-5.5` → `claude-opus-5-5`, effort `xhigh`, adaptive thinking,
a 1M context window declared. `ROLES.reasoning` points at it, so every
`aiModel('reasoning')` call site moved with it: `ai:chat`'s default,
`summary:doc`, the VS Code palette titles (re-baked by `syncTitles`).
`default-opus-5.5-medium` is the same model at effort `medium`;
`google:agent` runs its missions on it.

`default-opus-5` and `default-opus-5-medium` are retired. A configuration
or a flag that still names one fails at profile lookup with the list of
known names; repoint it to the 5.5 name.

`@ai-sdk/anthropic` 4.0.49 → 4.0.60 and `ai` 7.0.94 → 7.0.111, the
releases of 2026-09-22 that know the model. `universal/ai/effort.ts` lists
the model, so every effort level is offered for it.

## Why Opus 5.5

Announced 2026-09-22. Anthropic's leading model below the Fable tier:
$4 / $20 per million tokens against Opus 5's $5 / $25, the same 1M context
and 128k output, cache reads at 5% of the input price. Four breaking
changes from Opus 5, all of the Fable 5.1 shape:

- thinking cannot be disabled: `disabled` and budget `enabled` return 400;
- forced tool choice (`any`, a named tool) returns 400;
- thinking blocks are bound to the model and to an append-only conversation;
- `computer_20251124` gives way to the `computer_toolset_20260801` toolset.

The API's default effort is `medium`, not `high`. Both profiles state their
effort, so nothing here inherits the new default silently.

## Why the SDK bump is part of the change

On 4.0.49 the provider matched `claude-opus-5-5` by substring into the
Opus 5 capability set. That was right about output size, structured
outputs and sampling parameters, and wrong about the two rejections: a
`thinking: disabled` or a `toolChoice: 'required'` went to the API and came
back 400. 4.0.60 gives the model its own entry. A disabled or budget
thinking setting is dropped with a warning and the request stays adaptive.
`required` becomes `auto` with a warning; a named tool choice sends only
that tool under `auto`. The JSON-tool structured output mode falls back to
native `output_config`.

The same release reflags Fable 5 and Fable 5.1 as always-adaptive, from
the API reference rather than live tests. The Fable profiles send adaptive
thinking, so nothing changes for them.

No registry caller forces a tool choice on the reasoning role. The voice
research lane does (`commands/lib/voice/research.ts`), on its own Cerebras
and GPT-6 Astra profiles.

## What was rejected

- Keeping `default-opus-5` beside the new profile. The ask was to retire
  the previous Opus versions; the retired list in the README names it.
- Inheriting the API's `medium` default for the reasoning role. The role
  ran at `xhigh` on Opus 5; the profile keeps that depth explicit.
- Bumping `@ai-sdk/anthropic` alone. `ai` 7.0.94 pins an older provider
  spec than 4.0.60; the matching `ai` release keeps one copy of it.

## Verified

- 2026-09-22 — `bun run dev:check` green: format, lint, typecheck, and the
  VS Code checks with the titles re-baked to `claude-opus-5-5`.
- 2026-09-22 — `sky ai:claude:models` lists `claude-opus-5-5`. The only
  Haiku it lists is `claude-haiku-4-5-20251001`.
- 2026-09-22 — one `generateText` through `aiModel('reasoning')` at effort
  `low`: answered on `claude-opus-5-5` in 2.1 s, no SDK warnings, 18 tokens
  in and 4 out.
- 2026-09-22 — registry, effort, agent timing and settings unit tests green.

## What to watch

- `thinkingEnabled()` in `models.ts` matches `claude-opus-5` and
  `claude-opus-5-5`: a person's own preset on either model that omits
  `thinking` still has its sampling parameters stripped.
- Preserved thinking: for accounts created on or after 2026-08-31, replaying
  a thinking block after an edit to earlier turns returns 400. Chat's
  "delete from here" rewrites history; older accounts only see the rule
  recorded.
- Narration between tool calls arrives as `thinking` blocks now, empty at
  the default display. A surface that showed that text needs
  `display: 'updates'` (beta) to get it back.
