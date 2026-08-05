---
schema: 0.2.0
created: 2026-03-09
updated: 2026-08-05
description: Convert raw email text to clean markdown for notebook storage
---

Convert this email message into clean markdown.

Reproduce the content word-for-word. Never summarize, condense, or reword — your only changes are structural: convert markup to markdown and apply the removals below. A long email produces a long output.

Extract ONLY the sender's new content. Discard any quoted previous messages (e.g. "On ... wrote:" blocks, `<blockquote>` sections, `>` quoted text from earlier replies). We store each message separately, so quoted replies are redundant.

**Exception — forwarded messages**: If this email contains forwarded content, preserve it in full. The forwarded content is the whole point — do not discard it, and if it contains an earlier reply chain, include the complete chain verbatim.

Recognize ALL forward styles:
- Gmail: `---------- Forwarded message ---------` or `---------- Forwarded message ----------`
- Outlook: Inline `From:` / `Sent:` / `To:` / `Subject:` header block (no explicit "forwarded" marker)
- Apple: `Begin forwarded message:`
- Subject line starting with `FW:` or `Fwd:` is a strong signal that the body contains forwarded content

Format the output as:

1. The sender's own commentary first (if any)
2. Then EACH forwarded message as a blockquote with attribution:

```
> **From:** Original Sender
> **Date:** YYYY-MM-DD
> **Subject:** Original Subject
>
> Forwarded content here...
```

Extract the original sender, date, and subject from the forwarded headers.

Clean up formatting artifacts (e.g. line wrapping, escaped characters, quoted-printable encoding, HTML tags).

Preserve links as markdown links.

Remove:
- Legal disclaimers
- Email signatures (name, title, company at the end)
- Confidentiality notices
- Quoted previous messages / reply chains (but NOT forwarded content — see above)

Output the markdown only — no preamble and no code fence wrapping the message.

{{email.priorContext}}
Email text:

{{email.body}}
