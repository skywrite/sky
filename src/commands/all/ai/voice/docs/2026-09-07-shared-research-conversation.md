---
created: 2026-09-07
updated: 2026-09-07
---

# Shared research needs an explicit conversation order

A request such as "Sky, give me a public overview of heat pumps; Sonny,
compare it with our notebook" lost its division of work. Standalone deep
research rules gave every deep result to Sonny, allowed his notebook run
to search the web, and deliberately suppressed an automatic Sky recap.
Consequently Sonny could return two separate reports without a combined
conclusion. The rules intended to prevent duplicate answers also suppressed
the user's requested overview and synthesis.

The browser-local `research_together` operation makes the two assignments
explicit. Sky's public lookup and Sonny's notebook-only investigation start
concurrently. Each question has its own argument, and the notebook-only
constraint removes public retrieval tools from that research run. This
preserves speed without making the internal comparison wait to begin.

Retrieval completion does not determine speaking order. A shared exchange
holds the two results, its current stage, and whether that stage is queued.
The existing report queue carries Sky's web overview, Sonny's notebook
comparison, and Sky's synthesis. A stage remains queued while playing or
paused, and advances only after completed, nonempty speech has drained.
This reuses interruption and resumption rather than creating a second
playback mechanism. A failed source remains a specific limitation; it does
not erase successful findings from the other source.

Sonny's speaking session receives fresh public evidence before presenting
the notebook comparison, even when his investigation finishes first. Sky
receives both retained results and the spoken exchange for her final turn.
Presentation turns retain the speaker's full persona and cannot start tools.
The last turn explains an implication or gap rather than repeating both
reports. Standalone deep research still yields directly to Sonny.

The prompts also put both identities before notebook context and recognize
"Sunny" as Sonny's spoken name. Presence checks addressed to him invite him
directly. Previously an explicit example let Sky answer those herself,
contradicting the greeting handoff instructions.

## Verification

The focused suite passes 106 tests, including both retrieval completion
orders, public/private question separation, source failures, and interrupted,
silent, or refused playback at every stage. The full development gate passes.

Live Realtime text probes with synthetic notebook context selected
`invite_sonny` for "Sunny there?", selected one `research_together` call for
the split assignment, and referred to Sonny with he/him. Probes using the
actual presentation instructions produced a useful notebook/public comparison.
The first synthesis repeated too much; narrowing the last turn to one or two
sentences shortened it substantially, but some overlap with Sonny's conclusion
remained. These checks do not verify microphone transcription or audible style.
