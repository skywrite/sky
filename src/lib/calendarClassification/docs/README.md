---
created: 2026-09-23
updated: 2026-09-24
---

# Calendar entries and meeting expectations

`mod.ts` separates informational invitations from actual meetings after the
existing Google meeting policy has excluded cancelled, declined, all-day,
non-default and solo entries. `fetchDayMeetings` owns that composition, so the
day rail, CLI listing, and chat/voice meeting checks share the same decision.
Notifications remain available as calendar context without a missing-record
expectation. Local meeting records stay in Meetings and notifications never
consume a record through the time-based matching rule.

The **Hide family notifications and reminders** switch lives in Settings →
Connections → Google → Calendar. When checked, the day rail hides these entries
and their section; turning it off makes them visible again. It writes
`calendar.classifyEvents` in config.jsonc, defaults off, and is read on each
fetch. The page links to TypeSafe setup when no working key is available.
The distinction is participation in a conversation or appointment versus
awareness of an activity, closure or reminder. A family planning call can be
a meeting; a shared invitation alone does not establish participation.

Jev receives the event's account, title, description, organizer, guests,
owner RSVP, times, location and presence of a video link. The owner's name
and family section come from `journal/about-me.md`; freeform profiles supply
complete family-related paragraphs. Missing profiles need no setup. State
text is evidence, never instructions. The question is whether the owner has
an interaction worth a meeting record. A family member's therapy, appointment
or lesson is scheduling context, including terse titles. Accepting an invite
or providing transportation does not turn it into the owner's meeting. RSVP
is evidence, not a gate: an unanswered work invitation can still be a meeting.
Family planning calls and parent-teacher conferences remain meetings. Uncertainty
comes from a selected probability below 0.8, rather than a third competing
label or an additional confidence gate. TypeSafe's confidence summarizes the
distribution and is not the selected label's probability. An incomplete guest
list alone does not prevent classifying the activity.

Uncertain, malformed, oversized or failed inputs remain visible in Meetings.
Calls use the shared TypeSafe usage logger, a thirty-second timeout, no retries,
and at most four concurrent requests. Credential lookup completes before the
model timeout starts, and cached judgments do not need the keychain. A failed
batch stops new requests for that fetch; later fetches can retry. The rail offers
one compact retry action when sorting fails, without repeated labels on events
or assuming every failure means a broken connection.

Judgments and corrections live outside the notebook under
`<userDataDir>/state/calendar-classification/`. Cache filenames hash the event
identity, evidence, model alias, questions and policy version; event edits
invalidate the cache. Failed requests are never cached. Corrections use a
separate file keyed by account, calendar and provider event ID, preserving
their identity across title/time edits and preventing a late model response
from overwriting a person's choice. These are internal lookup keys, not
user-content IDs. Each atomic file write affects only one event or judgment.

The day's Change type menu corrects **this occurrence**, or restores automatic
classification. Uncertain events without a record also offer **Dismiss**, which
saves a notification correction, with Undo available even when reminders are
hidden. Manual corrections still apply with automation off. The API
accepts only keys present in that day's current calendar-backed schedule;
local-only notebook records cannot be reclassified by this endpoint.

Corrections include a compact snapshot taken from the provider event on the
server. Up to four relevant corrections from the same account and calendar
ride later judgments as examples, selected by recurring series or overlapping
title words. They inform the model rather than creating a blanket rule for a
person or series. Only explicit owner corrections teach; automatic judgments
never do. Resetting to automatic removes the example in the same atomic write.
Profile and relevant example changes invalidate cached judgments too. An older
correction without a snapshot still overrides its occurrence. Oversized events
still accept corrections but do not become examples. This is local preference
memory supplied with classification requests, not model fine-tuning.
