---
created: 2026-09-07
updated: 2026-09-07
---

# Replacing a selected command

An existing automation used the batch command picker with `maxValues: 1`.
Its saved command already occupied that slot. Search still showed other commands,
but clicking one did nothing: the multi-selector would not add a second value.
The person would have had to remove the current command first, with no explanation
of that requirement. The edit controls were also below the brief and schedule.

The edit flow now uses a searchable single selector, so a new selection replaces
the old one. The create flow retains multiple selection for batches. An explicit
Browse commands action opens the catalog, and Edit automation in the page header
brings the editor into view and focuses its command field. On phones the header
actions wrap below the automation name.

The browser regression first failed by leaving `recap:journal` selected after
choosing `recap:notes`. It now verifies that the catalog opens with the existing
selection intact, replacement works, the new command is saved under the same
automation filename, and the editing controls stay visible on a phone.
