---
created: 2026-08-09
updated: 2026-09-05
---

# google:agent — the mission loop and its reliability ladder

A mission is one `streamText` run (`mod.ts`): `MISSION_PROFILE` (Qwen 3.8
on Cerebras, on trial since [2026-09-03](../../../../../_shared-ts/ai/docs/2026-09-03-cerebras-provider.md))
with the agent tools — or the profile named by `--reasoning`, e.g.
`default-opus-5` for the deep run — up to `MAX_STEPS = 48` steps, final
text = the report. A create-only mission runs without a go; a mission on an
existing file, or an import, asks once per file per chat
(`lib/approval.ts`). Two properties of
that loop are non-obvious and load-bearing:

- **A text-only turn ends the mission.** The loop continues only after tool
  calls; prose with no call is taken as the final report. The agent prompt's
  Discipline section bans "narrating a next step" for exactly this reason —
  a model that writes "Let me read the rest" instead of calling the tool has
  just ended its own mission.
- **Deep thinking is visibly silent.** During long thinks the API streams no
  visible parts for minutes — only keep-alive pings prove the transport is
  alive. Anything that equates "no visible parts" with "dead" will execute
  healthy missions (see the [2026-08-09 shakedown](2026-08-09-contract-review-shakedown.md)).
- **Every step replays the whole mission.** The cache breakpoint moves to
  the step's last message before each model call (`prepareStep:
  cacheTailStep`), so the replay is a cache read; without it a mission's
  input grows with the square of its step count
  ([2026-09-03](../../../../../_shared-ts/ai/docs/2026-09-03-cache-tail-every-step.md)).

## The timeout ladder

Every layer must give up **before** the layer above it loses patience, and
each converts a hang into a typed failure the layer above can route around.
Changing any constant means re-checking the ordering:

| Bound | Where | Converts |
|---|---|---|
| 60s launch (`LAUNCH_TIMEOUT_MS`) | `lib/browserSession.ts` | a wedged Chromium launch → kill-and-retry (takeover), then a flow error |
| 90s stream idle × 3 (`STREAM_IDLE_MS`) | `#shared/ai/llm/anthropicProvider.ts` → `idleGuardFetch.ts` | a wedged model request → invisible in-place retry (pre-response) or a fast stream error (mid-body) |
| 90s warm-browser idle (`WARM_IDLE_MS`) | `lib/browserSession.ts` | a parked browser → closed, cross-process lock released |
| 120s lock wait | `lib/profileLock.ts` | another process's turn → `ProfileLockBusyError`, not a silent queue |
| 150s flow deadline (`FLOW_DEADLINE_MS`) | `lib/browserSession.ts` | a wedged page operation → browser closed under it, queue advances |
| 180s tool timer (`TOOL_TIMEOUT_MS`) | `lib/tools.ts` | any hung tool → an error string the agent routes around |
| 360s stream watchdog (`STREAM_STALL_MS`) | `mod.ts` | a truly dead stream → mission aborted with a files-touched report |

Invariants behind the ordering:

- **flow deadline < tool timer** — a wedged browser flow surfaces as one
  failed tool call, and the closed browser frees the queue; before this,
  one wedge made every queued browser call time out in turn.
- **tool timer < watchdog** — every tool call answers within its window, so
  watchdog-level silence can only mean the model stream itself.
- **idle guard total (≈270s) < watchdog** — the transport gives up, retries,
  and errors before the mission-level abort ever has to fire.
- **warm idle ≤ lock wait** — a process waiting on the profile lock always
  outlasts the idle close that frees it.
- The watchdog counts **raw SSE frames** (`includeRawChunks: true`), so
  pings re-arm it through silent thinks; it starves only when even pings
  stop. A heartbeat line ("Still working — model thinking") prints every
  2 minutes of visible quiet so a long think doesn't read as a hang.

## The warm browser

Browser-hands calls (anchored comments, suggested edits) run through
`withGoogleBrowser`, which keeps the Chromium context **warm between
flows**: one launch serves a whole mission, and an idle timer folds the
session 90s after the last call. The launch→close boundary it removes was
both ~20s of overhead per comment and the wedge surface — rapid relaunch on
a persistent profile can hang Chromium outright. Recovery when a launch
still wedges: SIGKILL the holder, but only after `ps` proves the pid's
command line names our profile dir **and** carries `--headless` — the
visible `sky google:browser` sign-in window can never match, and keeps the
polite "already in use" error.

## Reading long files

`read_file` returns 40k-char pages; a truncated page ends with a
self-directing marker (`[Truncated — N chars total; continue with offset:
M]`) and the workflow prompt tells the model to keep reading. The progress
log distinguishes a full read from a first page (`first 40000 returned`).

## Every mission says how long

The mission uses the [shared timing system](../../../../../_shared-ts/timing/docs/README.md).
The closing line and notebook record retain profile, steps, model/tool time,
and per-tool counts, now with a trace ID and overlap/other measurements.
`lib/timing.ts` is a compatibility export for the record format. The command
trace also covers preparation and cleanup outside the mission's model loop.

## Stall forensics

Failures land in `~/…/logs/ai-errors.jsonl`: the transport guard logs
`anthropic-provider / stream-idle` events (with attempt and phase), and a
watchdog abort logs `google:agent / stream-stall` with the completed-step
count, the last **visible** event, and how many raw frames arrived after it
— the discriminator between a dead transport (raw = 0) and a killed think
(raw climbing).
A model request the host refuses logs `google:agent / model-error` with the
line the chat engine's `turnErrorMessage` builds — the host, the status and
the host's own reason, read from the body even when the SDK did not — and
the mission fails with that line, so a mission and a chat say the same
thing about the same refusal.
