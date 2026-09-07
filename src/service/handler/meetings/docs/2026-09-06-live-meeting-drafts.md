---
created: 2026-09-06
updated: 2026-09-06
---

# Live interpretation preserves the review

The meeting composer waited for a Review button before showing people or
timing. Its contact lookup used text matching followed by alphabetical
order, even though IntelliSense and transcript meeting detection already
shared a recency-weighted interaction score.

The composer now interprets after a 400 ms typing pause, using the existing
Cerebras Qwen profile. Each change cancels the previous request. A sequence
guard and abort check prevent a late result from replacing newer wording;
request cancellation is also passed to the model. Sending remains disabled
until the current wording has a reviewed draft and calendar check.

Replacing the whole draft on every response would discard a selected
address or a manual time correction. `meetingDraft.ts` compares the new AI
result with the previous AI result and the current reviewed draft. It
updates changed inferred fields while preserving unchanged reviewed fields,
contact choices, additions and removals. Per-field revision counters also
protect edits made during a request. An explicit new email in the wording
is a new choice, even if it belongs to the same profile.

The contact lookup receives `Store.getPeopleWithScores()` directly from the
running service. This is the same source used by IntelliSense and meeting
detection; the meeting composer introduces no separate interaction formula.
The canonical score already combines the profile's unique aliases, so it
must not be summed again for every matching name. Both AI interpretation
and manual contact search share this lookup. Ranking suggests likely
contacts; choosing among namesakes or a profile's multiple addresses stays
visible in the review.

Tests cover alias scoring and live score updates, merging manual edits,
automatic person and time appearance, responses arriving out of order,
failed interpretation and retry, and the existing desktop/mobile send flow.
The browser fixtures use synthetic contacts and intercept creation.
