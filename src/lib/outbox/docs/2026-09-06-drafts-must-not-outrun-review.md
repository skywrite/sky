---
created: 2026-09-06
updated: 2026-09-06
---

# Drafts must not outrun review

A periodic scan and a draft editor have different clocks. While the model prepares a reply to an example project update, another message can arrive or the owner can replace the draft with a shorter answer. Treating the model result as the latest truth would erase the owner's edit or make a reply to an obsolete question look ready.

Outbox separates the processed source version from the stored decision revision. The scanner deduplicates the former and must compare the latter before writing. It rechecks captured messages after model work. Edited drafts keep their text and expose new context for review. Approval then performs its own source check and atomically claims the decision before attempting a native draft write.

Native writes introduce another uncertainty: a network failure can occur after the app accepted a draft. Retrying creation could duplicate it. Outbox records approval and an in-progress placement first, stores Ready only after confirmation, and leaves an ambiguous result for the owner to check. These states deliberately stop at draft placement; actual sending is a separate human act.
