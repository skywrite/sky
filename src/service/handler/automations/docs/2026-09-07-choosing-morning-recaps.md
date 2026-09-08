---
created: 2026-09-07
updated: 2026-09-07
---

# Choosing morning recaps

The automation page accepted only sentences, making it hard to discover available
commands or specify routine conditions. A morning recap setup also often includes
several installed commands. Handing those selections back to a model would add
latency and uncertainty to choices that can be represented directly.

The editor now reads the installed command catalog, offers searchable multiple
selection, and converts the selected schedule and arguments into validated file
previews. One command remains one charter. This preserves the existing scheduler's
sequential execution, independent failure reports, pause controls and ledgers.
A partially saved batch reports how many files became active and retries only
the remainder. Complex existing triggers stay available through a custom schedule;
revisions retain unrelated metadata and prose.

The less visible issue was the execution boundary. A charter holds raw YAML, while
`CommandService` expects explicit overrides to be parsed already. Passing
`args.day` directly could overwrite a parsed date with its original string. Both
manual and scheduled automation runs now parse charter arguments before invoking
the command. Relative `today` and `yesterday` values for date parameters resolve
on the firing's clock each time, so a recurring recap neither freezes the day it
was created nor depends on whether the morning's day-start command has run.

Tests use a temporary synthetic notebook, scripted command metadata and no model
or external command calls. They cover catalog shadowing, validation, metadata
preservation, typed date arguments across days and time zones, keyboard selection,
mobile layout, file previews, batch recovery and editing saved settings.
