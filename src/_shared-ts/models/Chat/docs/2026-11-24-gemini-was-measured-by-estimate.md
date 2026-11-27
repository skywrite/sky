---
created: 2026-11-24
updated: 2026-11-24
---

# Gemini was measured by estimate

2026-11-24. The report: compaction fired in real chats with the context count far below the model's window.

## What was wrong

Every chat it fired in ran on Gemini, and each time the chat held well under half of the model's window.
Because those chats had few old tool results, the compaction took notebook documents, and it cut the first reading.
Once a first reading is cut the chat stops reading new documents on its own, so the cost outlasted the compaction.

The cause was the way a request is measured.
`ChatEngine/requestBudget.ts` checks each request against the model's window.
For Claude and OpenAI the provider's own counter does the measuring, inside the provider's fetch.
Every other provider was measured by an estimate of two characters a token.
That estimate exists for hosts with no counting endpoint, and it is deliberately high: about double the real count.

Gemini arrived as a new provider and matched neither name the check looked for.
It was measured by the estimate, so Sky took a Gemini chat for twice its size and compacted it at half the window.
Nothing failed and nothing was logged.
The only sign was a compaction line beside a context count that showed plenty of room.

## What changed

- `withGeminiTokenCount` in `ai/inputTokenLimit.ts` counts the Google SDK's actual payload with Google's
  [`countTokens`](https://ai.google.dev/api/tokens) before the request is sent, like the two wrappers beside it.
  The request goes under `generateContentRequest` with the model's path.
  `contents` alone counts the history and leaves out the system instruction and the tools, and a request without the
  model's path is refused.
  The reply's room comes from `generationConfig.maxOutputTokens`.
- `ai/llm/geminiProvider.ts` puts the counter inside the keychain fetch, so the count is signed like the request.
- `countsOwnRequests(provider)` names the providers that count for themselves, and `requestBudget.ts` asks it.
  The list sits beside the wrappers, where the next provider's author will look.

A counter that is unavailable does not block a chat.
The request goes out, and the provider's own rejection is the backstop.

## What was rejected

- **A better estimate, from the ratio Sky learns per model.**
  It would be closer for prose and still wrong for tools and native files, which count differently.
  The provider's counter is exact and costs one small request.
- **Raising the estimate's divisor for every host.**
  A local model's tokenizer is unknown, and an estimate that runs low sends a request the host then refuses.

## What it leaves

- Hosts with no counter are still measured by the estimate: Cerebras and local models.
  A chat there is compacted at about half its window.
- Gemini's own context-length rejection is not recognized as one.
  If the counter is unavailable and a request is too large, the turn fails with the provider's message.
- New messages on Gemini seldom read from its cache, with or without a compaction.
  That is a separate question from this one.

## Verified

Unit tests cover the counter: the request it sends, both generation calls, the scope of one chat, a counter that fails
and a cancelled count.
An engine test sends the same chat, half the size of its window, on Gemini and on a host with no counter: Gemini sends
it whole and the other compacts it.
That test fails against the earlier code.

The same scripted chat was run against Gemini 4 Neon before and after, on a window set to 45,000 tokens, which allows
29,800 for a request.

| | Earlier code | This code |
| --- | --- | --- |
| First compaction | Message 7, holding 14,088 tokens | Message 24, holding 30,569 tokens |
| Compactions | 3 in 12 messages | 1 in 28 messages |
| Notes | Cut on the third compaction | Whole |
| Answers | All right | All right |
