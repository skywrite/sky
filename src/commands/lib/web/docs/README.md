---
created: 2026-09-22
updated: 2026-09-22
---

# Reading web pages

Chat's `web_fetch` and voice research's `read_web_page` share HTML extraction,
section selection, snapshot caching, and UTF-8 excerpt boundaries here. Hosts
retain their own evidence and call budgets. Page downloads have no byte ceiling;
limits apply to excerpts returned to the model. `next` continues retained text.

Keep a reader for the whole chat session or research run. Recreating it with
each turn's tools loses the page behind earlier continuation positions. The
cache holds at most eight downloaded pages and deduplicates concurrent requests
for one URL, excluding its fragment. It is memory-only; after eviction or a
service restart, a continuation must explicitly restart instead of silently
fetching a changed page and applying an old offset. Snapshot digests check
identity; they are not user-content record IDs.

Offsets and byte counts address extracted Markdown, not the response HTML.
For a fragment URL they address that section's Markdown. `totalBytes` describes
that scope; `pageTotalBytes` describes the whole extracted page. A heading
section includes its descendants up to the next heading of equal or higher
rank. A container anchor selects that element. Missing anchors are explicit
failures with available sections, never a fallback to the page's beginning.

Both hosts retain the complete response; neither a per-page nor a shared
download-byte budget may discard source text. Chat returns 20 KB excerpts;
voice retains its research context budget. Network failures and cancellation
fail the read rather than cache a partial response. HTML is converted deterministically to Markdown with headings,
paragraphs, lists, tables, code, and absolute links; no model summarizes away
source material during extraction. JavaScript is not executed.
