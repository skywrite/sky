---
created: 2026-09-07
updated: 2026-09-07
---

# Names before incidental matches

The Add link picker treated a substring in a summary or folder name as
equivalent to a person's name, then sorted every match by date. An older
contact could disappear behind several pages of newer incidental matches.
The vocabulary already included aliases, but the link catalog discarded
them, making an alias absent from the title and path impossible to find.

The catalog now retains the vocabulary's aliases. Search ranks exact names
and titles first, followed by prefixes, word prefixes and substrings, with
contextual matches last. Every whitespace-separated term must still match,
and type, date and self-exclusion filters still apply before pagination.
The selected value remains the canonical reference.

Changing the server's sort alone is insufficient: the client collected all
results with the same date into one group. If the best and third-best
matches shared a date, that grouping moved the third ahead of the second.
Searches now use a single results section, preserving server order. Empty
search retains the recent-record date groups.

Regression coverage uses synthetic contacts, including more than forty
newer summary matches, aliases from each supported metadata form, and an
exact alias sharing its date with a weaker match. Browser coverage checks
desktop and phone ordering and keyboard selection saving the canonical
name. Existing import, preview and link-editing coverage remains in place.
