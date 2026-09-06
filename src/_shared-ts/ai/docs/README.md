---
created: 2026-09-01
updated: 2026-09-05
---

# Model registry — roles, profiles, providers

`models.ts` is the one place a call site picks a model. Three tiers:

- **role** — `aiModel('reasoning')`. Semantic and stable; the four roles
  (`reasoning`, `fast`, `balanced`, `vision`) live in `ROLES`.
- **profile** — `default-opus-5`. A named provider + model + options tuple.
  The shipped set is `defaultProfiles.ts`; a person's own come from
  `ai.profiles` in `~/.sky/config.jsonc` (config wins on a name clash).
- **provider** — the AI-SDK provider the profile resolves through
  (`anthropic`, `openai`, `ollama`, `lm-studio`, `cerebras`).

`resolveProfile` demuxes a profile's options: generic call settings hoist
to the top level, provider-specific ones (effort, thinking) namespace under
the key the provider's model reads (`PROVIDER_OPTIONS_KEY` — an
OpenAI-compatible host such as Cerebras files under `openai`). Sampling
overrides are dropped on thinking profiles because those models reject them
with a 400.

A profile may declare `contextWindow` — the tokens its host serves in one
request, when that is less than a chat may ask to read. A chat's reading
budget is fitted to it (`universal/ai/readingBudget.ts`): the budget stays
when it fits, else drops to the highest stop that leaves room for the
prompt, the tools, the reply and the estimate's slack. Cerebras serves
Qwen 3.8 at 131,072 tokens on the paid tier, so a chat there reads 50k at
most; a profile with no window declared is not capped.

## Providers and their keys

- `anthropic` and `openai` read their keys from the environment
  (`src/.env`, loaded by both launchers).
- `cerebras` (`llm/cerebrasProvider.ts`) reads its key from the OS keychain
  entry `cerebras/main` on the first request and holds it for the process.
  Store it with `sky secrets:set cerebras main`; no restart needed. It is
  the OpenAI provider pointed at `api.cerebras.ai` through `.chat()`, since
  Cerebras serves chat completions only. Its model is wrapped in
  `llm/singleSystemMessage.ts`: the host takes one system message, first,
  and the cache helpers split instructions into several.
- `lm-studio` and `ollama` are local and need no key.

## Catalog policy

- A profile ships only for a model that is live on its provider's API
  (`sky ai:claude:models` lists Anthropic's). The provider builds the model
  object from the id without checking it, so an invented id fails on the
  first call, not at startup.
- Adding a profile makes it addressable (`--reasoning default-x`,
  `sky ai:profiles`, the settings pane). Only repointing a role in `ROLES`
  changes what runs by default.
- Superseded profiles stay in the catalog: a person's config or a command
  flag may still name them.
- Repointing `reasoning` also changes the VS Code command-palette titles.
  Run `node scripts/syncTitles.ts` in `extensions/vscode`; `dev:check`
  fails until they are in sync.

## Prompt caching

`promptCache.ts` owns the Anthropic cache breakpoints: `cachedInstructions`
marks the stable instruction segments, `withCacheTail` marks the last
message of a conversation, and `cacheTailStep` moves that marker before
every step of a tool loop. Rule: every `streamText` / `generateText` loop
with `stopWhen` passes `prepareStep: cacheTailStep`, or each step re-bills
the whole replayed history.

## Usage

Execution timing is shared across commands, agents, model requests, and tools;
see [timing](../../timing/docs/README.md). Both CLI and web service record it automatically.

Every resolved model is wrapped in `usageMeter` (`usageLog.ts`): each call
appends its token counts — full-rate input, cache reads, cache writes,
output — with the model and the command making the call to
`<userDataDir>/logs/ai-usage.jsonl`. `runWithUsageSource` names the
command; the command service and the CLI runner set it for every run, the
chat routes for a turn. `sky ai:usage` rolls a day up by model and command.
Tokens only; the invoice prices them.

## Notes

- [2026-09-05](2026-09-05-usage-meter.md) — every model call records its
  token counts; every chat turn shows its own; `sky ai:usage` rolls up.
- [2026-09-03](2026-09-03-cache-tail-every-step.md) — the cache tail moves
  on every loop step; a mission's history is read from cache, not re-sent.
- [2026-09-03](2026-09-03-cerebras-provider.md) — Cerebras joins the
  providers with Qwen 3.8 27B; the key lives in the keychain, and
  `google:agent --reasoning` picks the profile a mission runs on.
- [2026-09-01](2026-09-01-fable-5-1-profile.md) — Fable 5.1 joins the
  catalog; there is no Opus 5.1, so `reasoning` stays on Opus 5. A
  `-high` variant followed on 2026-09-02.
