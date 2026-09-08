---
created: 2026-09-08
updated: 2026-09-08
---

# Questions carry across speakers

Completed spoken turns already reach the other voice through the browser's
conversation mirror. Nevertheless, both persona prompts encouraged a question
back during greetings and illustrated it with isolated two-person exchanges.
That gave each speaker a pattern for restarting the same check-in when the
user changed whom they addressed.

Both prompts now explicitly treat questions, answers, volunteered details,
and corrections as shared conversation context. A question that is still
pending or already answered should not be repeated, even in different words
or by the other voice. A relevant change or an explicit request to revisit
it can justify asking again. A reciprocal check-in remains natural when no
one has asked and the user has not already supplied the answer.

Invented three-person examples demonstrate both speaker orders, a pending
question while the user checks the other voice's presence, and a short
agreement that leaves the next turn to the user. Changing addressee does not
reset the greeting or require another introduction. A second contribution
should add something useful; a complete reply needs no automatic follow-up
question, work offer, or new topic.

The change belongs in the personas. Transcript transport already supplies
the context, and the browser already controls who has the floor. No new
question classifier or transcript rewriting is needed for these rules.
Prompt changes apply when starting a new call. Automated checks cover prompt
rendering and conversation mirroring; natural spoken behavior still needs
to be assessed in a fresh call.
