---
created: 2026-08-31
updated: 2026-08-31
---

# Automations — the machine's own jobs, on a page

Design notes for `src/service/handler/automations/` and the pages it
serves, `theme/client/automations.tsx`.

## What is built

`/automations` is a place of the Explorer/Settings rank, entered from the
sidebar foot. The overview renders one report: every charter in the
notebook `automations/` folder as a row — name, the brief's first line,
the schedule in words, what the last run amounted to, and an on/off
switch — plus a block for charters that could not be read, since a
charter that never fires looks exactly like one that had nothing to do.
`/automations/<name>` is one charter's page: the brief in full (rendered
with the document renderer), the schedule, the run ledger, Run now, the
same switch — and "Change it", where a sentence becomes a rewritten
charter, applied only on approval. `/automations/new` is the create
flow: describe the automation in your own words, read the proposed file
whole, turn it on. The sidebar swaps to the roster, one row a page, with
＋ New automation at its foot.

- `mod.ts` — the wire types and routes. `GET /automations/_api/status`
  carries every page. The writes are as narrow as they sound:
  `POST …/automation/:name/status {status}` flips the charter's
  `status:` line (a textual edit via the model's `setAutomationStatus`,
  so comments, key order and body come through byte for byte, written
  through a temp file); `POST …/automation/:name/run` is
  `automations:run` without a stamp — a forced run reports its outcome
  but never moves the schedule, and never enters the ledger;
  `POST …/draft {request, revise?}` is `automations:draft` — a model
  call that returns a complete validated charter and writes nothing;
  `POST …/create {name, contents}` writes a drafted charter as a new
  file and never overwrites (409 on collision); `POST
  …/automation/:name/save {contents}` overwrites one existing charter
  with an approved revision. Create and save both re-validate through
  `Automation.fromMarkdown` before touching disk.
- `commands/all/automations/draft.ts` — the AI authoring path, shared
  with the CLI (`sky automations:draft "…" [--revise <name>]`). The
  prompt carries the charter format, the trigger grammar, quiet hours,
  the real command catalog from the manifest, and the existing names;
  the draft is validated (`validateCharterDraft`: parseable, no unread
  keys, `run:` in the catalog, kebab name, no collision) with one
  retry that feeds the complaint back — nothing invalid ever leaves.
  Drafting never writes; approving is the separate step.
- `createAutomationsHost.ts` — production wiring: reads are one
  in-process `automations:status` run per request, so the page and the
  CLI can never disagree about charters, run-state, or due arithmetic.
- `theme/client/automations.tsx` — the pages. They speak person:
  triggers arrive as written (`EVERY-WEEKDAY 07:15`, `every 5m`) and
  render as words ("Weekdays at 7:15", "every 5 minutes"); outcomes
  render as "ran", "nothing to do", "couldn't run". Patterns outside the
  small vocabulary show as written, which is still words. Refetches on
  focus, once a runner tick (60s), and — via one window event — in every
  mounted instance the moment any write lands.

The run ledger is the state store's (`AutomationStateStore`): every
`record()` also appends to a bounded per-charter history (50, newest
first), so the detail page shows how a charter has been going, not just
its last word. Files written before the ledger read as an empty one.

## The rules it lives by

- No builder, anywhere. Creation and editing are sentences: the person
  describes, the model writes the file, and the whole proposed file is
  readable before anything is written. The proposal card shows When /
  Runs / Why plus "The whole file", because the file is the contract.
- The charter file stays the source of truth. The switch rewrites one
  line; a draft becomes real only through create/save, and a person
  editing the file by hand is always equally valid — the pages just
  read what the file says.
- "Nothing to do" is a result, not a failure — the row language keeps
  the runner's three outcomes distinct because a quiet automation and a
  broken one must never look alike.
- No invented data: there is no needs-you producer yet, so no needs-you
  surface; a forced run shows its outcome in the header rather than
  pretending to be a scheduled one.

## Verified

2026-08-31: route tests (`automationsRoute_test.ts`) with every write
scripted, model tests for the ledger, `setAutomationStatus`, and
`validateCharterDraft`, `bun run dev:check` stages, plus live runs —
the report against the running service, every page in a headless
browser light and dark, the View-file link landing in the explorer, one
real CLI draft and two real in-browser drafts (model calls; drafting
writes nothing), and every file-writing flow exercised in the browser
with the requests intercepted so nothing touched the real notebook.
