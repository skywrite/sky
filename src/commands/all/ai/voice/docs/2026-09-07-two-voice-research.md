---
created: 2026-09-07
updated: 2026-09-07
---

# Two voices with notebook research

Voice previously asked one stateless delegate for every missing notebook
fact. That delegate ran the Haiku/Sonnet document-selection chain before
one reasoning-model answer. A simple lookup paid for several model calls,
and a difficult question could not follow a new lead after reading its
first sources. Sky also had to carry the conversation and the research
return in the same voice.

The browser implementation keeps Sky as the conversational host, adds a quick
Qwen lookup, and lets Scout investigate with Astra while the conversation
continues. These changes live in voice; they do not change text/chat
model roles or extract a new library shared with chat. The terminal retains
its existing single voice and `ask_notebook` delegate, plus the earlier
initial-context improvement. The new two-voice research experience does
not extend the terminal transport.

## Speech and research are separate

Sky and Scout each have a `gpt-realtime-2.1` speech session. Sky normally
uses `ash`; Scout normally uses `marin`. Sky receives the microphone and
has the available live-action tools plus `lookup_notebook` and
`research_notebook`. Scout receives text, has no action tools or microphone,
and speaks only when the transport gives her a completed report and a turn.

Two sessions are necessary because a Realtime session's voice cannot be
changed after it has emitted audio. The transport retains VAD events while
disabling automatic response creation, then requests responses itself.
See OpenAI's [Realtime conversation controls](https://developers.openai.com/api/docs/guides/realtime-conversations)
and [GPT Realtime 2.1 model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1).

