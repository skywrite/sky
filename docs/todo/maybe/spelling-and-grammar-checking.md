---
created: 2026-10-27
updated: 2026-10-27
---

# Spelling and grammar checking

Consider built-in spelling and grammar suggestions in the shared Markdown editor, available to journals, documents,
and drafts.
This is an idea to evaluate, not scheduled implementation work.

## Current behavior

The [editor](../../../src/web/client/editor/wysiwyg/mod.ts) already enables browser spellchecking with
`root.spellcheck = true`.
Its availability and suggestion interface depend on the browser's settings and installed extensions.
Sky does not currently provide its own grammar checker or correction interface.

## Possible experience

Start with quiet underlines and clickable suggestions, with Accept, Ignore, and Add to dictionary actions.
Keep stylistic advice optional so checking does not interrupt informal journaling or change the writer's voice.
A simpler first version could offer a Check writing button with suggestions to review and apply.

## Engine to evaluate

[Harper](https://github.com/automattic/harper) is an open-source English grammar checker that can run locally in the
browser through WebAssembly.
Its JavaScript package provides background processing without blocking typing through
[WorkerLinter](https://writewithharper.com/docs/harperjs/ref/harper.js.workerlinter.html).
Bundling the engine with Sky would allow checking without sending notebook text to another service.
Evaluate spelling and grammar quality on synthetic writing before choosing it; English-only support is a limitation.

[LanguageTool](https://dev.languagetool.org/http-server) is another option, with a locally hosted server or a cloud API.
A local server adds installation and service management, and its rules differ from the cloud offering.
For automated checking, its [public API guidance](https://dev.languagetool.org/public-http-api) requires a hosted
instance or an Enterprise account rather than automated use of the free public endpoint.

## Integration work

The main difficulty is applying suggestions reliably inside the custom Markdown editor, rather than calling a checker.
The existing [find-and-replace implementation](../../../src/web/client/editor/find.ts) already maps visible text to
Markdown and paints highlights without changing the document's DOM.
Those mechanisms are a useful starting point, but grammar suggestions spanning formatting need separate handling.

- Keep underlines aligned while typing and discard results for text that has since changed.
- Preserve Markdown formatting, cursor position, selection, undo, and autosave when applying a correction.
- Skip code, link destinations, and other non-prose content.
- Persist ignored words and a personal dictionary so names and technical terms are not repeatedly flagged.
- Verify typing responsiveness, formatted text, composition input, browser compatibility,
  and existing checker extensions.

## Rough effort

These are preliminary engineering estimates based on the current editor, not a tested integration or a delivery promise.

| Scope | Estimate |
| --- | --- |
| Browser spellchecking | Already enabled |
| Check writing button with reviewable, applicable suggestions | 1–2 days |
| Live underlines, corrections, Ignore, and personal dictionary | 3–5 days for a first version |
| Polished inline integration with compatibility and editor testing | 1–2 weeks total |

The first evaluation should establish suggestion quality and a reliable correction path through the editor's history.
The shared editor lets the resulting integration benefit multiple writing surfaces without replacing the editor.
