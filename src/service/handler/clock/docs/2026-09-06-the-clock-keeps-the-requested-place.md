---
created: 2026-09-06
updated: 2026-09-06
---

# The clock keeps the requested place

The converter already parsed a friendly `targetName`, and its terminal
table used it. Both its returned data and JSON output discarded that
name. The clock host then serialized only the date, time and timezone,
leaving the page to derive its answer label from the IANA ID.

For a synthetic query about Harbor City in `Europe/Paris`, this made the
answer say Paris. The time could be right while the displayed place
changed. Several places can share one timezone, so the requested name
cannot be recovered from the timezone alone.

`util:tz:convert` now retains `targetName` in both structured outputs. Its
schema and prompt ask for the place named in the query. The clock host
normalizes each reading to calendar hours and attaches that name as
`target.place`. The page renders the place as the primary label and the
full IANA timezone as secondary metadata, also available on hover when
the narrow layout hides it. Notebook and local rows likewise show their
timezone IDs without inferring a physical location. The client imports
the route's wire types so a future change cannot silently omit a field
from a second interface.

The regression checks two synthetic places sharing a timezone across a
midnight conversion, along with the API relay preserving the place.
