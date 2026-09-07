---
created: 2026-09-07
updated: 2026-09-07
---

# Sunny joins the conversation

Sunny originally received a speaking turn only when research produced a
report. Sky's instructions reinforced that restriction: addressing Sunny
meant starting research. An ordinary request to hear from her therefore
turned into a demand for a research topic, even when all the user wanted
was a greeting. Prompt wording alone could not provide the missing turn.

`invite_sunny` gives Sky a browser-local conversational handoff. It carries
the user's request to Sunny's existing Realtime session, with the same
starting context and mirrored conversation. Greetings, small talk, and
follow-ups grounded in that context need no notebook lookup or Astra job.
Questions needing fresh evidence still use the research tools.

The browser waits for Sky's current playback to drain, then gives Sunny
the turn without generating another Sky acknowledgement. Invitations stay
separate from research reports: they do not appear as research activity or
saved findings, and an interrupted greeting does not become a paused report.
A newer user turn supersedes a queued invitation. Existing interruption,
playback, and End controls apply to Sunny's conversational turns as well.

The personas now use names and personal pronouns for each other. Sky's
style favors short, relaxed replies and natural handoffs, without unsolicited
capability descriptions or repeated offers to help. Sunny can greet the
user and take part in the conversation as well as explain her findings.

Invitations preserve the user's request without adding a mood, a greeting
script, or unsolicited questions. A bare request to hear Sunny asks for a
brief greeting, then leaves space for the user. The turn-specific instruction
reinforces this instead of broadly inviting a new topic or a performance.

Live browser verification used synthetic speech to ask to hear Sunny, greet
her, and ask a simple follow-up. Sunny answered through her own audio
connection, without any notebook or web research calls. Both connections
closed on End, with no overlapping playback intervals or API errors.
