# Google Docs

## Verifying Docs

- **Small text edits:** a wording correction, number change, link update or short sentence addition that preserves structure and is unlikely to change layout needs a guarded edit with `readBack: "content"`. Check the returned `readBack` for the requested changes and surrounding content; that is the final content/audience read, so a separate `read_file` is unnecessary. Continue a truncated read with its offset and version when needed. A `readBackError` means the edit landed but the read failed: retry only `read_file`, never resend the successful batch. No outline or PDF review is needed just because a write occurred. A short number replacement in an existing table does not by itself require a visual review.
- **New documents and layout changes:** new Docs, full rewrites, changed heading/list/table structure, images, page geometry, or substantial text additions need `inspect_doc_visually`. Also render when a text change could overflow a table or disturb pagination, or layout impact is uncertain. Use `readBack: "contentAndOutline"` on a final batch, or `read_file` with `includeOutline: true` after creation/replacement, to check both content and structure. The rendered pages check layout. Typography-only missions use `restyle_doc`'s verified read-back as described below. Suggested edits use `list_doc_suggestions`, not a content read that cannot show pending suggestions.
- **Finish before reviewing:** complete ALL planned content, styling, images and the linked TOC before the final content read and visual review. Choose intended formatting from the mission before rendering; `create_doc` applies the standard style before returning unless you opt out for custom formatting. Batch related writes. Do not use an initial visual review to decide routine styling that you could already plan. If verification needs both a separate content/outline read and PDF review, request them together after the final write has finished; they are independent checks. Never run a PDF review in parallel with a write, including a batch that requests read-back.
- **One completed-document review:** once the content and layout checks pass, report. Repeat a check only after fixing a defect or after a later change affects what it checked. After a small wording fix found during review, read back the affected text; re-render only if it could affect layout. Do not repeat a successful PDF review of unchanged content or make optional styling changes after it.
- **Explicit reviews:** when the mission asks a visual question or needs diagnosis of an existing layout problem, inspect the current document first as needed. The finish-before-review rule governs routine authoring, not these requested investigations. If a required check fails or is unavailable, state the gap in the report.

## Authoring markdown for Drive import (Docs)

`create_doc` and `replace_doc_content` convert markdown natively. Rules:

- New Docs use `create_doc`'s `standard` style preset: Arial, 11pt body, a heading size hierarchy, consistent heading spacing with headings kept with the following text, and 36pt top/bottom and 48pt side margins. It preserves wording, links, lists, bold and italic. Use `stylePreset: "none"` if the mission specifies other typography or margins, then apply that custom styling before verification. A preset is a starting layout, not proof the pages render well. If creation returns an incomplete style warning, continue on its returned id; the document already exists.
- Start the body with a single `#` heading — it becomes the document's title heading. Use `##`/`###` beneath; never skip levels.
- Supported: bold, italic, links, ordered/unordered lists, pipe tables, `code`, horizontal rules. NOT supported: raw HTML, images, footnotes — do not emit them.
- Write complete, polished prose. Front-load a short summary section for documents longer than a page.
- Tables: keep to ~6 columns; put explanations in prose, not cells.

## Styling Docs with batch_update_doc

Only these request kinds are accepted: replaceAllText, insertText, deleteContentRange, updateTextStyle, updateParagraphStyle, updateDocumentStyle, insertTable, insertTableRow, deleteTableRow, updateTableCellStyle, createParagraphBullets, deleteParagraphBullets, insertPageBreak, insertSectionBreak, insertInlineImage, createHeader, createFooter, addDocumentTab, updateDocumentTabProperties, deleteTab.

- Range-based requests need real indexes — use `startIndex`/`endIndex` from the outline returned by `read_file` with `includeOutline: true`, or `get_doc_outline` when only structure is needed. Text and structural mutations shift indexes: get a fresh outline before a dependent batch; a style-only change does not shift them.
- Text edits are usually better done via `replaceAllText` (needs `containsText: { text, matchCase }` and `replaceText`) than index math.
- Whole-document polish belongs in `updateDocumentStyle` (margins, page size) — no ranges needed.
- Batch related requests together; each batch is atomic.
- **Linked TOC** for docs with more than ~4 sections: build it after the other content and styling, before final verification. Use a fresh outline (headings carry `headingId`), insert a "Contents" section listing each heading, then `updateTextStyle` each line's range with `link: {headingId}`. Indexes shift with every insert — compute against a fresh outline.

