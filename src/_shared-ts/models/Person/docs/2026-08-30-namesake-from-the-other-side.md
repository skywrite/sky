---
created: 2026-08-30
updated: 2026-08-30
---

# A namesake from the other side

## What was wrong

A meeting with a longtime contact (names and numbers synthetic). The
summary said:

> Taylor Quinn and Sam are getting married next winter.

The transcript pipeline had the contacts list, with the user's board
member Sam Rivera near the top at score 64. It still returned
`rel: Sam` — bare. The user read the box and pressed Enter.

Then the profile distiller ran. It re-discovered the people in the summary
by regex and resolved the bare "Sam" by score: Sam Rivera 64, Sam
Lindqvist 0.5, over 100× apart, so the board member rode as the only Sam. The
model did what the candidate list invited:

```
👤 noted   Taylor Quinn — Engaged to Sam Rivera (Family)
👤 noted   Sam Rivera — Engaged to Taylor Quinn, wedding next winter (Family)
```

A false Family line on the board member's profile. A false surname on the
founder's.

The same path wrote a bare "Casey" fact to a friend whose profile carries
"Casey" as an alias.

## Why the score rule did not apply

The score rule (ruled 2026-08-29) says a bare name the user says means
the profile the user deals with most. That is a prior on the user's own
words. It is right for `ai:chat`, where the user is the speaker.

In a meeting the bare name is usually the attendee's. Their fiancée, their
co-founder, their assistant. The user's interaction score says nothing
about who the attendee means.

Two resolvers had looked at the name. The strong model, with the whole
transcript and the contacts list, left it bare. The regex, with a score
table, resolved it. The weaker resolver overruled the stronger one, after
the user had confirmed the stronger one's answer.

## Tried and rejected

- A relationship-word guard: skip a handle after "fiancée", "wife",
  "their", `<Name>'s`. Catches this sentence. Misses the next phrasing.
- Approval per profile op. Autonomous writes were ruled on 2026-08-25, and
  a prompt per line is ceremony.
- Honoring an exact bare alias as a pin ("Casey" is on the friend's name
  list). The alias records how the user says the name. The attendee's
  "Casey" is a different claim. A wrong write costs more than a typed
  full name.
- A new profile for the fiancée. A 0-score namesake never rides beside a
  scored one, so the board member would still win the bare name.

## Why the fix works

`meeting:new` passes the confirmed who/rel lists to discovery as anchors.

- A full name there pins its profile. The summary need not repeat it, so
  a corrected `rel: Sam Okafor` reaches the profile even when the text
  says only "Sam".
- A bare name there pins nothing. No score, no namesake, no alias.
- A full name in the summary text still rides, as it always did.
- The box shows the consequence before the corrections prompt:

```
  Who:      Taylor Quinn
  Rel:      Sam, Casey, Jordan
  Profiles: Taylor Quinn
  No match: Sam, Casey, Jordan
```

The corrections prompt is the correction channel. `rel: Casey Morgan,
Jordan` pins the friend and leaves Sam bare.

The distiller still names the fiancée as the text does: "Getting married
to Sam". No profile, no false surname.

`ai:chat` is unchanged. There the user is the speaker and the score rule
stands.

## Left open

- The chat keeps the prior. "Her fiancé Sam" in a chat still resolves to
  the user's top Sam.
- `rel:` corrections parse through the fast model and replace the list.
  A deterministic lift like `time:` is the next rung.
- The unlisted lane reports `profile exists: Sam Rivera` for the fiancée.
  A dim hint, no write.
- The profiles this run touched are repaired by hand, not by code. The
  notebook's git diff shows every line.
