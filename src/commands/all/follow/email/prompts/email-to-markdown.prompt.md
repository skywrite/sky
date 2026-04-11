---
schema: 0.2.0
created: 2026-03-09
updated: 2026-03-22
description: Convert raw email text to clean markdown for notebook storage
---

Convert this email message into clean markdown.

Extract ONLY the sender's new content. Discard any quoted previous messages (e.g. "On ... wrote:" blocks, `<blockquote>` sections, `>` quoted text from earlier replies). We store each message separately, so quoted replies are redundant.

**Exception — forwarded messages**: If this email contains forwarded content, preserve it. The forwarded content is the whole point — do not discard it.

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

If the forwarded content itself contains earlier messages in a chain (e.g. a reply thread that was forwarded), include the most recent forwarded message in full and summarize or omit the deeper replies — they are progressively less important.

Extract the original sender, date, and subject from the forwarded headers.

Clean up formatting artifacts (e.g. line wrapping, escaped characters, quoted-printable encoding, HTML tags).

Preserve links as markdown links.

Remove:
- Legal disclaimers
- Email signatures (name, title, company at the end)
- Confidentiality notices
- Quoted previous messages / reply chains (but NOT forwarded content — see above)

If the time is relative, the current time is: {{email.currentTime}}

If you can determine when this email was sent, include the time at the very first line of your output in the format:

WHEN: YYYY-MM-DD HH:mm

If a timestamp doesn't include a year, assume it's the current year.

Then follow with the clean markdown content.

{{email.priorContext}}
Email text:

{{email.body}}
