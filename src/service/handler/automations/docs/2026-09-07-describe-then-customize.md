---
created: 2026-09-07
updated: 2026-09-07
---

# Describe, then customize the same automation

Command completion and condition controls had become the starting point for
creation. Description was a separate mode, and moving from a described proposal
to the controls did not carry the proposed settings. For an existing automation,
the controls loaded its saved file, losing the changes just described.

Creation now begins with the description prompt. The resulting preview has a
Customize action beside Turn it on. Direct selection remains available through
Choose commands instead, including the morning recap batch preset.

The draft response includes settings parsed from its validated contents. The
builder accepts these settings for both creation and revision; an unsaved new
proposal has no revision target and therefore needs no existing file. A described
proposal uses one searchable command selector, so a replacement keeps the
generated name. The original charter accompanies that selection as a template;
customization rewrites the chosen fields while preserving comments, metadata and
an unchanged prose body. A described revision uses its proposed contents as the
template, so customization continues from the new instructions.

Changing a control withdraws the earlier save action until a fresh preview is
ready. Describing, customizing and previewing do not write files or execute
commands. Existing edit controls stay mounted when switching to describe a change,
so switching back without a new proposal preserves unfinished edits.

The browser regression uses synthetic recap commands and scripted drafts. It
checks the default prompt, prefilled command, arguments, time, time zone, end date
and name, then changes a command and time and saves. It also describes a revision,
customizes the proposed settings, and applies both changes to the same file.
