---
created: 2026-10-07
updated: 2026-10-07
---

# Rel missed what the clipped transcript hid

## What was wrong

A saved chat about a memo from a colleague carried only the colleague in
`rel:`. The organization the reply discussed nine times, the video the chat
was about and the note it was about were all missing until the owner added
them by hand. Re-running the save's three choosers over the saved
conversation, read-only, reproduced it:

- The entity chooser never saw the organization. Before extraction the
  transcript was packed to 8k characters with each reply clipped to 1,200.
  The chat was one 57-character question and one 8,100-character reply, so
  the chooser read 15 percent of the conversation and zero of the nine
  mentions. Three runs out of three proposed only the colleague.
- The document pass found the video and the note in one run of three. Its
  first step asked a fast model to notice references in the text; in two
  runs it emitted no mention for either, so the matcher had nothing to judge.
  The matcher was also told that records created by the conversation do not
  qualify.
- Nothing recorded any of this. The save keeps no trace of what it extracted
  or matched, so the only way to learn why a rel was missing was to run the
  choosers again.

## What was rejected

- **Raising the per-reply clip.** The packing exists because the classifier
  prompts keep only the head of a long body; a bigger clip moves the cliff,
  it does not remove it. Extraction had to read every window.
- **Showing the extractor the context paths.** The resolver's own note warns
  that candidate paths turn a general topic into an invented reference to a
  background file. Detection still sees only conversation; the deterministic
  pass reads phrases, not files.
- **Trusting the saved file as the automation's output.** The file after the
  fact mixed the chooser's output with the owner's corrections. The
  automation's own result had to be reproduced to be diagnosed.

## Why the fix works

- Rel reads the full conversation with timestamps. Extraction runs over
  overlapping 8k windows and unions the subjects; the selector reads the
  passages naming each subject within its own budget, so the evidence that
  produced a candidate is the evidence that judges it.
- Explicit phrases ("today's memo", "this evening's Loom", "Jane's deck from
  yesterday") become mentions by rule, dated from the message that said them.
  They pass through the same candidate search and the same matcher, so
  precision is unchanged while recall no longer depends on a model noticing.
  A dated mention also offers that day's context documents as candidates.
- Reference extraction runs on the balanced role; reading references is
  judgment, not lookup.
- A writing tool's result that names documents it created reaches the
  session through a created-documents hook, and the save writes them into
  rel as facts. A chat that wrote a note is about that note.

Recording each save's enrichment decisions belongs with the chat log sidecar;
until then a miss is still diagnosed by re-running the choosers.
