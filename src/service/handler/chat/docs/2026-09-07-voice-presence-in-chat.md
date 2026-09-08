---
created: 2026-09-07
updated: 2026-09-07
---

# Voice gets its own presence within the thread

The first integration placed live speech above the typed composer and kept
the transcript on screen. A visual conversation with Sky and Sonny needs
space for the speakers: connecting and live voice now replace the visible
thread with the voice presence component. The existing call controls stay
below it. Text tuning, the context rail, and the thread's save controls are
out of the way until voice ends.

Replacing the whole text subtree would also replace the uncontrolled
textarea and lose a draft. The thread and composer therefore stay mounted
under explicit hidden styles. The live transcript continues accumulating
there, and the same textarea returns when the call ends. Submission is
disabled while voice owns the surface, during connection preflight, and
until the transcript handoff succeeds.

Voice presence is selected only for the controller's starting and live
phases. Before the connection starts, the chat performs its existing bounded
preflight read with the text surface still visible. Ended and failed phases
restore text immediately, including pending speech while the service keeps
it. The call status and retry action sit outside the hidden composer, so a
failed connection or handoff remains recoverable. Successful handoff still
replaces the temporary spoken turns with the chat's retained exchanges.

This changes the conversation's presentation, not its persistence: both
speakers receive prior messages, ending voice keeps the delivered speech,
and later text replies and Save & close use the existing transcript path.

## Three-dimensional speech

The portraits use real skeletal GLB models with Oculus visemes and ARKit
eyelids, derived from MIT-licensed Microsoft Rocketbox assets. Sky's materials
are blue and Sonny's are amber/red, with the original atlas detail retained
for eyes, lips, and hair. The asset provenance and license live beside the
GLBs in `theme/client/assets/voice/`. These are rigged approximations of the
visual concept, not geometry recovered from its generated image.

`VoiceAudioLevels` taps the two remote MediaStreams independently. HeadAudio
infers visemes locally from the audio; its model and worklet are served by
the same application, and the PCM does not go to an avatar service. The
existing HTML audio elements remain the only audible route, retaining the
chosen speaker device and the controller's interruption/muting rules. The
analysis context is unlocked in the voice-start gesture before the chat's
preflight awaits. Ending or leaving the call closes it and late-loading nodes.

The renderer samples playback and morph values in an animation frame loop.
Muted, paused, replaced, stopped, or silent audio closes the mouth. Model
generation and incoming transcript events never open it. The adapter also
corrects HeadAudio's falsy check for viseme ID zero (`viseme_aa`), so the open
vowel is not lost. This is real-time audio classification, with approximate
phonetic matching and the classifier's roughly 50–100 ms processing delay;
the conversation's audio is not delayed to compensate.

The stage preserves the call on graphics/analysis failure and offers a
portrait retry. GPU resources are disposed when it unmounts. Reduced motion
disables idle head movement and blinking, keeping the speech articulation.
