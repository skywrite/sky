---
created: 2026-09-06
updated: 2026-09-07
---

# Scheduling a meeting

The New meeting button on `/clock` opens `theme/client/meeting.tsx`: a
dialog on desktop and a full-screen composer on phones. The component is
reusable; scheduling does not belong to the clock converter. It keeps Sky's
theme, with a scrollable body and an always-visible action footer.
Its shared header, spacing, action roles and footer follow the
[UI toolkit](../../theme/docs/README.md#shared-ui-toolkit).

## From words to an invitation

1. Typing automatically asks Qwen 3.8 on Cerebras (`default-cerebras-qwen-3.8`)
   to interpret the title, people, date, time, timezone, duration, and optional
   agenda after a 400 ms pause. People and timing appear as the request takes
   shape; there is no separate Review or Update action. Older requests are
   cancelled, and only the current wording can enable sending. Relative dates use the
   actual civil clock, independently of the notebook's still-open day.
   When no day is specified, the AI defaults to today and shows that
   assumption in the draft. It does not ask for a day. An explicit day or
   date takes precedence. "Today" is valid on weekends and holidays. Only a
   date and weekday both supplied by the user can contradict each other;
   the clock's weekday does not introduce an extra constraint. The AI
   extracts any explicitly written weekday, which is checked against the
   calendar date before returning the draft. A mismatch leaves the date
   unresolved. Past times remain visible in the draft and are rejected
   when creating the meeting.
   Missing times and unresolvable dates remain blank. A default 30 minutes and other
   assumptions are visible; changing the fields clears stale assumptions.
   New responses merge with the reviewed draft: chosen emails, manually added
   or removed guests, and unchanged fields survive continued typing. A manual
   field edit during a pending request takes precedence over its response.
   Failed interpretation keeps the draft, disables sending and offers Retry.
2. Contacts resolve against the notebook's explicit email fields. Matching
   names use `Store.getPeopleWithScores()`, the same interaction scores served
   to IntelliSense and transcript meeting detection. Match quality precedes
   interaction score, then name order, matching the web completion convention.
   Alias interactions already belong to the canonical score and count once;
   profiles and their email choices remain grouped. Scores refresh on each
   lookup. Both AI-resolved names and the Add invitees search use this path.
   Namesakes and multiple addresses remain a choice. The model never supplies an
   invented address. The person can add more names or explicit emails,
   change a match, or remove an invitee. The complete guest list is reviewed.
   A contact appears once, with their email choices grouped underneath.
   Only multiple matching contacts prompt for who the person means.
   Choosing a contact with no saved email keeps their identity and focuses
   an email field. The invitee stays unresolved until an address is supplied.
3. The selected day's owned Google calendars appear alongside the draft.
   Busy all-day, overnight, solo, focus and out-of-office entries count;
   free, declined, cancelled, working-location and birthday entries do not
   block time. Shared copies of an event deduplicate by iCal UID and start.
   A meeting ending at the proposed start is not a conflict. Nearby free
   times are offered when the proposed time overlaps. The check refreshes
   when time changes, on focus and every minute. Guests' availability is
   not checked. Failed calendars are explicitly incomplete, never all clear.
4. **Create & send invites** creates the reviewed invitation on the selected
   account's primary calendar. An existing conflict is allowed after it is
   shown; a changed conflict set stops creation and requires a fresh review.
   On phones, the footer links directly to conflicts or incomplete checks.
5. Success shows the Calendar link and a Copy Zoom link action. No call is
   joined. A failure preserves the draft. An uncertain save directs the
   person to Calendar before returning to the draft.

## Service boundary

`MeetingsHost` in `types.ts` supplies account setup, contact search, model
parsing, availability, and creation. `createMeetingsHost.ts` wires it to the
notebook, keychain and Google APIs. Route tests replace that host entirely.

| Route under `/meetings/_api` | Behavior |
| --- | --- |
| `GET /setup` | Civil date, zone, accounts with calendar access |
| `GET /people?q=...` | Matching contacts ranked with the shared interaction scores, with explicit emails |
| `POST /parse` | Free text → a draft; no event or conference created |
| `POST /preview` | Timing → day, conflicts, alternatives and a review key |
| `POST /create` | Validated fields + review key + unique request ID → job |
| `GET /jobs/:id` | Creating, created, failed, or uncertain |

Dates and elapsed-time arithmetic live in nbdt's `calendar.ts`. It uses
Temporal internally to preserve explicit provider offsets and to reject
missing or repeated daylight-saving hours. A duration is elapsed minutes,
including when the end crosses a clock change. Meeting hours stay 00–23.

## Google Calendar and Zoom

`commands/all/google/calendar/lib/createMeeting.ts` drives the existing
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

## A send cannot be replayed

`jobs.ts` persists each request under `<userDataDir>/meetings/<id>.json`.
Exclusive, atomic initial writes make a duplicate POST retrieve the same
job. State changes are atomic. A `saving` record is persisted before the
first Save click; a crash or unconfirmed result after that becomes
**uncertain**, never an automatic retry. The client remembers the pending
ID in session storage and resumes checking it after a reload. A service
activity hold prevents a normal source reload during creation.

Create requests require JSON and reject cross-origin browser requests.
The server revalidates email addresses, times and the chosen Google account,
deduplicates guests, and rechecks availability immediately before Save.
No real guest address or conference link belongs in fixtures or documentation.

## Notes

- [2026-09-06 — Live interpretation preserves the review](2026-09-06-live-meeting-drafts.md)
- [2026-09-06 — A time without a day means today](2026-09-06-time-without-a-day.md)
- [2026-09-06 — Relative dates are explicit](2026-09-06-relative-dates-are-explicit.md)
- [2026-09-06 — Review a meeting before sending](2026-09-06-review-before-sending.md)

## Verified

2026-09-06: route and scheduling tests cover contact ambiguity, explicit
addresses, free versus busy entries, all-day and overnight conflicts, DST,
calendar changes before creation, concurrent retries, and uncertain saves.
The browser test uses a temporary notebook and scripted APIs to exercise
desktop and phone layouts, namesake choices, choosing one of a contact's
multiple emails, contacts without saved emails, automatic interpretation,
out-of-order responses, manual edits during interpretation, and retry recovery,
a free-time alternative and multiple invitees. The real Calendar adapter
was exercised only through its unsaved preparation boundary with synthetic
guests; no test invitation was sent by this feature's verification.
