---
created: 2026-09-08
updated: 2026-09-24
---

# Places

A place has a display name, a logical reference, and a markdown file. The
reference written in `rel`, `where` or `location` is `places/...`. The web
picker displays the name but saves the reference. All readers use the shared
place store, including legacy name lookups when they are unambiguous.

Discussed places go in `rel`. A day's location and a person's location use
`location`; meetings use `where`. The nested `location` map inside a place
record is geographic metadata. Automatic subject linking writes only `rel`.

## Records and identity

Geographic records use `kind: country | region | city | neighborhood | area`,
an explicit `ref`, and an optional `parent` reference. They need no coordinates
or Maps account. Venue records retain their existing `type` categories and
location data; a missing `kind` means venue.

`places/locations/FR.md` can represent `places/FR` while the adjacent `FR/`
directory holds cities and venues. `places:ensure places/FR` creates that
record once. Other geographic records need `--name` and `--kind`; `--parent`
sets their containing place. An explicit country parent is created if missing;
other parents must exist first.

An explicit `ref` survives a file move or display-name change. Older files
without one continue to use their file-derived reference. `refAliases` lists
former references; `alt` and `names` list display-name aliases. Names and refs
have separate indexes. Collisions remain unresolved until disambiguated; a
duplicate name never removes a record from the picker. File-shaped references
with `locations/` or `.md` remain readable. Reads do not create files.

## Repair

`places:repair` previews unresolved explicit place refs across indexed records,
including `rel`, `where`, `location` and geographic `parent`. `--apply` creates
recognized missing country/territory records. Other refs remain in the report:
the command does not infer a city or venue from arbitrary path segments.

