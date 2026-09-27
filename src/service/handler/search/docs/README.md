---
created: 2026-09-08
updated: 2026-09-27
---

# Notebook search

`GET /search/_api` searches the loaded markdown stores. It does not walk the
notebook or create records. Names and aliases lead, followed by titles,
metadata, and body text. Type filters and sorting apply before pagination;
the total describes the filtered result set. Every result is restricted to
the notebook root and the configured readable directories.

The derived text cache follows `MarkdownStore.version`, so edits and deletions
invalidate it. The query has no per-type candidate cap: stopping early can
hide an exact match or make a type filter incorrectly appear empty.

Date queries resolve on the server using notebook time. A time document's
partition date takes precedence over its last edit date. Day results open
`/<YYYY-MM-DD>`. A recognized day can be opened even without a day file, but
that navigation shortcut does not count as an existing document.

People, organizations and places open on their pages; other records open in
Explorer. A profile's address is the slug People & Orgs reserves for it, so
the route asks that store; when it cannot answer, profiles open as files and
search still works. A place opens at its ref, unless another record claims
the same ref: the page cannot tell them apart, so both open in Explorer.

`theme/client/search.tsx` owns the persistent header and `/search` page.
The query, filter, ordering, and page offset live in the URL so Back and
reload restore the search. Requests cancel on query changes; results for
an old query never remain selectable while a new one loads.

Quick search leaves the page and its existing rail mounted. Its Escape
handler runs before the rail's, so dismissing search does not also close
the rail. The full results page replaces that surface with a results list
and one preview column; phones show that preview as a separate step.
Previews use the existing Explorer and backlink APIs and the shared
`RenderedHtml` component so unrelated renders preserve text selection.