Scout's reasoning is `gpt-6-astra` at high effort. The second Realtime
session presents its findings; Astra itself does not support audio input
or output. See the [Astra model capabilities](https://developers.openai.com/api/docs/models/gpt-6-astra).

Both speech sessions and both research modes receive the bounded initial
notebook context described in the [starting-context note](2026-09-07-voice-starting-context.md).
Completed user and assistant turns are mirrored as labelled text between
the speech sessions. An interrupted generated utterance is not mirrored
as though the user heard all of it. Research runs receive self-contained
questions; they do not own the live conversation.

## Two retrieval budgets

`commands/lib/voice/research.ts` owns both SDK tool loops. They start with
a tool call and reserve the last model step for the answer.

| Mode | Default model/profile | Model steps | Time limit | Tool calls | Read bytes |
| --- | --- | --- | --- | --- | --- |
| `lookup_notebook` | `default-cerebras-qwen-3.8` | 4 | 20 seconds | 6 | 24,000 |
| `research_notebook` | `default-gpt-6-astra-high` | 10 | 180 seconds | 24 | 160,000 |

The fast mode clones the default Qwen profile with `reasoningEffort: none`.
It leaves the shared profile intact. Cerebras documents `none`, `low`,
`medium`, and `high` for Qwen 3.8; `none` disables reasoning and `high` maps
to Qwen's native extra-high mode. The low-latency lookup therefore opts
out of the shared profile's high setting. Explicit alternative profiles
retain their settings. See [Cerebras reasoning controls](https://inference-docs.cerebras.ai/capabilities/reasoning).

`researchTools.ts` provides a closed set of deterministic read-only tools:

- `search_notebook`: the service's ranked keyword search, at most twelve
  results. Every supplied word must match, so the model chooses short
  topic terms and can try aliases or broader wording.
- `query_notebook`: structured document-type, date, relationship, path,
  and body-substring filters. Code creates the GraphQL query; the model
  cannot send arbitrary operations. At most twenty paths are returned.
- `read_file`: notebook-relative markdown reads. Real paths must remain
  inside the notebook, including through symlinks. Reads are bounded to
  12,000 bytes for lookup or 20,000 for Scout, with an explicit continuation
  offset and a separate total byte budget. Chunks stop before an incomplete
  UTF-8 character so continuation preserves the source text. Offsets refer
  to original file bytes, and overlapping bytes still count toward the
  budget. A failed open or read releases its unused reservation.

GraphQL store paths may be absolute; they are normalized at the service
response boundary. Model-supplied read paths still must be relative.
Service requests have five-second timeouts and no retry chain. Empty,
failed, capped, and unreadable results remain distinct evidence limits.
If no source was read, the engine returns that limitation rather than
passing through an unsupported model answer.

Scout can search, read a clue, search a newly discovered name, read the
next source, and compare the accounts before answering. This is the
additional capability that a single synthesis call after fixed document
selection could not provide.

## Conversation and lifecycle

The browser uses two WebRTC connections. Sky acknowledges a deep research job
immediately and continues the conversation. Scout waits for a gap after
generation and playback finish. A finished model response does not by
itself release the speaker while audio is still queued. Conversely, a
cancelled response that never started playback must release its speaking
turn without waiting for a buffer-stopped event that may never arrive.
That race was reproduced with real browser audio before the fix.

User speech interrupts playback. Interrupted or failed Scout reports remain
paused until **Resume Scout** is selected or the user asks Scout to
continue. Sky handles the spoken request through the transport-local
`resume_research` tool. Both paths replay saved findings without another
Astra run. A rejected `response.create` also retains the report for retry
and releases the speaking turn. Report evidence is supplied to Sky, so a
follow-up can use findings without pretending an interrupted report was
fully spoken.

End cancels active research, closes both speech connections, and discards
late callbacks. The service tracks each call's lifetime so a tool response
cannot resurrect an ended thread. Thread reconstruction interrupted by
End returns an ended response. A tool takes an independent service activity
hold: Scout's three-minute budget can exceed the browser conversation's
two-minute timed hold, and a source-triggered reload must wait for the job.

`voice.voice` and `voice.researcherVoice` are independent settings. The
settings page previews both and includes the female voice group; Scout
defaults to `marin`. These group labels reflect the app's listening choices,
not gender metadata from the API. Changes apply on the next call.
The browser uses the default lookup and research profiles above; the
terminal's existing model and delegate flags retain their earlier meaning.

## Verification recorded on 2026-09-07

- The full `bun run dev:check` gate and 71 targeted tests passed.
- A synthetic live browser run passed with real `ash` and `marin` sessions,
  Qwen lookup, and Astra comparison. Sky answered a separate spoken
  arithmetic question while Astra researched. Scout delivered findings,
  user speech interrupted her, and **Resume Scout** replayed the saved
  report with only one Astra job across the interruption and resume.
  Both peers received audio; playback buffers drained with zero overlapping
  playback intervals and zero browser or API errors. End closed both peers.
  The isolated synthetic notebook files were removed afterward.
- Live Qwen/Cerebras lookup over a temporary synthetic notebook returned
  a mock person's correct job title in 0.98 seconds: two model calls and
  one source read.
- Live Astra research over the same isolated notebook took 17.27 seconds:
  seven model calls, three distinct searches, and three source reads.
  It followed an Atlas plan to a Harbor review and then a Northstar
  decision, compared the original and final target dates, explained the
  capacity constraint, and distinguished the plan from a completed launch.
- The live engine checks used the production notebook search and GraphQL
  server components over a synthetic `MarkdownStore`. No actual notebook
  records were used, and the temporary files were removed. These are small
  smoke tests, not latency guarantees.
- Mock SDK tests cover follow-up searches based on newly read evidence,
  profile isolation, empty versus failed search, path traversal and symlink
  rejection, UTF-8 continuation reads, released byte reservations, bounded
  synthesis, and cancellation.
  Service tests cover two secrets, cancellation, late calls, reconstruction,
  approval behavior, and the tool's reload hold.

Physical speaker-to-microphone echo cancellation and the feel of live
human interruptions require device testing. Synthetic browser audio and
the engine smoke runs above do not establish those physical properties.
