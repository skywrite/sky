---
created: 2026-10-10
updated: 2026-10-10
---

# Enrichment: stability before accuracy

## What was wrong

Measuring the save's choosers against the saved files' frontmatter gave tags
54% precision and document rel 53%, and the numbers looked like a quality
problem to fix with prompts. Running the same fifty chats twice showed most
of it was noise:

| Chooser | Same result in both runs | Values agreeing between runs |
|---|---|---|
| Tags (fast role) | 42% of chats | 63% |
| Entity rel (fast extraction, balanced selection over fixed candidates) | 80% | 83% |
| Document rel (balanced extraction and matching) | 40% | 71% |

A first pair of runs had looked far worse (tags 12%, document rel 10%) until the
AI error log for that window showed 258 swallowed connection failures: the
notebook service had restarted ten times under another lane's edits, and the
document pass abstains when its searches fail. A measurement of these choosers
is only as good as the service under it.

## What was rejected

- **Pinning a sampling temperature.** Every model in play, Haiku 5.5, Sonnet
  5.5, Opus 5.5, Fable 5.1 and the GPT-6 models, rejects sampling
  parameters, and `resolveProfile` already strips them. Determinism has to
  come from the model and from the shape of the question.
- **Prompt work on the measured precision.** Tuning a prompt against a number
  that swings fifteen points between identical runs cannot be read.

## Why the change works

The one stable chooser is the one where the model only picks from a fixed
candidate list. Tags are a pick from a closed menu too, but on the fast role;
chats are long and many-topic where a Slack message is one exchange. Chat tag
choice moves to the balanced role through `CHAT_ENRICH.role`: same tag set in
61% of chats instead of 42%. Subject extraction was tried on the balanced role
in the same test and measured no gain (78% against 80%), so it stays on fast;
the candidate-bound selection is what keeps entity rel stable. Other mediums
keep the fast default until measured. The document pass stays as it is: its
instability is in what the model is asked to decide, and its fix is design,
candidates and agreement, not a model swap.

The measurement scripts live in the session scratchpad, not the repo: they
read real chats. Any future change to these choosers is judged first by the
same two-run agreement test, then by agreement with hand-corrected files.
