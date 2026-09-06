---
created: 2026-09-05
updated: 2026-09-05
---

# The prompt library

Settings → Prompts (`/settings/prompts`) lists the actual `.prompt.md` files
beneath the configured code directory's `src/`, plus custom notebook prompts.
The default list shows custom prompts and customized built-ins. “Show built-in
prompts” reveals the rest; search and the count follow that filter. Built-ins
remain available through direct links and template references while hidden.
One editor handles instructions, output templates, and subprompts. Visual and
Markdown views share the existing Markdown editor's document model, preserving
frontmatter and source formatting when switching views.

## Storage and runtime

`PromptCatalog` in `catalog.ts` owns discovery, effective content, source usage,
validation, preview, and writes. Its roots are injected for tests. Production's
`createPromptCatalog()` uses `DIR_CODE_SRC` and `ai/prompts` in the notebook.

A built-in prompt's ID is its path relative to `src/`. A customization is an
ordinary Markdown file at `ai/prompts/<id>`. New prompts live under
`ai/prompts/custom/<name>.prompt.md`. Restore removes a built-in's override.
Source files are never written by this feature.

Callers read prompts through `readPromptFile` in `load.ts`. Every load checks for
the notebook override and expands saved template references; nothing caches the
contents. Existing sessions that already assembled a system prompt retain it.
The next load uses the latest text. External prompt paths remain ordinary reads
and are not part of the built-in catalog.

## Templates and preview

`{{> email-template}}` includes a sibling `email-template.prompt.md`.
`{{> "/custom/email-template.prompt.md"}}` uses a catalog-root ID; Insert template
writes this unambiguous form. Relative paths can reach another directory inside
the catalog. References accept a static name without arguments. Cycles, missing
files, traversal outside the catalog, excessive nesting, and oversized expansion
are refused. Included YAML metadata is omitted; the containing document keeps its
frontmatter. The shared Handlebars context applies to the assembled body.

The preview expands the current unsaved document with each referenced document's
saved content, then evaluates Handlebars without HTML escaping. It never invokes
an AI or reads the user's profile, conversations, or notebook context. Sample
values are synthetic and temporary. Metadata comes from the edited prompt;
notebook weekday derives from a simulated notebook date. Variable inspection
understands direct paths, conditionals, and JSON collections for each/with. Scoped
collection fields belong to that collection's JSON value. Unknown helpers surface
as preview errors, rather than fabricated output.

Usage is detected from code references to prompt filenames and references from
other prompts. Code references carry their source file and line; duplicate
basenames resolve to the nearest owner only when unambiguous. Dynamic or external
consumers may not be detectable, so an empty usage list says “No source reference
found,” rather than claiming that the prompt is unused.

## Saving and editing

The settings API is in `service/handler/settings/prompts.ts`. Reads and writes
accept catalog IDs, not arbitrary paths. Cross-origin browser requests are refused.
File paths reject symlinks within the catalog. Saves compare the effective content
hash, serialize in-process writes, validate YAML and template syntax, and atomically
rename a temporary file into the notebook. A conflict retains the browser's edit
and offers an explicit reload; there is no silent overwrite.

The visual editor's `local` option disables its existing file API, polling, and
autosave. `content()` flushes pending edits through the normal parser before
serializing, and `onChange` feeds the draft and preview. Formatting uses the same
commands and undo stack as the document editor. Explicit Save and Command/Ctrl+S
write through the catalog. Switching modes remounts from the current Markdown;
undo history is local to each visual editing session. In-page drafts survive
navigation, and leaving the tab warns if any draft is unsaved.

## Notes

- [2026-09-05 — Editable prompts must reach their callers](2026-09-05-editing-prompts.md).
