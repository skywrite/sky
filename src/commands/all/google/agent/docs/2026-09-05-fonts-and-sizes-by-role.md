---
created: 2026-09-05
updated: 2026-09-05
---

# Fonts and sizes by role

A nine-tab Doc needed one typeface and one size scale. The mission ran on
the deep reasoning profile and took forty-three minutes: read an outline,
think, write a batch of `updateTextStyle` requests, read the outline again,
think again, per tab. Every step replayed the whole conversation, and at
the end nothing had checked the result except the eye. The thread showed
only "thinking" while it ran, which is what made the wait feel like a hang.

None of that work needs judgment. Which paragraph is a heading, which row
of a table is its header, where the text of a tab starts and ends — the
document says so. What a model spent minutes on per tab, code does in one
pass and can prove afterwards.

## What was built

- `#lib/google/docsRestyle.ts` — a spec (`fontFamily`, `sizes` by role,
  optional `tabIds`), a planner and a read-back. Roles: `title`,
  `subtitle`, `heading1`…`heading6`, `body`, `tableHeader` (rows flagged as
  header, else the first row of every table), `tableCell`. Table roles
  fall back to `body`.
- The plan, per tab: the family on one range over all text; sizes on
  coalesced ranges — adjacent paragraphs of one size share a range, a table
  gets one range for its cells and one per header row. No range reaches a
  segment's final newline. Requests go in batches of one hundred.
- Should the API refuse a range that spans table cells, the batch is
  resent with one range per paragraph; the planner keeps those fallbacks
  beside every table range.
- The read-back resolves what a run renders as — its own style, the named
  style, `NORMAL_TEXT`, the Docs defaults — because the API sets a field to
  inherit when a request writes the parent's value. It counts the visible
  runs, the matching ones, and names the first ten that differ with their
  tab and text. Tables of contents are skipped; Docs regenerates them.
- `restyle_doc` in the agent's toolset, and a prompt section that routes
  font and size missions to it. Only the fields the spec names change:
  bold, italic, colors, fills, alignment, spacing and content stay.
- Headers, footers and footnotes are separate segments and are left alone;
  the tool says so in its result.

## Rules

- Roles come from structure, never from reading the text.
- The tool changes only what it was asked for. Preservation is the default,
  not a step.
- Every restyle ends with a read-back. The result reports what the document
  says, not what was sent.
- The model's work is to decide the scale and name it once; the pass and
  the proof are the tool's.

## Verified

- `docsRestyle_test.ts` — a two-tab handbook plans nine requests in role
  order with tab ids and the final newline excluded; a family-only spec on
  one tab plans one; unknown named styles are left alone; the read-back
  counts inherited runs as matching and names a stray 9pt cell; the
  contents table is skipped; the spec validator names each problem.
- `tools_test.ts` — through the fake Drive and Docs APIs, one call reads,
  applies one six-request batch, reads back, and logs one line per batch
  plus the summary; a bad spec is refused before any call.
- Live: pending a mission on a real document — the range-over-table-cells
  shape has the per-paragraph fallback until then.
