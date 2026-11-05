---
created: 2026-11-04
updated: 2026-11-04
---

# Family is a rule, not points

## Problem

The 2026-09-07 change gave every profile tagged `Person/Family` a permanent
100 points, in both the relevance score and the familiarity score. Its job was
the calendar: family should appear by first name even when their contact is
rarely logged, and short names need 100 points of familiarity.

The same 100 points also ranked people everywhere else: People search, the
list of most active contacts that chat's query writer reads, and which person a
bare first name means. Most people score a few points at most, so the bonus
alone placed nearly every family member among the most active contacts, ahead
of people met every week, even with almost no logged contact. A search that
ranks people for business — whom to invite, whom to reach — surfaced family
first.

## Decision

Being family is a fact about a person, not an amount of contact. Both totals now
count logged activity only. The calendar's short-name check reads the tag
directly: a short name at 100 points of familiarity, or for anyone tagged
`Person/Family` or a tag under it. The tag test (`isFamily`) is unchanged.

## Consequence

A bare first name no longer leans toward a family member by default. When the
same first name belongs to a family member and a frequent contact, the frequent
contact wins unless the conversation or a fuller name says otherwise. A
family member's other names (a nickname, "Mom") on their profile still resolve
directly.

## Verification

`familiarity_test.ts` pins which tags count as family. `scan_test.ts` checks
that family tags add no points. `day/schedule_test.ts` checks the calendar still
shortens a family member with no logged contact, and uses the full name once the
tag is removed from the profile.