Country names come from the runtime's ICU data via `Intl.DisplayNames`.
Macroregions, deprecated codes and pseudo-locales are excluded using
[CLDR's region validity categories](https://github.com/unicode-org/cldr/blob/main/common/validity/region.xml).
Creation uses exclusive file writes and preserves existing records. Repeating
a repair never overwrites metadata or notes, and original references remain
unchanged. An existing unnamed file or a conflicting reference needs manual
repair before creation can proceed.

## Automatic relationships and country selection

`catalog.ts` combines saved places with recognized countries that have no
record yet. Country names, codes and common abbreviations use the same
lookup in automatic relationship extraction and the manual Links picker.
Existing identities and aliases win over a proposed country file. Searches
never create records; selecting a missing country creates it once, validates
its destination, and supplies a normal resolvable link. Unsaved countries
have no file preview until selected.

The shared `lib/notebook/enrich` pipeline extracts substantive place subjects
alongside people, organizations and projects. Extraction distinguishes literal
geography and physical venues from institutions, products, dates, times and
events; sharing a place's name does not make an entity geographic. Each place
quotes its source; its name and any disambiguating geographic context must appear in that
quote. Emphasis, whitespace and typographic quotes can differ, but words cannot be changed
or omitted. Extraction and selection read the same bounded source window.
Place candidates are discovered across substantive sections independently
of the entry's main people, organizations and projects; selection applies the
final link limit. Resolution uses exact normalized names, aliases or references. A
country, region or city explicitly named in the text can distinguish
namesakes. A comma-qualified name uses its written suffixes as context only
when no full name or alias matches; the longest exact named prefix wins, and
every qualifier must agree. Commas inside venue names remain part of the name.
Fuzzy similarity and interaction scores never choose a place.

The existing selection pass decides which resolved subjects deserve `rel`.
When a place name appears only inside an extracted person, organization or
project name, it is discarded before selection. A separate occurrence in the
visible source is required; regulatory context alone cannot supply one.
Place-only requests keep competing people, organizations and projects visible
until selection; only the returned additions are restricted to places, and
other entities do not consume the place request's link budget. A place
must receive a unique subject or destination judgment with a reason, backed by
its original grounded extraction quote. A destination can identify a business-trip
account or firsthand visit impressions without being a separate geography topic.
The selector reuses that evidence instead of
transcribing it again. A meaningful place topic can be a short section of a
longer entry; the entire entry need not be about that place. Incidental and non-geographic uses, missing or
conflicting judgments, and evidence outside the selector's visible source are
rejected. These judgments are internal model output, not YAML fields. Semantic
classification still needs evaluation; a grounded quote alone is not proof
that the place deserves a relationship.
Only selected countries are materialized, before their references are
returned to a writer. Countries in old relationship history alone are not
evidence of a new discussion. A failed creation omits that link while the
capture can still save. Unknown cities and ambiguous venues remain unresolved.

New captures use this through their existing auto-rel call. A resumed chat
with existing relationships also checks new turns for place subjects,
preserving its prior links and adding only new place identities.
`--no-auto-rel` disables both paths.

## Reviewed backfill

`places:backfill` checks existing `rel` targets across the requested date and
medium range, then analyzes the newest twenty records for missing place
relationships (`--limit`, `--since`, and `--medium` control the scope).
`--sample spread` balances record types and spans each type's date range;
the default `recent` sample stays newest-first. Both modes deduplicate file
paths before assigning quotas or applying the limit, so a file indexed under
multiple record types consumes one sample slot. Date, path and medium sorting
make the representative stable when input order changes. Only sampled document
bodies are fetched. The preview strips YAML and HTML comments before extraction and
uses history from strictly earlier days. Relationships and summaries come
from the fetched source, so stale index metadata cannot supply an already
removed link or summary as evidence.

Reports in a temporary directory contain proposed `rel` additions with source
quotes, country records to create, ambiguous candidates, and analysis failures.
Preview never changes a source record or creates a country. Legacy references
count as existing links, so they do not acquire duplicate canonical references.

Review `preview.md`, remove rejected rows or individual `add`/`create` entries
from `preview.json`, then run `places:backfill --apply <report.json>`. The JSON
report binds proposals to the notebook and fingerprints the exact source
contents, including YAML and comments. Older reports without these fields
must be regenerated. Apply uses the retained per-document proposals; the
whole-range repair summary and ambiguous candidates are informational.

Apply calls no model. It validates the report before writing, rechecks place
identities and destinations, and adds links through the shared YAML link
editor and the document service's version-checked save. Existing relationships,
other metadata, comments and the exact markdown body survive. A source changed
since preview or during apply is skipped. Already-satisfied proposals write
nothing, so retrying a report does not add duplicates.

Only retained country creations still needed by an existing or retained new
link are materialized. Missing cities and venues require confirmed records;
unknown names never become invented places. A target must exist before its
link is saved. If a source save then conflicts or fails, the country remains
and the apply receipt reports it alongside the skipped or failed source.

## Readers

The Links picker, frontmatter completion, global search, backlinks and AI
context traversal share place identities. Backlinks include physical location
and geographic parent fields as well as `rel`. A location's coordinate object
and a chat's parent object are metadata, not links. Name aliases remain valid
when reopening older saved links or resuming an import.

VS Code's directory completion continues to emit the existing logical paths;
geographic `.md` files can be completed beside their child directories.

Descendant-place GraphQL query filters remain future work.

## Web management and maps

`/places` shares the People & Orgs settings sidebar. The HTTP owner is
`service/handler/places`; it reads the existing MarkdownStore and publishes saved
files back into that store immediately. Detail URLs encode the logical place
reference. Editing a legacy record pins its current reference explicitly, so a
name change or later file move does not break links. New records use dated,
case-preserving filenames under `places/locations/YYYY/`. Recognized countries
keep their natural `places/XX` identity, matching repair and automatic linking.

Parent choices are saved references and must resolve uniquely to geography.
Self-parenting and descendant cycles are refused. Existing hierarchical venue
references can display their closest saved geographic ancestor without changing
the file. The web list's location filter and geography detail traverse this parent
chain. They do not infer unsaved city records from directory names.

Metadata edits patch YAML, preserving unknown fields, comments, and the exact
Markdown body. Notes append a dated section. Revisions, a process lock and atomic
publication protect writes; new namesakes require an explicit choice and receive
collision suffixes. Archiving sets `archived: true` and hides the place from the
active UI list. The file and shared reference remain available to linked notebook
records; restore reverses the flag. Rendering uses the safe profile Markdown
renderer and the shared `RenderedHtml` component.

Google search is a server-side draft operation; only Save writes a place. Requests
use Places API (New), with the existing Places endpoint as a compatibility fallback
when the project refuses the new API. Saved `googlePlaceId` values detect repeated
imports. Network errors never send credential-bearing request URLs to the client.

Maps JavaScript loads only when displaying a map. Existing installations reuse
the shared `GOOGLE_MAPS_KEY` for both the map and Places search; Maps JavaScript API
must also be enabled on that project. Map credentials are visible in the browser.
A dedicated `GOOGLE_MAPS_BROWSER_KEY` overrides the shared key for maps, allowing
website restrictions independently of server lookups. Setup is available from
Places and keeps keys in the existing keychain: category `google-maps`, entries
`browser` and `server`; an optional `map-id` entry selects a custom map. Stored
values take precedence over the corresponding environment keys. The explicitly
server-only keychain entry is never exposed to the browser or reused for maps.
Search keys need Places API and billing enabled.
Manual creation, geographic records, notes, and list browsing work without either
key. Tests use temporary notebooks and scripted Google responses, never live keys.

## Verification

`../places_test.ts` covers geographic records, moves, aliases, duplicate names,
reference conflicts and repeatable repair. The Links route tests cover the
full search → reference → write → resolve → backlink path, including location
and parent traversal. `service/handler/http-places-e2e_test.ts` exercises the
picker on desktop and phone and reopens a saved country link.
`../catalog_test.ts` and `lib/notebook/enrich/places_test.ts` cover shared
lookup, quoted evidence, ambiguity, creation after selection, and previews
that leave notebook files untouched. The browser test also creates unsaved
countries from the picker on desktop and phone.

## Notes

- [2026-09-08 — Place subjects and creation at selection](2026-09-08-place-subjects.md).
- [2026-09-08 — Place references need records and one identity](2026-09-08-place-identities.md).
