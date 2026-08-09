---
created: 2026-08-09
updated: 2026-08-09
---

# legal:review — design

`sky legal:review <document>` reviews a legal document — contract, NDA, lease,
terms — and leaves the findings on a Google Doc as anchored comments and
suggested edits. It owns no analysis machinery of its own: it is a **brief
plus a composition** into `google:agent`, which supplies the tools (Drive,
Docs, browser hands) and the mission loop. The mission mechanics and the
reliability ladder live in [`../../google/agent/docs/README.md`](../../google/agent/docs/README.md).

## The composition contract (`review.ts`)

- The target param is named `document`, **deliberately not `file`**:
  `CommandService.run` merges the parent's args into the child, so a param
  spelled like `google:agent`'s own `file` would leak into the mission even
  when unset here.
- Both `file` and `import` are always passed to the child explicitly — one of
  them `undefined` — so a stale parent value can never stand.
- Resolution order: `resolveFileRef` (Google URL or bare id) first, then
  `resolveImportSource` (local path). A URL is never mistaken for a path; the
  bare-id regex (`[A-Za-z0-9_-]{20,}`) can never match a path, since `/` and
  `.` disqualify it.
- Local documents (`.pdf`, `.docx`, `.md`, `.txt`) are uploaded through
  Drive's import conversion (`importFileAsDoc`) — the resulting Doc becomes
  the mission target. Re-running with the same local path imports a **new
  copy**; re-runs should target the Doc URL from the first run.
- `@AIChatTool({ needsApproval: true })` surfaces the command in `ai:chat` as
  `legal_review`, so "review this contract" requests route here rather than
  through the generic `google_agent` import path.

## The anchored-comments contract

Findings must land as **real anchored comments** — text highlighted, comment
pinned to it — placed by the browser-hands path (`add_anchored_comment`),
because Drive's API forbids third parties from anchoring comments on editor
files: API comments render only in the file-level 💬 panel. For a contract
review, an unanchored finding loses most of its value, so the brief bans the
downgrade outright:

- The agent's `add_anchored_comment` tool description offers "fall back to
  `add_comment`" on browser errors. The brief overrides it: findings that
  cannot be anchored go into the closing **report** (severity, verbatim
  clause, what the comment would have said), never into the panel.
- The one legitimate panel comment is `[Summary] Contract review` — a
  whole-document note, which is what file-level comments are for.
- Suggested edits (`suggest_doc_edit`) carry concrete rewrites; if one cannot
  be placed, its anchored comment (which holds the reasoning) still stands.

Because the mission is pointless without the browser, `review.ts` preflights
before rendering anything: a Chromium-family binary must exist and the
automation profile (`~/.sky/google-browser-profile`, created by
`sky google:browser`) must be present — otherwise it fails fast with the
setup pointer instead of running a mission that could only degrade. Test
contexts (`CommandPlatform.Test`) skip the machine probe.

## The brief (`prompts/review.prompt.md`)

The reviewer works for the party who has to live with the document. Eight
coverage areas (money, time, exit, risk, ownership/confidentiality,
data/compliance, control, disputes), judged by effect rather than by whether
a clause "looks standard"; missing protections are findings in their own
right. At most 12 anchored comments, each opening `[High]`/`[Medium]`/
`[Low]`, lighter items folded into the summary. An optional `focus` argument
weights the review (e.g. `-f "indemnity and the renewal window"`) without
dropping other material findings. PDF-conversion layout damage is called out
as noise, not a drafting defect.

## Deferred

- A deterministic findings pipeline (structured `generateObject` pass feeding
  placement) — only if mission-quality reviews disappoint.
- Non-Doc mission targets, and uploading the original file alongside the
  converted Doc.
