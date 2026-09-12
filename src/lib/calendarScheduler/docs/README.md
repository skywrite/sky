---
created: 2026-09-07
updated: 2026-09-12
---

# CalendarScheduler

Calendar events, solo time blocks and invitations belong here. Notebook meeting documents and transcript
imports remain under `meeting:new`; scheduling does not create those documents.
The shared API is `CalendarScheduler` in `CalendarScheduler.ts`. The web composer
and `calendar:schedule` command use the same validation, contact interpretation,
availability and creation jobs. Chat and voice expose both calendar commands.
`calendar:update` edits and reschedules existing Google Calendar events.

## Entry points and ownership

- `CalendarScheduler` provides `setup`, `people`, `parse`, `preview`, `prepare`,
  `review`, `create`, `send`, `sendBatch`, `prepareUpdate`, `reviewUpdate`, `update`, `approval`, and `get`.
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
| `--send` | ID returned by preparation, or comma-separated creation draft IDs for a batch; mutually exclusive with a request and its overrides |
| `--status` | Read sent draft/job IDs without saving again; creation batches accept the same comma-separated IDs |
| `--json` | Print the structured result without interactive prompts |

In a top-level terminal call, missing request details open a text prompt. Ambiguous
organizers, contacts and email addresses open selectors through `context.prompt`.
A contact without an address opens a validated email input. The command then
shows the resolved event, saves solo blocks directly and confirms before sending invitations.
Cancelling any picker or declining confirmation sends nothing. A ready draft can
still be sent later with `--send`; that explicit operation needs no second prompt.

`--json`, piped input, service calls and command composition remain noninteractive.
They return the same structured questions and draft IDs for their caller to handle.

A request returns `CalendarPreparation`: resolved fields, invitee candidates,
account choices, assumptions, questions, unsupported requirements and availability.
`status` is `ready`, `needs_input`, or `unsupported`. Only a ready result receives
a `draftId`. `requestQuestions` identifies free-text clarifications separately from
the contact and account choices. Equal-quality name matches or multiple addresses remain questions. Only explicit
contact addresses or emails in the request can become guests. Missing/invalid
fields and past times cannot produce sendable drafts. An empty or organizer-only
guest list creates a solo event. Conferencing defaults to none for solo events
and Zoom for meetings with guests; an explicit `conference: none|zoom` overrides
that default. Unresolved requested guests still prevent creation.
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

## Chat and voice

`calendar_schedule` and `calendar_update` are discovered from the commands'
`@AIChatTool` decorators. Browser voice includes them in its curated command set.
Both take a natural-language `request`, return unresolved questions or candidates,
and leave clarification to the conversation. Each call must include its relevant
context and all settled answers. Call preparation with the user's words before
asking for dates, emails, duration or account details: it uses the same fast
Cerebras interpretation and live scored contact search as the `/clock` composer.
A new meeting without a day means today on the civil clock, duration defaults to
30 minutes, and timezone defaults to the system zone. The speaker's "me" or
"myself" is the organizer, already represented by the connected calendar account,
not a guest to search for. An event selection or later edit uses the exact
event, calendar and account IDs returned by the scheduler. Unmentioned fields stay
unchanged; ambiguous matches never select an event automatically.

Contact results retain their stored aliases and combined interaction scores.
A unique exact name/alias or stronger direct name prefix resolves the identity
ahead of fuzzy or email-domain matches. Equal-quality namesakes stay a choice;
interaction scores order that choice. One explicit saved email completes the
guest. Multiple emails retain `personId` and ask only which saved address to use.
The terminal, composer and conversation preserve that identity during email
selection. Voice offers the returned choices instead of asking for a surname or
having the user dictate addresses that were already found.

Preparation, `status` reads and saving solo blocks run without approval. Saving
events that affect guests is gated: the web/terminal chat asks through its approval
UI, and voice parks the call until `confirm_action` follows a spoken yes. Updates
check both the original and final guest lists, so removing the last guest still
requires approval to notify them. Existing job IDs only retrieve their receipts.
Voice requests the pending approval before
asking for that yes, so preparation and parking do not each trigger a confirmation
question. Cancellation discards the parked call; changed requirements get a new
preparation and approval. Calendar tools never
receive standing session approval. Hosts that cannot ask do not offer these tools.

Approval policies and formatters may be asynchronous and receive the host command
context. The calendar policy loads `GET /drafts/:id/approval?operation=schedule|update`
and uses `needsApproval`, derived from the immutable saved fields. Neither a tool
argument nor the model's summary can claim an event has no guests. Every host must
await this check before executing or parking the call; failed reads never grant
approval. The formatter uses the same endpoint
from the running service. It presents the saved fields, guests, account, timezone,
assumptions and availability; updates include before/after details. The summary is
stored with the immutable draft, before a draft ID or CLI instructions are added
to the preparation display. Older drafts reconstruct this view only if fresh
availability matches the original review key. A missing draft, wrong operation or
failed read cannot produce an approval or execute a write. Save still rechecks
availability and the provider event version.

For multiple dates, prepare each event before saving, then call `calendar_schedule`
once with comma-separated draft IDs in `send` (up to 50). The policy reads every
draft; all solo blocks run directly, and any invitations share one approval card
or spoken confirmation showing every event. `/send-batch` validates all drafts
and their accounts/times before starting creation. Each event keeps its own
immutable draft and durable job receipt. Batch results contain `jobs`, including
individual failures or uncertain saves; use the same IDs in `status` or retry
`send` to retrieve existing jobs without replaying writes.

Only `created` or `updated` receipts mean completion. A pending, disconnected or
uncertain save is checked with `status: id`; never prepare a replacement event to
recover it. New voice sessions pick up the tools and prompt after the command
manifest is rebuilt with `sky cli:commands --rebuild`.

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
prepared update; `get(id)` retrieves its job.

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
with `--status` and that ID (repeating `--send` also returns the same job). It must not prepare a replacement invitation
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
The Google account must be signed in to that profile (`sky google:browser`).
Only events requesting Zoom need the Zoom for Google Workspace add-on connected.
Solo blocks and events requesting no conferencing skip Zoom and its reuse check.
Mobile uses the
same server-side browser; the computer running Sky must be available.

The adapter chooses the primary calendar by ID, checks the signed-in
account, selects Zoom when requested before adding guests, and verifies the guest emails,
title, date and times before Save. Selecting Zoom before guests avoids a
race with Google's automatic conferencing. The template's `ctz` supplies
the explicit event zone. After Save, it handles Google's invitation and
external-guest prompts and reads the event back through the Calendar API,
matching timing, guests, busy status and the requested conference (or its absence)
before reporting success. Solo events do not wait for an invitation prompt.
Readback excludes event IDs present before creation, so a pre-existing identical
block cannot be mistaken for a successful save.

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

- [2026-09-08 — Look up the meeting before asking questions](2026-09-08-lookup-before-questions.md)
- [2026-09-07 — Calendar actions in conversation](2026-09-07-calendar-in-conversation.md)
- [2026-09-07 — Updating the existing event](2026-09-07-updating-the-existing-event.md)
- [2026-09-07 — Terminal questions must open prompts](2026-09-07-terminal-questions-open-prompts.md)
- [2026-09-07 — A scheduler outside the handler](2026-09-07-a-scheduler-outside-the-handler.md)
