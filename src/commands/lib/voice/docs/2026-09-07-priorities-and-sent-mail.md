---
created: 2026-09-07
updated: 2026-09-07
---

# Priorities need current evidence

A voice conversation could recommend an old report task as unfinished, give
generic reasons for its importance, and have Sunny repeat the conclusion.
When the user said the report had already been sent, Sky browsed the Inbox
and asked for details he could have searched using the existing conversation.
Shorter greetings did not address this failure of judgment and retrieval.

The initial notebook context is a bounded snapshot. Recent daily summaries
can omit completion records, and a task's appearance in a plan is not proof
that it remains undone. Sky's browser instructions now require an actual
current task read for daily or weekly recommendations, with reuse of relevant
results already fetched during the call. If delivery status affects the
choice, he checks Sent. The user's correction that work is done takes
precedence immediately; checking supporting evidence does not make accepting
the correction conditional on proof.

## A focused mailbox read

The browser had label listing and thread reading but lacked a targeted search
that retrieved matching messages. The voice-local `search_email` tool now
uses Gmail query syntax and the existing account resolver, authenticated
client, and message decoder. It searches message IDs and reads each matching
message, rather than treating another reply in the same thread as evidence
of what the user sent.

Results carry the actual SENT label, Gmail timestamp, recipients, subject,
and bounded readable content. A topic match alone does not prove all task
requirements were satisfied. Empty results, unreadable matches, partial
pages, oversized responses, account ambiguity, and cancellation retain
distinct outcomes. The tool allows at most five messages, twenty seconds,
one MiB per HTTP response, three thousand bytes per message body, and
thirty-two thousand bytes of serialized output. All Gmail operations use GET.
No shared mail commands, CLI tools, or chat wiring were changed for this fix.

## Give Sunny the evidence

Previously Sunny could hear Sky's conclusion about mail or tasks without
receiving the tool result that supported it. The browser now mirrors the
read-only task and mail results alongside existing quick notebook and web
lookups, before processing a same-turn speaking invitation. Shared excerpts
are bounded and explicitly marked when truncated. Draft and action results
are outside this source-evidence feed.

Sunny's instructions ask her to examine the premise, distinguish Sky's
opinion from independent evidence, and contribute a concrete reason,
tradeoff, or next move. Agreement can be brief; repeating the whole answer
does not add another evidentiary source. She has no tools in her speaking
session, so asking Sky aloud to search does not itself launch a lookup.

## Verification

The targeted voice, browser-controller, route, and settings suite passed
112 tests. New cases cover matching sent-message evidence, received replies,
account ambiguity, empty and partial results, pagination, response limits,
cancellation, and evidence arriving before Sunny's invitation. The full
`bun run dev:check` gate passed.

A live browser call used the production Realtime model, prompts, controller,
routes, and mail tool with synthetic notebook records and Gmail responses.
On a completion correction, Sky called `search_email` with `in:sent Atlas`,
read the actual matching message through the Gmail adapter, and confirmed
its sent date and recipient without an Inbox detour or a request for a
subject line. This checks the application's real retrieval path with fake
mail; it is not a verification of any user's actual mailbox.

The first priority probe still answered from the snapshot without a current
task read. Conditional wording avoided a false claim but left searchable
uncertainty to the user. The prompt was made explicit that even a same-day
snapshot does not satisfy the current-record check.

The next live probe passed: Sky called `day_items` and then `search_email`
before choosing the Widget scope decision. Sunny's follow-up cited the email
body's completion detail, which Sky had not said aloud, demonstrating that
the underlying evidence reached her. Both voices produced audio and the call
ended cleanly. The remaining padded acknowledgement exposed another prompt
gap: the short-preamble rule named only notebook and web lookups. It now
covers quick task and mail reads too, with silence allowed.

A subsequent run still introduced the report as secondary work without
checking Sent. This exposed an ambiguity in checking delivery only when it
"matters to your recommendation": the model could treat a second choice as
outside that rule. The rule now covers every recommended task, including
secondary actions. An irrelevant old task can be omitted entirely; mentioning
it as remaining work requires the relevant completion check. The speech rule
also covers thinking preambles before any tool has been chosen.

An explicit `medium` reasoning setting produced grounded task and Sent checks
in the later browser probes. The omitted-effort control still left report
status to the user; its session event did not disclose the server default.
The browser host now passes `BROWSER_VOICE_EFFORT` explicitly. These are small
behavioral probes, not a statistical latency or accuracy benchmark; the runs
also made different tool calls.

Shorter-wording rules and a channel-specific silence instruction did not
reliably suppress preambles. The live stream identified those messages as
`commentary`, while the useful answers were `final_answer`, matching the
[Realtime channel documentation](https://developers.openai.com/api/docs/guides/realtime-models-prompting).
In the recorded stream, `response.output_item.added` exposed the commentary
phase before audio-buffer playback started. Function calls arrived after
commentary generation, so cancelling the response to remove its preamble
would risk cancelling the actual lookup too. Playback filtering belongs in
the browser, separately from response completion and tool execution.

The controller now tracks output-item phases and transcripts per response.
Marked commentary mutes its audio sink and is omitted from displayed and
mirrored speech. Final and unknown/legacy phases restore playback when that
connection owns the floor. The response keeps generating, its tools still
execute, and the normal buffer drain prevents overlapping participants.
Regression cases cover the actual commentary-then-tools flow, later final
speech, multiple audible items, unknown phases, stale events, and barge-in.

There is a playback boundary limitation: if commentary and final speech are
generated within the same response, the final phase can arrive while a tail
of commentary remains queued in the shared WebRTC stream. Restoring playback
can expose that tail. The controller preserves final speech rather than
speculatively clearing an audio buffer that may already contain the answer.
The observed tool flow has its final answer in a later response and avoids
this ambiguity.

Final validation passed 116 targeted tests and the full `bun run dev:check`
gate. A live browser replay observed the actual HTML audio sink: it was muted
before commentary-buffer playback began and stayed muted through its stop;
Sky's and Sunny's final-answer buffers were unmuted. Commentary reached
neither intermediate/displayed turns nor mirrored conversation. No response
was cancelled, the notebook lookup executed, the current bottleneck was
recommended, and End closed both connections cleanly. Sky omitted the
irrelevant old report in that replay; the earlier explicit Sent-search and
message-read probe remains the evidence for delivery verification.
