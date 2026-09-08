---
created: 2026-09-07
updated: 2026-09-07
---

# Updating the existing event

The scheduler could create an invitation but had no operation for changing the
event afterward. Reusing creation with a new date would produce a second event,
and its parser would default omitted duration, date and agenda rather than preserve
the original invitation.

Updates therefore start by locating an existing event, reading its exact identity
and provider version, then interpreting a patch against those fields. For example,
“move tomorrow's Atlas review to 4pm” searches tomorrow's existing review, preserves
its guests and duration, and changes its time. Event discovery and patch parsing
are separate so choosing one of several matches cannot silently select another.
Contact choices go through explicit review, without another model call.

Calendar's [event lookup](https://developers.google.com/workspace/calendar/api/v3/reference/events/get)
uses calendar ID plus event ID. A recurring
[occurrence has its own ID](https://developers.google.com/workspace/calendar/api/guides/recurringevents),
while its iCal UID is shared with the series. We retain the exact account/calendar/
event triple for updates, and use UID plus original start only to exclude shared
copies from conflicts. Excluding every event with that UID would hide other
occurrences of the series.

The existing read-only calendar grant remains sufficient: reads use the API,
while writes use Sky's existing Google browser. The editor must agree with the
original event and account before it is changed. Requested instants are rendered
in the editor's existing zone; a timezone override does not reinterpret the
provider's UTC offset. Only requested fields are filled, so an agenda, room or
conference link is not reconstructed from the model's response.

The immutable update draft and the creation job machinery share receipt storage.
An update also stores its original version, checked before the editor opens and
immediately before Save. The browser has no atomic conditional-write mechanism,
so a version check cannot eliminate the narrow race between that final read and
Save. Exact readback catches a differing result rather than claiming success.
The saving marker is persisted before the first Save click; an interruption or
lost confirmation is uncertain and never automatically replayed. Retrieving an
already completed update works after its date has passed.

Synthetic tests exercise preparation and HTTP/command execution without live
calendar writes. Readback tests require the exact event, changed fields, rooms and
conference; recurring updates choose only “This event” before guest notification.
A separate isolated browser check used intercepted pages and a temporary profile
to exercise editing controls without clicking Save on any live event.
