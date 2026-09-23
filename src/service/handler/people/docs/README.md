---
created: 2026-09-23
updated: 2026-09-23
---

# People & Orgs

The entry lives above **Settings** in the existing settings sidebar. `/people`
and `/orgs` share that navigation; neither adds a destination to Today or Explorer.
Profiles use flat name slugs, such as `/people/jane-doe` and `/orgs/atlas`.
Notebook-relative filenames remain the edit/source identifiers, including `.md`;
old profile URLs redirect to the clean route. Local URL reservations under
`stateDir/people/<notebook-hash>` allocate numeric suffixes for namesakes and keep
slugs through name edits and service restarts. Reservations are never reused after
deletion. A unique unchanged document can be followed through a file move; a move
combined with an external edit, or ambiguous identical copies, cannot safely be
identified and receive new routes. This registry stores routing metadata only.
The existing MarkdownStore supplies people, organizations, and backlinks; new
records are immediately published back into that store.

Lists enumerate the complete path index, not the name index, which can hold only
one of several namesakes. Organization matching first uses an explicit record,
then a LinkedIn company URL, then an exact name or alias. Ambiguous names or
conflicting company URLs require an explicit link or separate creation. People
retain `orgs.current` and `orgs.past` as readable names for existing
consumers. Optional `org_refs` stores the corresponding names and notebook paths
to preserve an explicit choice between organizations with the same name. A stale
path does not silently select another namesake.

Search results rank by the existing service person/organization scores, with
alphabetical ties. Without a search, the selected alphabetical or recent ordering
applies. Scores refresh independently of the cached Markdown profile metadata.
Empty Markdown sections and historical heading echoes are hidden at rendering;
the source file stays intact, including its template headings.

Metadata edits patch the YAML document, retaining unknown keys and YAML comments.
Existing Markdown is preserved verbatim. Notes append a dated section. Writes
require the reviewed content hash, run under a local process lock, and publish
atomically. This lock coordinates these UI writes; external notebook editors do
not participate, so writes also recheck the file before replacement. Creation uses
the notebook timezone and `YYYY-MM-DD_HHMMSS_Name`, with exclusive publication and
case-insensitive collision checks. No operation overwrites another profile to
resolve a filename collision. Organization records created during a person save
can survive a later failure saving that person; a retry matches and reuses them.

## LinkedIn draft lifecycle

`lib/linkedin` owns a persistent local browser profile and a detached `lib/jobs`
worker. Signing in and verification happen in its visible browser. The service
only starts, polls, or requests cancellation, so a service reload does not kill a
sign-in session. One worker at a time owns the browser profile. Its durable state,
cookies, progress, and cancellation files remain under local user-data state,
outside the notebook. The HTTP response exposes only progress and the draft.

The worker reads the selected person's main page content and visible company
links, then asks the configured balanced model for an editable suggestion. Source
text is untrusted evidence; unsupported fields and invented company URLs are
discarded. Missing or ambiguous employment stays incomplete. Browser failures
leave manual entry available; model failures return the name and source URL.
Neither a completed import nor opening its review writes notebook files. Only
Save publishes a person and any missing organizations. Importing never follows
connections, crawls other people, or creates additional records in the background.

The profile reader uses `RenderedHtml`, with raw HTML and unsafe URL schemes
removed at rendering. Unchanged HTML keeps its nodes through refreshes, preserving
selection. Browser coverage uses an isolated notebook and scripted import host;
an authenticated live LinkedIn session must be exercised separately.
