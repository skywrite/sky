---
schema: 0.2.0
created: 2026-02-13
updated: 2026-02-13
description: Convert captured HTML from browser extension to structured markdown with metadata
---

Convert the following HTML to Markdown. This HTML is a message, sometimes the message is a dialogue with multiple parties.

Typically either Slack or Email. But not always.

If the dialogue contains timestamps of each person's message, be sure to include it and the person's name in bold.

Sometimes the HTML lacks relevant context we need for the markdown output.

The user may supply additional context to supplement the HTML. This context often contains:
- The recipient ("to X" or "from Y to X")
- The sender ("from X")
- The channel or thread name
- Natural language dates ("yesterday", "last Tuesday", "2 days ago")

USER_SUPPLIED_EXTRA_CONTEXT: {{capture.userSupplement}}

**IMPORTANT**: Parse the user-supplied context carefully for "from", "to", and date/time information.
Common patterns:
- "Slack from Alice to Bob" → from: "Alice", to: "Bob"
- "from Alice to Bob" → from: "Alice", to: "Bob"
- "to Bob" → to: "Bob"
- "Slack to #channel-name" → to: "#channel-name"
- "Slack from Alice" → from: "Alice"
- "yesterday" or "last Tuesday" → convert to YYYY-MM-DD HH:mm format

User-supplied context takes priority over HTML-extracted values for these fields.

Be sure you return the markdown in a JSON blob like:

{
  "markdown": MARKDOWN_CONTENTS_HERE
}

If the sourceUrl is Slack, be sure you convert any text with "====" under it
to a Header 1 "#".

Source url site: {{capture.sourceUrl}}

If the source site is Slack, insert into the JSON:

{
  "medium": "Slack",
  ...
}

If the source site is Gmail, insert into the JSON:

{
  "medium": "Email",
  ...
}

If it's Twitter or X.com, the source is "X"

If you do not know the medium, do not include it.

We need to create a summary title of the Markdown contents.

Keep the summary to 8-10 words maximum. Do not include a person's name.

If there is a Header 1, that should likely be the summary.

However, if the Header 1 summary lacks sufficient details, append a few extra words to the Header 1 summary.

{
  "summary": SUMMARY_HERE
  ...
}

If you're able to capture an email subject, insert into JSON:

 {
  "subject": SUBJECT_HERE
  ...
}

If you're able to capture who the message is from:

{
  "from": NAME_HERE
}

If the message is from "{{me.fullName}}", shorten to "{{me.firstName}}".

If you're able to capture who the message is to (recipient):

{
  "to": RECIPIENT_NAME_HERE
}

This is especially important for Slack messages where "to" indicates the channel or person.
Check the user-supplied context first for "to" information.

For cc and bcc (email only):

{
  "cc": ...,
  "bcc": ...
}

If there are multiple names for the to, cc, or bcc, separate the names by ",". Do not make the field an array. It can be a string with commas.

Also if the full name and email address is available for the person, only use the full name.

If you can capture an email subject, please include it in the JSON.

If you can capture a time, include that as well.

If the time is relative, the current time is: {{capture.currentTime}}

If a timestamp doesn't include a year, assume it's the current year.

Note, you may have to convert times if the user supplied context makes it clear it's a different time zone.

Insert the time into the JSON:

{
  "when": TIME_HERE (FORMAT: YYYY-MM-DD HH:mm)
}

DO NOT SUMMARIZE THE MARKDOWN CONTENT.

HTML:

{{capture.html}}
