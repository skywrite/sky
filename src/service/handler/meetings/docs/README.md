---
created: 2026-09-06
updated: 2026-09-12
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
   A unique exact alias or stronger direct name match identifies a person even
   when weaker fuzzy matches also appear. Equal-quality namesakes and multiple addresses remain a choice. The model never supplies an
   invented address. The person can add more names or explicit emails,
   change a match, or remove an invitee. The complete guest list is reviewed.
   A contact appears once, with their email choices grouped underneath.
   Only unresolved matching contacts prompt for who the person means. An already
   identified contact retains their identity while saved email choices are shown.
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
4. **Create event** saves a solo block; **Create & send invites** creates the reviewed invitation on the selected
   account's primary calendar. An existing conflict is allowed after it is
   shown; a changed conflict set stops creation and requires a fresh review.
   On phones, the footer links directly to conflicts or incomplete checks.
   Guests are optional. Video conferencing can be None or Zoom, following the
   [shared scheduler defaults](../../../../lib/calendarScheduler/docs/README.md#the-command).
5. Success shows the Calendar link and a Copy Zoom link action when present. No call is
   joined. A failure preserves the draft. An uncertain save directs the
   person to Calendar before returning to the draft.

## Service boundary

The shared [CalendarScheduler](../../../../lib/calendarScheduler/docs/README.md)
owns interpretation, validation, availability and invitation jobs. This directory
owns the composer routes and service wiring. `createMeetingsHost.ts` supplies the
live notebook contact index and interaction scores to the shared Google provider;
`mod.ts` supplies the service activity hold while an invitation is being created.

The same route instance is mounted at `/calendar/_api` and `/meetings/_api`.
The command uses the calendar path; the existing composer keeps the meeting path.
Both see the same jobs, including invitations started before the extraction.

| Route under either API prefix | Behavior |
| --- | --- |
| `GET /setup` | Civil date, zone, accounts with calendar access |
| `GET /people?q=...` | Matching contacts ranked with the shared interaction scores, with explicit emails |
| `POST /parse` | Free text → editable draft; no event or conference created |
| `POST /preview` | Timing → day, conflicts, alternatives and a review key |
| `POST /prepare` | Natural-language request + optional account/zone → questions or a persistent draft ID |
| `POST /review` | Explicitly resolved fields → validation, fresh availability and a persistent draft ID |
| `POST /updates/prepare` | Natural-language edit + optional exact event reference → candidates, questions or an update draft |
| `POST /updates/review` | Event reference + reviewed version + exact fields → fresh availability and an update draft |
| `POST /update` | Prepared update draft ID → update job; no new event is created |
| `POST /create` | Validated composer fields + review key + unique request ID → job |
| `POST /send` | Prepared draft ID → job for those exact saved fields |
| `POST /send-batch` | Prepared creation draft IDs → individual jobs after validating the whole batch |
| `GET /drafts/:id/approval?operation=schedule\|update` | Stored review and guest-based approval requirement, requiring the matching operation |
| `GET /jobs/:id` | Creating/created or updating/updated, failed, or uncertain |

The client remembers its pending ID in session storage and resumes checking it
after a reload. JSON and same-origin checks live at the HTTP boundary. Persistence,
retry rules and Google/Zoom integration live in the shared scheduler documentation.
Chat and voice use the same API; their [calendar workflow](../../../../lib/calendarScheduler/docs/README.md#chat-and-voice)
is owned by CalendarScheduler.
The same [lookup before questions](../../../../lib/calendarScheduler/docs/2026-09-08-lookup-before-questions.md)
behavior now applies in voice and chat.

## Notes

- [2026-09-07 — Updating the existing event](../../../../lib/calendarScheduler/docs/2026-09-07-updating-the-existing-event.md)
- [2026-09-07 — Calendar scheduling has a shared API and command](../../../../lib/calendarScheduler/docs/2026-09-07-a-scheduler-outside-the-handler.md)

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
