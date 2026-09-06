---
created: 2026-09-05
updated: 2026-09-05
---

# Editable prompts must reach their callers

The approved editor combined a simple library, usage labels, a visual/Markdown
editor, and a rendered preview with simulated context. Implementing that against
browser storage alone would make saving appear successful without changing any
AI behavior. Writing personal preferences into the public source tree would also
make ordinary customization a code modification.

The library therefore stores overrides in the notebook using stable source-relative
IDs. Runtime readers check those overrides at load time. IDs retain the full path
because several prompts share a basename. New prompts use a custom namespace and
can be included by another document using a named template reference.

The production editor already preserves the original Markdown structure. A local
mode lets the prompt page own Save and preview while reusing that model, its
formatting commands, and undo. Reading pending text must run the existing repaint
path: directly mutating model text before repaint would suppress syntax re-lexing.

Verification uses temporary source and notebook roots. It exercises template
propagation, concurrent saves, restore, malformed input, path boundaries, and the
HTTP contract. Browser checks mount the real page against those temporary roots
and exercise both editor modes and saved-file behavior without writing user data.
