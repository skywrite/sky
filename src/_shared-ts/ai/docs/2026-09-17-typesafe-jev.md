---
created: 2026-09-17
updated: 2026-09-17
---

# TypeSafe's Jev joins Sky, key first

TypeSafe AI came out of stealth on 2026-09-16 with Jev, the first of what
they call System One models. It does not write text. It takes a state —
text, or a JSON object or array — and named typed questions, and answers
each with a typed value and calibrated probabilities. `choice` picks one
of up to 255 labels and reports a probability per label with a confidence
number. `score` places the state on a rubric of two to ten described
levels and reports the expected value, the probabilities and a
confidence. `noul` answers yes or no as the probability of yes. Every
question is independent, so all the questions about one state go in one
request, and the answer comes back in well under a second at a small
fraction of a language model's price: input tokens only, output free.
The vendor's own rules: control flow, arithmetic and date logic stay in
code; judgments split into atomic questions; state carries only what a
question needs; confidence gates what an answer is allowed to do.

## What was built

- `@typesafe-ai/sdk` 0.6.0, pinned exactly. It has no dependencies of its
  own. The SDK is six days old and its second release already changed the
  score rubric's shape, so the pin is deliberate.
- `typesafe/client.ts` — a client keyed from the keychain entry
  `typesafe/main`, and the key check: the models the key may use, or why
  TypeSafe turned it away. Jev is not a language model, so it is not a
  provider in `models.ts`: no profile, no role. A caller that asks it
  questions builds its client here.
- `keychainAuthFetch.ts` — the fetch that signs requests with a keychain
  key, moved out of the Cerebras provider so both hosts use one. Cerebras
  is unchanged in behavior; its three fetch tests moved with it.
- Settings → Connections: a "TypeSafe API key" row at the top of the
  Keychain card. Add pastes the key, the service asks TypeSafe to list
  its models with it, and only an accepted key lands in the keychain.
  Every look at the page asks again with the stored key, so a revoked key
  reads as Refused instead of failing the first call that needs it.
  Remove asks twice, like every other row. The raw `typesafe/main` entry
  stays out of the list below, since this row is it.

## Rules

- The key is keychain-only, like Cerebras's: never in `src/.env`, never
  in the config file. `sky secrets:set typesafe main` stores it blind;
  the page stores it checked.
- The SDK's logging stays off. Its debug level prints request bodies,
  which are notebook text.
- A caller records every request in the usage log with provider
  `typesafe` and the model TypeSafe answered with, the way every
  language-model call is recorded, so `sky ai:usage` shows Jev beside
  the others.
- The first caller is the web chat's preflight — does this message need
  the notebook? — behind the Experimental switch; `typesafe/systemOne.ts`
  is the ask that records the request. See the
  [chat note](../../../service/handler/chat/docs/2026-09-17-ask-first-whether-a-message-needs-the-notebook.md).
  A pre-screen on the outbox scan, run in shadow beside the model's
  judgment, is the proposed second.

## Verified

- Unit: `typesafe/client_test.ts` — the keychain client signs the models
  request with the stored key and reads the names back; a missing key
  fails with where the key goes and never reaches the network; a 401 on
  a stored key reads as refused; a pasted key is signed as pasted and
  reads as accepted, refused, unreachable, or the host's status.
  `keychainAuthFetch_test.ts` — the three tests that were the Cerebras
  provider's, over a synthetic secret. `connections_test.ts` — the three
  routes over a scripted host: the row, a blank or unaccepted key
  refused, an accepted one stored trimmed, the key kept out of the
  listing and out of every answer, and forgotten on remove.
- Live: the SDK under Bun 1.4 against api.typesafe.ai with a bogus key
  answers 401 with a request id; the page refused a bogus key and stored
  nothing; with the real key stored, the row reads Connected and names
  the models the key may use.
