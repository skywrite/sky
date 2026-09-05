---
created: 2026-09-05
updated: 2026-09-05
---

# A reason the SDK did not read is quoted, not dropped

## What happened

Two web turns on the Cerebras Qwen profile, the same question ten minutes
apart, failed with "turn failed — Bad Request". The AI error log had the
same two words. The day before, the same two words had meant an answer
with no body ([2026-09-04](2026-09-04-an-answer-with-no-body.md)); this
time the body was there and said exactly what was wrong:

    {"message":"Please reduce the length of the messages or completion.
      Current length is 196699 while limit is 131072",
     "type":"invalid_request_error","param":"messages",
     "code":"context_length_exceeded"}

The Cerebras provider is the OpenAI one pointed at another host, and the
OpenAI provider reads an error body as `{"error": {"message": …}}`.
Cerebras writes its reason at the top of the body. The parse fails, the
SDK falls back to the status text, and the body rides along unread on
the error's `responseBody`. So the premise of the day before — that a
provider's own rejection always reaches the SDK's message — holds for
Anthropic and OpenAI and not for every host that speaks their dialect.

## The rule

`turnErrorMessage` gains a case between the empty body and the message
that stands:

- An API call error with a status and a body that carries a reason the
  SDK's message does not already say names the host and the status and
  quotes the reason: "api.cerebras.ai answered 400: Please reduce the
  length of the messages or completion. Current length is 196699 while
  limit is 131072".
- The reason is read wherever the host put it: `error.message` (OpenAI,
  Anthropic) or a top-level `message` (Cerebras). A body that is not JSON,
  or says nothing, has no reason, and the SDK's message stands as before.

The engine's catch clamps the line as before; the session logs it; the
page and the terminal show it. Nothing else changes: an empty body is
still named and told to send again, and a reason the SDK did read is
still shown as it was.

## Verified

- 2026-09-05 — a Cerebras 400 with its reason at the top of the body, and
  an OpenAI-shaped 429 the SDK had reduced to "Too Many Requests", each
  name the host and the status and quote the reason; a 400 whose body is
  an HTML page keeps "Bad Request" (helper test). The earlier cases hold.
- 2026-09-05 — live, the ai:chat CLI on the Cerebras Qwen profile with the
  notebook closed and a 150,000-digit message: the terminal printed
  "Error: api.cerebras.ai answered 400: Please reduce the length of the
  messages or completion. Current length is 162646 while limit is 131072",
  and the AI error log's turn entry carries the same line. The turn the
  day before had logged "Bad Request".
