---
created: 2026-09-07
updated: 2026-09-07
---

# Conversational voice

Successful retrieval did not make the conversation feel natural. Ordinary
check-ins still produced service-style replies and unsolicited suggestions
about tasks, reminders, and drafts. The browser's forced greeting also drew
from a large pool of scripted invitations to start work.

Several instructions contributed. Sky was told to connect the user's
question to goals without limiting that rule to substantive requests. Neither
persona demonstrated an ordinary social check-in. Sunny's invitation added
a blanket restriction on mood descriptions and extra questions, making a
simple reciprocal courtesy less clear. Background research instructions
discouraged silence, which encouraged filler.

Browser calls now use a plain hello with the profile's first name when
available. The terminal's greeting selection remains separate. Both speaking
prompts provide brief social examples and explicit conversational pacing;
social turns do not solicit work or advertise capabilities. Goal context is
used when the user asks about work, plans, or decisions. Substantive questions
retain room for detail and reasoning. Ordinary courtesies are allowed without
inventing human experiences or a life outside the call.

Lookup acknowledgements can simply be a few words before the tool call.
Background research may wait quietly. Sunny's invitation preserves her
speaking style and the user's actual request without requiring a formal
introduction or a new research report.

These are prompt and greeting changes, not a filter that truncates generated
speech. Evidence requirements, source qualifications, tool routing, and action
confirmation rules still apply. The existing prompt override mechanism also
remains in place: a customized notebook prompt takes precedence, and a new
call loads fresh instructions.

The first live style check improved the social replies but still produced a
lookup acknowledgement that repeated the question and announced the answer
to come. The quick-lookup descriptions and host prompt now agree on a
five-word maximum before calling the tool. This bound applies to the brief
acknowledgement, not the answer, a research report, or an action confirmation.

## Verification

An isolated browser call exercised the production controller, prompts,
greeting template, invitation framing, and lookup tool definition with a
synthetic profile. Both live Realtime voices gave brief social replies without
task suggestions, capability menus, or offers of help. A final lookup trial
used a four-word acknowledgement and preserved the supplied answer details.
The sports evidence was a labeled synthetic fixture to isolate speaking
behavior. Audio recordings were captured, no browser or API errors occurred,
and End closed both sessions. Verification covered the wording and audio
delivery; the recordings were not evaluated by ear in this runtime.

The 102 targeted voice, controller, route, and settings tests passed. The
full `dev:check` gate passed after the final changes.
