---
created: 2026-09-08
updated: 2026-09-08
---

# Cloud forms replace human avatars

The human avatar experiment made voice feel less alive. The stock facial rigs
and their approximate mouth movements also introduced model downloads and a
local phoneme classifier that the intended experience no longer needs.

Voice now uses two softly asymmetric cloud forms. White wisps move through a
blue/periwinkle volume for Sky and an amber/coral volume for Sonny. The form has
a defined, softened boundary with depth inside it. It is generated from a shared
periodic density field; there are no faces, photographs, model assets, or avatar
service calls. Both characters share the same rendering and motion behavior,
with separate palettes and animation phases.

The renderer uses Three.js WebGPURenderer and portable TSL nodes, retaining its
WebGL2 fallback. CPU noise bytes are shared between the two instances, while
each canvas owns and disposes its own GPU resources. Idle motion and deformations
freeze under reduced motion. Hidden tabs pause rendering without interrupting
voice playback, and resuming does not advance the animation by the hidden time.

VoiceAudioLevels remains a read-only tap on the existing remote MediaStreams.
HTML audio keeps exclusive responsibility for sound, the output device, muting,
and interruption. Smoothed amplitude drives the cloud's flow, slight expansion,
and illumination. Silent, muted, paused, ended, or replaced playback clears the
associated amplitude. No transcript or network event directly drives the shape.

The old GLB files, their route allowlist, and the HeadAudio dependency are removed.
The conversation presentation and retention contract remains the same: no chat
or spoken transcript while voice is active, and the draft and retained exchange
return when the call ends. The earlier
[voice-stage note](2026-09-07-voice-presence-in-chat.md) records the retired avatar
experiment and the still-current text handoff rationale.