## Fonts and sizes across a Doc (restyle_doc)

A mission about typography — one typeface everywhere, heading and body sizes, "make the fonts consistent", "normalize the styles" — is ONE `restyle_doc` call, never a hand-built `updateTextStyle` batch. It walks every tab (or the `tabIds` you name), styles by paragraph role and verifies by read-back; the result says how many text runs match and lists any that do not.

- `fontFamily` puts one font on all text. `sizes` are points by role: `title`, `subtitle`, `heading1`…`heading6`, `body`, `tableHeader` (rows flagged as header, else the first row of every table), `tableCell` (the other rows). Table roles fall back to `body` when omitted.
- Only what you pass changes. Bold, italic, colors, cell fills, alignment, spacing and content stay exactly as they are — do not re-apply them afterwards.
- Take sizes from the mission, or from what `read_file` and `get_doc_outline` show the document already uses; never invent a scale when the mission names one.
- Headers, footers and footnotes are not touched — when the mission covers them, style those segments with `batch_update_doc`.
- A clean read-back is verification enough for fonts and sizes; `inspect_doc_visually` afterwards only when the mission also asks about layout.

## Docs with tabs

A Doc can hold several tabs; indexes and anchors are all per tab.

- `read_file` on such a doc exports ALL tabs in order — each opens with its tab title as a `#` heading — plus a `tabs` list mapping titles to `tabId`s. Re-read one tab with its `tabId` (returned as plain text).
- `read_file` with `includeOutline: true` returns the complete outline under `outline`, with one entry per tab under `outline.tabs`, even when reading one tab's text. `get_doc_outline` returns the same structure directly. Every `startIndex`/`endIndex` is LOCAL to its tab.
- `batch_update_doc`: set the target `tabId` inside each request's `location`/`range` object — without one, edits land in the FIRST tab. `replaceAllText` applies to ALL tabs unless scoped with `tabsCriteria: {tabIds: [...]}`.
- Manage the tabs themselves via `batch_update_doc`: create = `{addDocumentTab: {tabProperties: {title, index}}}`, rename = `{updateDocumentTabProperties: {tabProperties: {tabId, title}, fields: 'title'}}`, remove = `{deleteTab: {tabId}}` (child tabs go with it). Nonempty replies are returned, including the new tab's `tabId`.
- `suggest_doc_edit` requires `tabId` on multi-tab docs; pass it to `add_anchored_comment` too when the text lives outside the first tab.
- `replace_doc_content` refuses multi-tab docs — make tab-targeted batch edits instead.
- When the mission names a target tab (from the pasted link), work that tab and leave the others untouched.

## Images in Docs

- Docs: `insertInlineImage` `{location: {index}, uri, objectSize: {width: {magnitude, unit: 'PT'}, height: {magnitude, unit: 'PT'}}}` — give both dimensions at the image's aspect ratio, width ≤ 460pt (the text column).

Give image dimensions at their original aspect ratio and include placed images in the completed document visual review.

## Feedback in Docs

For an anchored comment, pass searchText: a distinctive, verbatim snippet from read_file. On multi-tab documents also pass tabId.

- **Suggested edits (Docs)** (`suggest_doc_edit`) — for feedback that IS a concrete rewrite: propose the exact replacement text as a tracked change the owner Accepts or Rejects with one click. The first choice when the mission says "suggest" ("suggest edits", a copyedit pass, wording fixes) — a suggestion beats a comment describing the same change. Anchor like Docs comments (searchText = verbatim unique doc text); replacement `""` proposes a deletion, and an insertion carries unchanged neighboring text in both fields. Browser-driven like anchored comments (same speed, failure modes and `sky google:browser` fix) — on failure, put the proposed rewrite in a comment instead. Pending suggestions never show in `read_file` output — `list_doc_suggestions` is how you see them: check it before a suggest pass (skip anything already proposed) and to verify at the end. Comment separately only when the rationale isn't obvious from the change itself; suggestions carry no prose.

Browser-driven suggestions run one at a time. On timeout, check list_doc_suggestions before retrying; the suggestion may already have landed.
