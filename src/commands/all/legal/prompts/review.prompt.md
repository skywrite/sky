---
name: legal-review
schema: 0.2.0
created: 2026-08-08
updated: 2026-08-08
description: Mission brief for reviewing a legal document and leaving comments on it
---

Review the target Google Doc as a careful legal reviewer working for ME — the party who has to live with this document — and leave your findings on the file.

Read the whole document first. Its type sets the agenda: a services agreement, NDA, lease, employment offer, terms of service and data-processing addendum each have their own shape. Work through what actually applies:

- **Money**: amounts, what triggers them, price-increase and true-up rights, late fees and interest, expenses, taxes, who eats currency and payment costs.
- **Time**: start and end dates, initial term, auto-renewal and the notice window that stops it, and every other deadline that runs against me.
- **Getting out**: termination for convenience and for cause, cure periods, what survives, what must be returned or deleted, and what I still owe after the exit.
- **Risk**: liability caps and what they exclude, indemnities and which direction they run, warranties and disclaimers, insurance obligations, force majeure.
- **Ownership and confidentiality**: who owns what is created, licenses granted and their scope and duration, background IP, confidentiality duration and carve-outs, publicity and reference rights.
- **Data and compliance**: personal-data handling, security commitments, breach notice, subprocessors, audit rights, cross-border transfer, regulatory obligations.
- **Control**: assignment and change of control, subcontracting, exclusivity, non-compete and non-solicit, most-favored-nation, unilateral amendment rights.
- **Disputes**: governing law, venue, arbitration and its class-action waiver, jury waiver, fee shifting, notice mechanics.

Judge each provision by what it does to me, not by whether it looks standard. Weigh: what is unusually one-sided, what is missing that I would expect to protect me, what is vague enough to be argued either way later, what obligation I could miss and be in breach of, and what is internally inconsistent or refers to a schedule or exhibit that is not here.

{{#if review.focus}}
Weight the review toward what I have flagged, without dropping anything material elsewhere: {{review.focus}}
{{/if}}

## Leaving your findings

Put every finding on the document itself as a real anchored comment — add_anchored_comment, with searchText copied verbatim from the clause — so the passage shows highlighted with your comment pinned to it. Prioritized, at most 12 anchored comments — the material ones. Fold anything lighter into the summary rather than burying the important findings among nits.

Each comment opens with its severity in brackets — `[High]`, `[Medium]`, `[Low]` — then says in plain language what the provision does to me and what to ask for instead. High is real exposure or a right I lose; medium is worth negotiating; low is cleanup and clarity. Write for a smart reader who is not a lawyer: no citation formatting, no hedging into uselessness, and never quote a clause back at me without saying what it means.

When a finding has a concrete rewrite, propose it as a suggested edit as well, so I can accept it with one click, and keep the reasoning in the comment.

Finish with one summary comment titled `[Summary] Contract review`, left with the file-level add_comment tool — a whole-document note belongs in the comments panel, and it is the only comment that does: the three or four things I should actually negotiate, the lighter findings you folded in, anything you could not assess because it referred to a missing schedule or exhibit, and one line noting this is a careful review, not legal advice.

Then report back what you found — the headline risks and what you left on the document.

## Discipline

- Do not edit the document text directly. Comments and suggested edits only — this document is a record of what the other side sent.
- Anchor to text you copied verbatim from the document, and never invent a term, number or date the document does not contain.
- Findings never go to the comments panel. When the browser session fails and an anchored comment cannot be placed, do not fall back to add_comment — even though that tool's description suggests it. Carry every unplaced finding into your closing report instead (severity, the clause's verbatim text, what you would have said) and note that the session needs `sky google:browser`. The `[Summary]` comment is the one legitimate panel comment.
- If a suggested edit cannot be placed, keep its anchored comment and move on; never demote a finding or a rewrite to a panel comment.
- Report a missing protection as a finding in its own right; absence is as material as bad wording.
- This Doc may have been converted from a PDF, so layout artifacts — broken tables, split lines, lost numbering — are conversion noise, not drafting defects. Ignore them, and say so if the conversion left the text unreadable in places.
