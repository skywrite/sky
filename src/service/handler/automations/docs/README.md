---
created: 2026-08-31
updated: 2026-09-07
---

# Automations — the machine's own jobs, on a page

Design notes for `src/service/handler/automations/` and the pages it
serves, `theme/client/automations.tsx`.

Descriptions and proposal previews follow the
[shared HTML selection rule](../../theme/docs/README.md#text-selection-and-rendered-html).

## What is built

Charters may declare `kind: system`; existing charters default to `personal` and keep their behavior. System jobs use this same scheduler, ledger, and pause control. The first is [Outbox](../../../../lib/outbox/docs/README.md); existing Slack/Gmail heartbeat capture jobs remain in place. Commands may return `data.outcome: nothing` so both scheduled and manual runs preserve quiet passes instead of reporting every success as work.

`/automations` is a place of the Explorer/Settings rank, entered from the
sidebar foot. The overview renders one report: every charter in the
notebook `automations/` folder as a row — name, the brief's first line,
the schedule in words, what the last run amounted to, and an on/off
switch — plus a block for charters that could not be read, since a
charter that never fires looks exactly like one that had nothing to do.
`/automations/<name>` is one charter's page: the brief in full (rendered
with the document renderer), the schedule, the run ledger, Run now, the
same switch — and "Edit automation", with direct command/condition controls
and the option to describe a change in words. `/automations/new` starts with
describing the automation. The generated preview offers **Customize**, which
opens command and condition controls already filled from that proposal.
**Choose commands instead** is a secondary option for direct setup and batches.
Read the proposed files, then turn them on. The sidebar
swaps to the roster, one row a page, with
＋ New automation at its foot.

Command completion searches names and descriptions from all installed command
sources, using the same local → global → core precedence as execution. The
Morning recaps preset selects the installed `recap:*` commands for 07:00 daily,
sets `day: yesterday` for commands with a date argument, and enables `noEditor`
where supported. Each command gets its own charter, switch and run ledger.
Days, time, intervals, time zone and an inclusive end date are selectable.
Existing complex schedules remain editable as their original trigger entries.
These controls expose scheduler conditions; they do not invent file-existence
checks or day-start event triggers.

Saved automations have an **Edit automation** action in the page header that
brings the command controls into view. **Browse commands** opens the installed
catalog in both create and edit flows. Editing uses a searchable single selector:
choosing another command replaces the current selection immediately. Customizing
a described proposal uses the same single selector; direct creation keeps multiple
selection for batches. See [the replacement bug](2026-09-07-replacing-a-selected-command.md).

Description and customization are consecutive steps on the same proposal.
The name, arguments, trigger, time zone, end date and brief come from its contents,
and untouched metadata and comments survive customization. A described revision
uses its unsaved proposal as the starting point, rather than reloading the older
file. See [describe, then customize](2026-09-07-describe-then-customize.md).

- `mod.ts` — the wire types and routes. `GET /automations/_api/status`
  carries every page. `GET …/commands` returns the command catalog without
  filesystem paths; `GET …/automation/:name/configuration` loads saved settings.
  `POST …/preview` validates selected commands, arguments and trigger fields and
  returns deterministic charter proposals without a model call or write.
  The writes are as narrow as they sound:
  `POST …/automation/:name/status {status}` flips the charter's
  `status:` line (a textual edit via the model's `setAutomationStatus`,
  so comments, key order and body come through byte for byte, written
  through a temp file); `POST …/automation/:name/run` is
  `automations:run` without a stamp — a forced run reports its outcome
  but never moves the schedule, and never enters the ledger;
  `POST …/draft {request, revise?}` is `automations:draft` — a model
  call that returns a complete validated charter and its editable `setup`, and writes nothing;
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
- `configure.ts` — proposals and settings round-trips. Generated names avoid
  existing charters and other names within a batch. Revisions retain status,
  kind, metadata, YAML comments and an unchanged prose body. The host also
  checks required arguments against the selected command's actual definition.
  `setupFromDraft` carries the unsaved charter as a command's `template` so a
  customized proposal preserves the described result, including its metadata.
- `lib/automations/invoke.ts` — the shared scheduled/manual execution boundary.
  Raw YAML arguments must be parsed before entering `CommandService`, whose
  explicit overrides otherwise replace parsed dates with raw strings. `today`
  and `yesterday` for `plainDate` parameters are resolved against the firing's
  clock on each invocation, including jobs running before `day:start`.
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

- Direct controls and written requests both produce readable proposals before
  saving. The proposal card shows When / Runs / Day / Why and "The whole file".
  A batch saves sequentially; partial success is reported and retry skips
  files already saved. Editing any setting invalidates the old preview.
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

2026-09-07: browser coverage for description as the default, generated settings
carrying into Customize, changing the command and time before creation, preserving
drafted context and metadata, and customizing a described revision before applying.

2026-09-07: reproduced the selected-command replacement failure, then verified
header editing, catalog browsing, replacing and saving the command, and the saved
automation's edit controls at phone width.

2026-09-07: catalog precedence and proposal tests, argument conversion across
dates and time zones, route validation and browser coverage for keyboard command
completion, morning recap batches, preview-before-save, partial-save recovery,
editing and mobile layout. See [the implementation narrative](2026-09-07-choosing-morning-recaps.md).

2026-08-31: route tests (`automationsRoute_test.ts`) with every write
scripted, model tests for the ledger, `setAutomationStatus`, and
`validateCharterDraft`, `bun run dev:check` stages, plus live runs —
the report against the running service, every page in a headless
browser light and dark, the View-file link landing in the explorer, one
real CLI draft and two real in-browser drafts (model calls; drafting
writes nothing), and every file-writing flow exercised in the browser
with the requests intercepted so nothing touched the real notebook.
