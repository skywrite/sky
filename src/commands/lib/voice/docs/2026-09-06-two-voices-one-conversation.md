---
created: 2026-09-06
---

# Two voices, one conversation

Status: a design, nothing built. Three decisions wait on the user and
are listed at the end.

The ask: talk to two agents with different voices. One of them does the
deeper research and leaves the conversation for thirty to sixty seconds
while the user keeps talking to the other. Effectively a three-way
conversation.

## The constraint that shapes it

A Realtime session has one voice, and the SDK's own documentation of the
`voice` field says it "cannot be changed during the session once the
model has responded with audio at least once" (`openai` 7.4.0,
`resources/realtime/realtime.d.ts`). Two voices therefore means two
Realtime sessions, and two WebRTC calls open on the Talk page at once.

That second call already exists in another guise. The audition page
opens a receive-only call per voice, with no microphone, and asks for
one response. The researcher rides the same transport.

Two more facts from the same file. `turn_detection` may be `null`, or
keep VAD with `create_response: false` and `interrupt_response: false`,
in which case "the model will never respond automatically but VAD events
will still be emitted". And `response.create` accepts
`conversation: 'none'` for a response that joins no conversation.

## The shape

**Sky stays the host.** Sky keeps the microphone, turn detection, the
greeting, and the live tools: day lists, Slack, Gmail, today's calendar,
general knowledge. Sky stops calling `ask_notebook` itself. Instead Sky
has a tool that hands a question to the researcher by name, and the page
routes that call to the researcher's session without touching the
service.

**The researcher is a second session** on the same model, with its own
name, voice, and persona prompt. It has no microphone and no turn
detection, so it speaks only when the page asks. It follows the
conversation as text: every line the user says and every line Sky says
is mirrored into its session as a message item, and its own transcripts
are mirrored into Sky's. Both agents know everything that was said. Only
Sky hears the user live.

**Leaving is a tool call in flight.** The researcher has one tool:
today's `ask_notebook` deep job (`commands/lib/voice/notebookAgent.ts` —
`ai:context:files` selects the documents, the reasoning model reads them
and answers for the ear). Handed a question, it says it is going to
look, calls the tool, and its session sits with that call outstanding
for as long as the research takes. Sky's session is free the whole time.
The last verified run of that job took 22 seconds; a deep read can run a
minute or more.

**Coming back is floor management on the page.** When the output lands,
the researcher waits for a gap — no Sky response active, the user
silent — and then the page sends its `response.create`. The user's
`speech_started` cancels whoever is speaking: Sky by the server, as
today; the researcher by `response.cancel` plus
`output_audio_buffer.clear` from the page. Sky's deferred responses wait
while the researcher speaks. Nobody talks over the user.

**The user can address the researcher directly.** Sky's prompt says a
question addressed to the researcher by name is not Sky's to answer, and
hands it over. The researcher answers in about a second from what it
already found, or says it needs to look again and leaves again.

## What it sounds like

The name is a placeholder until one is chosen.

> **User:** Scout, what did I decide about the pricing tiers last month?
>
> **Scout:** Give me a minute, I'll go through the notebook.
>
> **User:** Sky, what's on this afternoon?
>
> **Sky:** Two things. The design review at two, and a call with Jane
> Doe at four.
>
> **User:** Add a reminder to send Jane the deck before that.
>
> **Sky:** Added to your professional reminders: send Jane the deck
> before four.
>
> _About forty seconds after it left, at the next pause._
>
> **Scout:** Back. On the eleventh you settled on three tiers. On the
> nineteenth you dropped the middle one after the pricing call.
>
> **User:** Scout, who was on that call?
>
> **Scout:** Jane and the finance lead. That's from your meeting note on
> the nineteenth.

## What it costs, what stays

The researcher's session takes text in and audio out. No second audio
stream is billed; its input is the mirrored transcript and its output is
a few sentences per return. The deep job is the same model read as
today.

The terminal `ai:voice` keeps one voice. Its WebSocket transport and the
Swift audio helper carry one PCM stream each way, and the web page is
the surface this design is for.

## To verify live, not assume

- **Echo.** Both voices play through the same speakers. The browser's
  echo cancellation on the microphone track is what keeps Sky from
  hearing the researcher. Test with speakers, not only headphones.
- **A restart mid-research** loses the job the way it loses a thread
  today. The researcher should say it lost the thread, not go silent.
- **Mirrored items.** A message item added while no response is active
  must not start one. The API responds only to `response.create` or a
  VAD stop, and the researcher has neither, but the run should prove it.
- **The headless loop** from the web voice build — fake microphone, a
  spoken question, the tool round trip — is the acceptance run, extended
  to two calls.

## Where the build sits

- `commands/lib/voice/sessionConfig.ts` — a `researcherSessionConfig`:
  no input audio, `turn_detection: null`, one tool, its own voice and
  instructions, beside `voiceSessionConfig` and `auditionSessionConfig`.
- `commands/lib/voice/prompts/` — a researcher persona prompt (name,
  role, how it leaves and how it returns) and a handoff section in
  `voice.prompt.md` (never answer notebook questions yourself; a name
  addressed is a handoff).
- `service/handler/voice/` — the thread carries two session configs;
  `POST /voice/:id/session` mints two secrets, or a sibling route mints
  the researcher's. `/tools` is unchanged: `ask_notebook` is called from
  the researcher's connection. Sky's handoff tool never reaches the
  service.
- `service/handler/theme/client/voice.tsx` — the bulk. One `Connection`
  becomes two, so the file splits: a per-call connection module (peer
  connection, data channel, events, tool loop), a floor manager (who may
  speak; pure, unit-tested), and the hook that owns both calls and the
  mirroring. Transcript rows carry the speaker's name.
- `/settings/voice` — a second picker for the researcher's voice
  (`voice.researcherVoice`), and the audition page labels both slots.
- Tests: the session config's shape, the second secret on the route, the
  floor rules, the prompt guards.

## Open decisions

Taste decisions are the user's. Each carries a recommendation.

1. **The researcher's name.** One clear word the transcriber will not
   mangle, and nothing like "Sky". Candidates: Scout, Quill, Ada,
   Marlow. Recommended: Scout — a scout goes ahead and reports back.
2. **The researcher's voice.** From the three shortlisted at the 08-30
   audition: `marin`, `sage`, `verse`. Recommended: a female voice, for
   immediate contrast with Sky's `ash`, auditioned first.
3. **Scope.** Either all notebook research moves to the researcher —
   Sky is now, the researcher is memory — or the researcher takes only
   deep questions and Sky keeps quick lookups. Recommended: all of it.
   Sky waits the same time today, and "is this deep?" is a judgment the
   realtime model will get wrong sometimes.
