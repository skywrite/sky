---
created: 2026-09-20
updated: 2026-09-20
---

# Sky learns from drafts alone

## What was wrong

One edit was written down twice. Learning shipped first and saved each
edit as an "example": the words before, the owner's words after, their
reason, and the lesson. The editor with version history shipped a day
later and saved each message as a "draft", which holds the same before and
after text and the same reason. Nobody merged them.

The owner opened `me/voice/` and found two folders for one act. Asked four
times why both existed, every answer described the code, not a need of
theirs. Their own picture was simpler: one file per draft shows each
modification, and Sky learns from that. It was also the better design.

## The rule

A lesson belongs to the version it was learned from. The version keeps the
question, the owner's exact answer, the lesson and any failure, beside
`learnFrom`, the version it is compared with. `examples/` is gone.

Sky's own wording never teaches. Only a version the owner wrote or
accepted is an edit; a version only Sky wrote has no `learnFrom`, and an
untouched draft has no record at all. That is what let the writer start
reading the drafts folder: every file in it is one the owner worked on,
and every version says who wrote it.

An edit from a place that kept no draft, the Settings page or a terminal
chat, becomes a draft when it is saved. A lesson always has a draft.

## Folding in

Nothing is deleted. When lessons are folded into the rules, their versions
are marked `folded` and the writer stops reading them there. The draft
file keeps the lesson under its version and says the rules now hold it.

The old design deleted example files after one atomic rules write that
also recorded their ids. The same shape survives: the rules write carries
a `folding` receipt, the versions are marked next, and the receipt is
dropped last. Between those steps the writer skips receipted lessons, so a
crash can never teach one twice.

## Reading lessons without reading every draft

The writer runs on every draft Sky writes, and the owner keeps drafts
forever. One empty marker file per draft, in machine state, names the
drafts that still hold an open edit. Each draft write sets or clears its
own marker under that draft's lock, so there is no shared index to race
on. A missing marker folder is rebuilt by one pass over the drafts.

Saving the same change from the same place twice must teach it once, also
after its lesson was folded in. That check alone reads every draft; it
runs only when a page or a terminal saves an edit.

## Rejected

Keeping `examples/` and moving it out of the notebook. It hides the second
folder and keeps the duplicate, its store, and its deletion protocol.

Showing the lesson in the draft file while still storing it in an example.
The file would then carry a copy that nothing reads, which is how the two
records drifted apart to begin with.

A migration that runs by itself. It would rewrite the owner's notebook the
first time unreviewed code started. Example files from before this change
are left alone and ignored; moving their lessons onto their drafts is an
explicit step.
