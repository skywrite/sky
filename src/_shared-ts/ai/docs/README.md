---
created: 2026-09-01
updated: 2026-09-22
---

# Model registry — roles, profiles, providers

`models.ts` is the one place a call site picks a model. Three tiers:

- **role** — `aiModel('reasoning')`. Semantic and stable; the four roles
  (`reasoning`, `fast`, `balanced`, `vision`) have shipped defaults in `ROLES`;
  `ai.roles` assigns them to presets in the user's configuration.
- **profile** — `default-opus-5.5`. A named provider + model + options tuple.
  The shipped set is `defaultProfiles.ts`; a person's own come from
  `ai.profiles` in `~/.sky/config.jsonc` (config wins on a name clash).
- **provider** — the AI-SDK provider the profile resolves through
  (`anthropic`, `openai`, `ollama`, `lm-studio`, `cerebras`).

The UI calls profiles **presets**. A preset owns its model, default effort,
and provider options. Roles point to presets; they do not own another copy
of those settings. Editing a shared preset affects every role using it.
The registry reads assignments and presets fresh for each resolution,
so the service needs no restart. Existing profile names remain valid.

`aiModel(role, { effort })`, `aiModelByProfile(name, { effort })`, and
`resolveProfile(profile, { effort })` override effort for that call only.
Omitting effort or passing `default` inherits the preset. The shared
`universal/ai/effort.ts` validates supported levels and maps to Anthropic's
`effort` or other providers' `reasoningEffort`, preserving unrelated options.
Unknown models keep their existing options without advertising unverified levels.
CLI tuning flags use `--ai-*` names; old long names and short flags remain aliases.
For `ai:chat`, `--ai-effort` affects the answering model; `--ai-fast` only
selects the preset used to label pasted text in the terminal input.

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
  entry `cerebras/main` on the first request and holds it for the process
  (`keychainAuthFetch.ts`, the fetch that signs with a keychain key).
  Store it with `sky secrets:set cerebras main`; no restart needed. It is
  the OpenAI provider pointed at `api.cerebras.ai` through `.chat()`, since
  Cerebras serves chat completions only. Its model is wrapped in
  `llm/singleSystemMessage.ts`: the host takes one system message, first,
  and the cache helpers split instructions into several.
- `lm-studio` and `ollama` are local and need no key.

## Decisions: TypeSafe's Jev

`typesafe/client.ts` is a different modality and is not in the registry:
no profile, no role. TypeSafe's Jev answers typed questions about a state
— pick one of these labels, rate on this rubric, yes or no — with
calibrated probabilities, and never writes text; a language-model call
site cannot be pointed at it. Its key is the keychain entry
`typesafe/main`, stored from Settings → Connections once TypeSafe has
accepted it, or blind with `sky secrets:set typesafe main`, and read on
the first request through the same keychain fetch as Cerebras. A caller
builds its client there and asks through `typesafe/systemOne.ts`, which
records each request in the usage log under provider `typesafe`. The
first caller is the web chat's experimental preflight; see the
[2026-09-17](2026-09-17-typesafe-jev.md) note.
The [Outbox conversation screen](../../../lib/outbox/docs/README.md#finding-responses-and-decisions)
also uses Jev to skip clearly irrelevant conversations before request extraction.

## Catalog policy

- A profile ships only for a model that is live on its provider's API
  (`sky ai:claude:models` lists Anthropic's). The provider builds the model
  object from the id without checking it, so an invented id fails on the
  first call, not at startup.
- Adding a profile makes it addressable (`--ai-reasoning default-x`,
  `sky ai:profiles`, the settings pane). Repointing a role through Settings
  (`ai.roles`) changes its default; `ROLES` remains the shipped fallback.
- Superseded profiles stay in the catalog unless explicitly retired: a
  person's config or a command flag may still name them. The retired
  built-ins are Opus 5 (2026-09-22), Opus 4.6/4.8, Sonnet 4.6, GPT-4o,
  and GPT-5.5.
- GPT-6 Astra has `default-gpt-6-astra-low`, `default-gpt-6-astra-high`, and
  `default-gpt-6-astra-xhigh`, all using priority processing. The model
  id and reasoning efforts follow the
  [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra).
- Changing the shipped `ROLES.reasoning` also changes the VS Code command-palette titles.
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

- [2026-09-22](2026-09-22-opus-5-5-default.md) — Opus 5.5 replaces Opus 5 in
  the catalog and takes the `reasoning` role; the AI SDK moves to the release
  that knows the model's always-on thinking and no forced tool choice.
- [2026-09-17](2026-09-17-typesafe-jev.md) — TypeSafe's Jev joins, key
  first: a keychain-keyed client, the key checked with TypeSafe and stored
  from Settings → Connections; the keychain fetch leaves the Cerebras
  provider for both hosts to share.
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
