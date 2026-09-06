---
created: 2026-09-03
updated: 2026-09-03
---

# Cerebras joins the providers

A `google:agent` restyle mission on a multi-tab doc ran most of an hour,
and the whole wait was the model thinking: Opus 5 at xhigh, 20 to 30
steps, a minute or two of generation each. Cerebras serves Qwen 3.8 27B at roughly 1500
tokens a second — a model that sits high on the agentic benchmarks with
reliable tool calling and a 262K window — served as 131,072 tokens a
request on Cerebras's paid tier, which the profile declares as its
`contextWindow`. Whether it does this job as well
is an open question; whether it does it faster is not. This note adds the
provider so the question can be answered on a scratch document.

## What was built

- `llm/cerebrasProvider.ts` — the OpenAI provider pointed at
  `api.cerebras.ai/v1` under the name `cerebras`. Models come from
  `.chat(id)`: Cerebras serves chat completions, not the Responses API.
- The key comes from the OS keychain entry `cerebras/main`, not from
  `.env`. The registry builds providers synchronously and a keychain read is
  async, so a wrapping fetch reads the key on the first request and signs
  every request after with it. A missing key fails on the first call with
  the `sky secrets:set` command that fixes it, and the miss is not cached,
  so storing the key needs no restart. The CLI, the VS Code extension and
  the launchd daemon all take this path. This is the pattern the remaining
  environment keys migrate to.
- `default-cerebras-qwen-3.8` in the catalog: `qwen-3.8-27b` with
  `reasoningEffort: 'high'`, the host's default, stated so the profile says
  what runs. Cerebras rejects the Qwen-native thinking parameters; the
  OpenAI-style `reasoning_effort` is the one it takes.
- `PROVIDER_OPTIONS_KEY` in `models.ts`: the OpenAI chat model reads
  `providerOptions.openai` whatever the provider is named, so the resolver
  files a Cerebras profile's options under that key. Before this the key
  was always the provider's own name.
- `google:agent --reasoning <profile>` picks the model a mission runs on,
  the way `ai:voice --reasoning` picks the delegate. The default
  (`MISSION_PROFILE`) is the Cerebras profile while it is on trial — every
  mission, from the CLI or from chat, runs on Qwen unless the flag names
  another profile. The reasoning role itself is unchanged.

## The first mission failed, and said nothing

The first chat mission on Qwen ended at once with the SDK's generic "No
output generated". Two defects, both fixed here:

- Cerebras rejected the request: `System message must be at the beginning`.
  `cachedInstructions` splits the agent's instructions into several system
  messages so each carries its own Anthropic cache breakpoint, and the
  OpenAI chat provider sends them as separate system messages. Cerebras's
  chat template takes exactly one, first. `llm/singleSystemMessage.ts` is a
  middleware on the Cerebras model that folds them into one leading system
  message and drops the breakpoints, which mean nothing to that host.
- The agent loop read `error` parts off the stream like any other event and
  moved on; the text promise then threw the generic error, which became the
  mission's result. The loop now records the error part — status, message,
  and the host's own words — logs it to the AI error log, and fails the
  mission with that line instead.

## Rules

- Anthropic cache markers (`cachedInstructions`, `cacheTailStep`) stay on
  the loop; other providers ignore `providerOptions.anthropic`. The
  Cerebras model folds the split system messages into one (see above). Cerebras
  does its own prefix caching — its rate limits count uncached tokens — and
  the Developer tier allows 150K uncached tokens a minute on this model. A
  mission's replayed history has to hit that cache to stay under.
- `qwen-3.8-27b` is text-only on Cerebras. The agent's visual critiques run
  on the vision role and are unaffected.

## Verified

- Unit: `cerebrasProvider_test.ts` — the wrapped fetch replaces the SDK's
  placeholder key with the keychain key, reads the keychain once across
  requests, fails with the fix and no network call when the key is
  missing, signs the next request after a late `secrets:set` without a
  restart; `.chat()` models hit `/chat/completions` on the Cerebras host;
  the default profile resolves to the model with its options under
  `openai`. `singleSystemMessage_test.ts` — split instructions fold into one
  leading system message; a compliant prompt passes through by reference.
- Repro: the agent's exact first request (its prompt and all its tools)
  against Cerebras returned the 400 above before the middleware and READY
  after it.
- Live: not yet — the key is not in the keychain. The plan is two missions
  on a scratch copy, one read-and-report and one restyle, each run on
  Opus 5 and on Qwen, comparing steps, wall time, first-try `batchUpdate`
  success and the report side by side.
