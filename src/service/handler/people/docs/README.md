---
created: 2026-09-23
updated: 2026-09-26
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
then a LinkedIn company URL, then an exact name or alias. People keep their
organizations in `orgs.current` and `orgs.past`, by name, as every notebook
reference is written. Two organizations therefore never share a name: not as a
name, not as an alternate name, and not apart from case, spacing or punctuation
("Atlas Inc" and "Atlas, Inc." are one name). The page refuses a clash when an
organization is created, renamed or given an alternate name, and `org:new` refuses
it too, with no override. A person who writes an organization's name another way
is linked to it. A conflicting company URL asks for the existing record, or for the
new organization under a name of its own.

Search results rank by the existing service person/organization scores, with
alphabetical ties. Without a search, the selected alphabetical or recent ordering
applies. Scores refresh independently of the cached Markdown profile metadata.
Empty Markdown sections and historical heading echoes are hidden at rendering;
the source file stays intact, including its template headings.

Metadata edits patch the YAML document, retaining unknown keys and YAML comments.
Existing Markdown is preserved verbatim. Notes append a dated section. Writes
require the reviewed content hash, run under a local process lock, and publish
atomically. This lock coordinates these UI writes; external notebook editors do
not participate, so writes also recheck the file before replacement. An edit keeps
the file's spacing after the frontmatter. A field emptied by an edit is left out,
never written as `[]`. An organization keeps one website in `site`, several in
`sites`, never both.

New profiles come from the same code as `person:new` and `org:new`
(`commands/all/person/lib/create.ts`, `commands/all/org/lib/`). A person goes under
`people/<year>/<first two letters>/Name.md` with the command's fields and headings.
An organization is looked up as `org:new` looks it up: its website, Wikipedia, and a
model. It is filed under `orgs/<sector>/<subcategory>/Name.md` with its overview.
That lookup takes a few seconds; a failure refuses the save with the reason.
Namesakes get `-2`, `-3`, compared case-insensitively. No operation overwrites
another profile. Organization records created during a person save can survive a
later failure saving that person; a retry matches and reuses them.

## Updating references

A rename works like one in an IDE. Other files name a person or organization in
their frontmatter: `rel`, `who`, `from`, `to`, `cc`, `org`, and, for an
organization, a person's `orgs`. A profile's other spellings stay
in its `name:` list (`alt` for an organization) until someone removes them, so
references using them still resolve.

When other files still use one of those spellings, the profile says so under its
name, with the count. When the file name no longer matches the name, its details
offer to rename the file. Changing the name in the editor opens the same update.

The update previews every change, grouped by kind, and writes nothing until it is
confirmed. Only the characters of each change are replaced; every other character
of each file stays as it was.
- A name is matched by the profile it resolves to, not by text, so a namesake, a
  bare first name, or a link to a file whose name holds the spelling stays.
- The profile's file takes its current name, as `person:new` and `org:new` name
  files: same folder, a person's letters folder following a new first name, and
  `-2`, `-3` past other files. It moves last.
- Every place a file writes out the old path in full points at the new one: chat
  and summary context records, links. The path must start and end
  whole, so a namesake's `Name-2.md` or another folder's path stays.
- What files say, their sentences, is never edited.
- A file changed after the preview is left alone and listed, and so is a value
  that cannot be edited exactly, such as a list written across lines.
- The profile keeps its page address; the reservation follows the file.

New files name the profile by its current name: auto-linking writes the first
name a file lists, and the model's people list shows each person once.

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
