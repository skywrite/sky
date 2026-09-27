---
created: 2026-09-25
updated: 2026-09-25
---

# Jev picks the moves

The first browser driver reads the page with the reasoning model. It
works, and it takes a few seconds a move. TypeSafe's Jev is a different
kind of model: it does not write, it chooses, in a fraction of a second,
from options you hand it. The browser-use team showed the shape in
jev-ultrafast: turn the page into a numbered table of controls, ask Jev
which operation and which row, run it, look again.

Before building, one request per page on a synthetic brokerage portal:
on the sign-in page Jev chose "ask the person" at 95%; on the documents
page it chose the 2025 download over the 2024 one at 100%; with the
download in the history it said "done" at 99%. Each answer took between
a hundred and three hundred milliseconds and about a thousand tokens.

## What was built

A second loop beside the first, sharing the browser server, the task
folder and the sign-in handoff, behind an Experimental switch. Code owns
the loop. The table comes from the accessibility snapshot with bounding
boxes, so it spans frames and knows what is off screen. Every question
goes in one request. Every answer is checked before a move. The gates
live in code: done, the person, a risky move, a page that stops changing.
Qwen 3.8 on Cerebras writes what goes into a text field, a fixed pairing
for speed, never into a field that reads like a password.

## What the first real site taught

On a real brokerage, signed in, Jev kept asking for the person: the page
carried a sign-in link beside the person's own name, and Jev read the
link. And when a click was blocked by an overlay, Jev clicked it again.
Both are reading problems, and Jev does not read. So the language model
beside it, Qwen on Cerebras, now reads at exactly those moments: a page
seen for the first time, a failed move, a page that did not change, Jev
wanting the person. It hands Jev a one-line plan, says whether the page
truly needs the person, and when it is sure of the move, makes it. The
same model finishes the job: opens each downloaded file, checks it, saves
it where the task says, and writes the report.

## What it is not

It reads text only, so a page whose answer sits in a picture is beyond
it. Synthetic portals and one brokerage are not the web; the switch is
there so the two drivers can be compared on more.
