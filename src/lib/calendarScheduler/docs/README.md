---
created: 2026-09-07
updated: 2026-09-07
---

# CalendarScheduler

Calendar invitations belong here. Notebook meeting documents and transcript
imports remain under `meeting:new`; scheduling does not create those documents.
The shared API is `CalendarScheduler` in `CalendarScheduler.ts`. The web composer
and `calendar:schedule` command use the same validation, contact interpretation,
availability and creation jobs. Chat and voice do not expose the command yet.
`calendar:update` edits and reschedules existing Google Calendar events.

## Entry points and ownership

- `CalendarScheduler` provides `setup`, `people`, `parse`, `preview`, `prepare`,
  `review`, `create`, `send`, `prepareUpdate`, `reviewUpdate`, `update`, and `get`.
  Hosts inject contacts and provider operations. `updates.ts` owns the update workflow.
- `google.ts` supplies Google account discovery, calendar reads and creation.
  Credentials and contact lookup are injected; this module does not import the
  command runner or HTTP service.
- `people.ts` uses the live contact store with supplied interaction scores.
  Its match ranking shares `lib/string/matchScore.ts` with web completions.
- `client.ts` is the command's HTTP transport to the running service. Keeping
  creation in that process lets it finish after the command disconnects.
- [Composer routes and UI](../../../service/handler/meetings/docs/README.md)
  own HTTP checks, the service activity hold, and interactive editing.
- The Google/Zoom browser adapter and shared profile management live in
  `lib/google/`. Date and elapsed-duration arithmetic stay in nbdt.

## The command

```sh
sky calendar:schedule "30-minute Zoom with Jane Doe tomorrow at 2pm Chicago time about Atlas"
sky calendar:schedule --send <draft-id>
```

| Input | Meaning |
| --- | --- |
| `request` or `--request` | A self-contained natural-language request: guests, timing, duration, title, agenda |
| `--account`, `-a` | Organizer email or a unique part of it; a single connected account is selected automatically |
| `--timezone` | Default IANA zone for unqualified times; otherwise the system zone; a zone in the request takes precedence |
| `--send` | ID returned by preparation; mutually exclusive with a request and its overrides |
| `--json` | Print the structured result without interactive prompts |

In a top-level terminal call, missing request details open a text prompt. Ambiguous
organizers, contacts and email addresses open selectors through `context.prompt`.
A contact without an address opens a validated email input. The command then
shows the resolved invitation and asks whether to create it and send invitations.
Cancelling any picker or declining confirmation sends nothing. A ready draft can
still be sent later with `--send`; that explicit operation needs no second prompt.

`--json`, piped input, service calls and command composition remain noninteractive.
They return the same structured questions and draft IDs for their caller to handle.

A request returns `CalendarPreparation`: resolved fields, invitee candidates,
account choices, assumptions, questions, unsupported requirements and availability.
`status` is `ready`, `needs_input`, or `unsupported`. Only a ready result receives
a `draftId`. `requestQuestions` identifies free-text clarifications separately from
the contact and account choices. Ambiguous names or multiple addresses remain questions. Only explicit
contact addresses or emails in the request can become guests. Missing/invalid
fields, past times and organizer-only guest lists cannot produce sendable drafts.
Relative dates use the civil clock, independently of the notebook's open day.

A conflict or incomplete calendar check remains visible in the preparation.
Sending the draft accepts that exact review, as the composer's send button does.
A changed review key stops creation. A natural-language clarification updates the
request before contacts are selected. Exact picker choices go to `review`, which
validates the selected fields, refreshes availability and persists a ready draft
without another model call. Sending never interprets text again.

AI callers should include the relevant conversation context in `request`. The
scheduler sees only its input, not the calling conversation. Command composition
returns the same structured data without requiring `--json`.

## Editing and rescheduling

```sh
sky calendar:update "Move tomorrow's meeting with Jane Doe to 4pm"
sky calendar:update "Rename it Atlas planning and make it 45 minutes" --event <event-id> --account organizer@example.com --json
sky calendar:update --send <draft-id>
```

Updates support the date, time, duration, title, agenda, location and guest list
of regular timed events the connected account organizes. Solo events are allowed.
The selected occurrence of a recurring event can be changed; the whole series,
all-day events, specialized event types, organizer changes, cancellation and
conference replacement are outside this command. Dates/times keep the scheduling
limits of 5–720 minutes and at most 50 human guests. Unmentioned fields, rooms and
the existing conference link are retained. Metadata may be edited after an event;
a changed start or end must be in the future.

The request identifies the current event and describes the desired change. Without
`--event`, discovery searches owned calendars using the event's current title,
guest or date. With no current date, the search spans the previous seven days
through the next thirty days. Ambiguous matches and incomplete searches return
candidates, never a guessed target. An explicit event ID requires `--account`
with the full email and accepts `--calendar` (default `primary`). Recurring
occurrences have their own event IDs. Time interpretation defaults to the selected
event's zone; `--timezone` overrides that default. Browser times are rendered in
the event's existing zone while preserving the requested instant.

