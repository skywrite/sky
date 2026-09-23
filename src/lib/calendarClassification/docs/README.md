---
created: 2026-09-23
updated: 2026-09-23
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
times, location and presence of a video link. State text is evidence, never
instructions. Jev chooses between meetings and notifications based on the
kind of activity; it does not need proof of the owner's attendance. Uncertainty
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
classification. Manual corrections still apply with automation off. The API
accepts only keys present in that day's current calendar-backed schedule;
local-only notebook records cannot be reclassified by this endpoint.
