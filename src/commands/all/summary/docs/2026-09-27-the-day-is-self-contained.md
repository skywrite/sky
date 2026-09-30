---
created: 2026-09-27
updated: 2026-09-27
---

# The day is self-contained

The daily summaries of September ran 92 to 171 lines against the prompt's own 40 to 80. The opening sentence was 44 to 54 words every day. Signals and Learned were never empty. And two sections were not being read: Commitments Made and Waiting On, because they did not feel accurate. A promise made Tuesday and kept Wednesday sat in Tuesday's table forever, and no line could be checked without re-reading the day.

The fix is not a new shape. The sections stay as they were, because they read well. What changes is what a line is allowed to be.

**Every line names its source.** A bullet ends with the medium and time of the file it rests on; a table row has a Source column. A line that cannot name a file is not written, which is the old "grounded, or absent" rule made checkable.

**The day is self-contained.** The summary is written once, and days are sometimes ended out of order. So the file may not hold anything that depends on another day. Commitments Made and Waiting On record only what was said that day. The running count on a streak never appears; `lib/streaks.ts` gives the model one Health row with the day's completion and nothing else, and the prompt forbids streaks in Done or Not Done. The balance across days belongs to the app, computed from the files when it is read.

**One fact per bullet, under 25 words.** The glance is one short sentence.

**Learned becomes Insights.** What the day teaches, drawn from the whole day: Lessons-Learned journal entries first, then what was voiced, then what the evidence shows, each with its source. The weekly prompt follows the rename.

**Where Things Stand, last.** One line per matter the day touched and its state at day's end, in the body where it can be read. It is the day's index: search lands on that line, and the weekly summary follows a matter across days instead of merging seven days of sections.

Nothing here changes how the model is called or what it reads. The prompt and one small library are the whole diff.