`prepareUpdate({request, account?, timezone?, event?})` first reads the selected
event, then interprets only requested changes against that snapshot. Unlike creation,
an omitted date or duration stays unchanged. Contact additions use the normal
contact/email pickers; removals resolve only against current guests. The terminal
shows before/after timing, changed text and added/removed addresses, then confirms
before saving and notifying guests. JSON, piped and composed calls remain
noninteractive. `reviewUpdate({event, version, fields, assumptions?})` accepts exact
selections without interpreting the request again. `update(draftId)` saves the
prepared update; `get(id)` retrieves its job. Chat and voice remain unconnected.

Update drafts store the exact account, calendar/event IDs, provider version and
before/after fields. Creation receipts now also return these event IDs for later
edits. Both updates and creations share the durable draft/job machinery. Update
states are `updating`, `updated`, `failed`, and `uncertain`, with `operation: update`.
Repeated saves retrieve the same receipt, including after a restart or an unknown
save outcome. The exact event version and availability are checked again immediately
before Save. The selected occurrence and its copies on other accounts are excluded
from availability; other occurrences still count as conflicts.

The provider uses Calendar's read API and the existing authenticated browser editor,
with no extra OAuth scopes. It opens the exact event, verifies the account and
original fields, changes only requested controls, retains conferencing, selects
**This event** for recurring occurrences, and completes guest notification prompts.
It reads that exact ID back and requires the requested timing/content, original
conference and rooms, and a changed version before reporting success. No replacement
event or Zoom conference is created by the update workflow.

## Prepared drafts and creation receipts

Prepared fields and their availability review key are written atomically with
owner-only permissions under `<userDataDir>/meetings/drafts/<id>.json`. This is
service state, separate from notebook documents. The existing `meetings` state
folder is retained so earlier creation receipts remain readable.

Sending uses the draft ID as the creation job ID and reads its saved fields.
The command waits up to six minutes for completion, then returns `creating` with
the same ID if it is still running. A disconnected caller retrieves the outcome
by repeating `--send` with that ID. It must not prepare a replacement invitation
to recover an unknown send outcome.

`jobs.ts` keeps receipts at `<userDataDir>/meetings/<id>.json`. Exclusive atomic
initial writes make competing sends retrieve one job. A `saving` record is
persisted before the first Save click. A crash or unconfirmed result after that
becomes `uncertain`, never an automatic retry. Completed jobs retain their result
after restart and after their meeting time has passed. The HTTP aliases share one
scheduler instance so both observe the same running job owner.

## Google Calendar and Zoom

`lib/google/createCalendarMeeting.ts` drives the existing
Google Calendar Zoom add-on through Sky's dedicated Google browser profile.
It does not require another Zoom app or new Google Calendar write scopes.
The Google account must be signed in to that profile (`sky google:browser`)
and have the Zoom for Google Workspace add-on connected. Mobile uses the
same server-side browser; the computer running Sky must be available.

The adapter chooses the primary calendar by ID, checks the signed-in
account, selects Zoom before adding guests, and verifies the guest emails,
title, date and times before Save. Selecting Zoom before guests avoids a
race with Google's automatic conferencing. The template's `ctz` supplies
the explicit event zone. After Save, it handles Google's invitation and
external-guest prompts and reads the event back through the Calendar API,
matching timing, guests and conference ID before reporting success.

Zoom inherits the add-on's account settings. The meeting-ID preference must
be set to generate IDs automatically. The adapter also rejects a conference
ID already present in the organizer's recent calendar or between now and
the requested day. This is a reuse check, not a lookup of the account's PMI.
If the browser signs out or Google's controls change, creation fails with
the draft retained. There is no fallback to Meet or a saved Zoom room link.

## Verification

Synthetic tests cover preparation without external writes, unresolved contacts
and accounts, timezone overrides, invalid requests, immutable drafts across
restart, concurrent sends, changed/incomplete availability, receipt reuse and
uncertain saves. Command tests exercise the HTTP routes and both API aliases.
Update tests cover exact event identities, unchanged metadata, solo events,
ambiguous/incomplete searches, guest selections, stale versions, failed calendar
checks, DST, recurring-instance conflict exclusion, interrupted writes and retries.
Provider readback tests cover identity, content, conference and room preservation,
single-occurrence selection, notifications and unconfirmed saves. An isolated
browser check with intercepted synthetic pages verifies title/time/agenda/location/
guest controls, the original conference link, wrong-event rejection and no early Save.
A real terminal check with a synthetic provider verifies the event picker,
before/after output and confirmation, saving only to a temporary fixture.
Terminal tests cover actual prompt calls, account/contact/email selection, missing
details, manual address validation, cancellation, refreshed availability and
noninteractive callers. A real terminal session with synthetic contacts verifies
the contact picker, email picker and send confirmation through Clack.
The existing composer, contact ranking and Calendar readback tests remain in use.
No test invitation is sent to a real account.

## Notes

- [2026-09-07 — Updating the existing event](2026-09-07-updating-the-existing-event.md)
- [2026-09-07 — Terminal questions must open prompts](2026-09-07-terminal-questions-open-prompts.md)
- [2026-09-07 — A scheduler outside the handler](2026-09-07-a-scheduler-outside-the-handler.md)
