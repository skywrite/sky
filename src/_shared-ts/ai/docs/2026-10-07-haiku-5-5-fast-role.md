---
created: 2026-10-07
updated: 2026-10-07
---

# Haiku 5.5 takes the fast role, with thinking off

`ROLES.fast` and the four call sites that name a Haiku profile directly
(selection chat names, image names, draft names, the coding-session recap
digest) move from `default-haiku-4.5` to `default-haiku-5.5`:
`claude-haiku-5-5`, a 1M window, `effort: 'low'`,
`thinking: { type: 'disabled' }`. `default-haiku-4.5` stays in the catalog
(see Catalog policy in the README).

## Why thinking is off

Haiku 4.5 thinks only when asked. Haiku 5.5 runs adaptive thinking by
default, and thinking tokens count against `maxOutputTokens`. The fast role
is mostly short answers under small caps: a chat tool-run summary at 64
tokens, titles at 120.

Measured on synthetic prompts, two runs per cell:

| Setting | 64-token tool summary | One-word classification | 120-token title |
| --- | --- | --- | --- |
| Haiku 4.5 | text, 0.7–0.9 s | 0.4 s | 0.5–0.6 s |
| Haiku 5.5, API default (medium) | **empty**: all 64 tokens were reasoning | 1.1–1.4 s, ~170 reasoning tokens | 0.6–0.7 s |
| Haiku 5.5, low effort | **empty** | 0.5 s | 0.6 s |
| Haiku 5.5, low, thinking off | text, 0.7 s | 0.5 s | 0.8 s |

Not chosen: keeping thinking on and raising each caller's cap. Every fast
caller would then have to budget for reasoning it does not want, and the cap
would stop working as a length limit.

With thinking off, Haiku 5.5 writes a longer one-liner (62–64 tokens where
Haiku 4.5 wrote 36–38), and its tokenizer counts more tokens for the same text,
so the tool summary can reach its cap. The summary keeps its first line and
trims it to 120 characters, so a cut stays readable.

The API takes effort only up to `high` while thinking is off. So
`effortLevels()` offers low to high for a thinking-off preset, and
`validateEffort()` explains X-high and Max before the generic "does not
support" message.

## Sampling and tokens

- Haiku 5.5 rejects non-default `temperature`, `topP`, and `topK` whether
  thinking is on or off. The AI SDK drops them with a warning on every call.
  `thinkingEnabled()` now lists the model, so `resolveProfile` drops them first
  and the warning never fires (`linkLabel` asks for `temperature: 0`).
- Haiku 5.5 counts tokens like Opus 5.5. The same sample of repo docs and code
  (25,829 estimated tokens) was 36,438 tokens on both and 26,449 on Haiku 4.5
  (`count_tokens`). Its ratio seed therefore joins the Opus 4.7 family (1.75).
