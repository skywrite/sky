---
created: 2026-09-06
updated: 2026-09-06
---

# Review a meeting before sending

A line such as “meet Jane on Friday at 3 PM” leaves two kinds of ambiguity:
which Jane, and which date and timezone. Creating a conference while the
person is still correcting that interpretation makes retries and abandoned
drafts expensive. The composer therefore separates interpretation, calendar
preview, and the one deliberate send.

The model extracts names but does not invent contact details. Candidate
emails come from the notebook, and namesakes or multiple addresses remain
visible choices. The calendar check reads every owned calendar rather than
reusing the day's missed-meeting policy: a solo appointment, overnight
block, or busy all-day entry can conflict even though it is not a meeting
the notebook expects to have notes for.

Google's existing Zoom add-on supplies the conference. The adapter uses a
new Calendar editor, selects the calendar by identity and chooses Zoom
before adding guests. Adding guests first can race the asynchronous list
of conferencing providers. The unsaved preparation function is separately
callable so verification can exercise the real editor without sending.

A disappearing HTTP response cannot prove a disappearing invitation.
Creation therefore persists a unique request ID and records the Save
boundary before crossing it. Repeated requests retrieve the same result;
after an interrupted Save, the person checks Calendar rather than Sky
automatically sending another invitation.

The initial entry point is the clock page, where scheduling across timezones
already has context. The composer itself is independent of that page. Its
desktop dialog becomes a full-screen view on a phone, with the send action
and any conflict warning kept in a fixed footer. The warning links to the
day's schedule when that schedule is below the fold.
