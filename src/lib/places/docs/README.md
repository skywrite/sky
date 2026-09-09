---
created: 2026-09-08
updated: 2026-09-08
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
alongside people, organizations and projects. Each place quotes its source;
its name and any disambiguating geographic context must appear in that
quote. Resolution uses exact normalized names, aliases or references. A
country, region or city explicitly named in the text can distinguish
namesakes. Fuzzy similarity and interaction scores never choose a place.

The existing selection pass decides which resolved subjects deserve `rel`.
Only selected countries are materialized, before their references are
returned to a writer. Countries in old relationship history alone are not
evidence of a new discussion. A failed creation omits that link while the
capture can still save. Unknown cities and ambiguous venues remain unresolved.

New captures use this through their existing auto-rel call. A resumed chat
with existing relationships also checks new turns for place subjects,
preserving its prior links and adding only new place identities.
`--no-auto-rel` disables both paths.

## Backfill preview

`places:backfill` checks existing `rel` targets across the requested date and
medium range, then analyzes the newest twenty records for missing place
relationships (`--limit`, `--since`, and `--medium` control the scope).
Only sampled document bodies are fetched. The preview strips YAML and HTML
comments before extraction and uses history from strictly earlier days.

Reports in a temporary directory contain proposed `rel` additions, country
records to create, ambiguous candidates, and analysis failures. The command
never changes a source record or creates a country. Legacy references count
as existing links, so they do not acquire duplicate canonical references.

## Readers

The Links picker, frontmatter completion, global search, backlinks and AI
context traversal share place identities. Backlinks include physical location
and geographic parent fields as well as `rel`. A location's coordinate object
and a chat's parent object are metadata, not links. Name aliases remain valid
when reopening older saved links or resuming an import.

VS Code's directory completion continues to emit the existing logical paths;
geographic `.md` files can be completed beside their child directories.

Descendant-place query filters and applying a reviewed relationship backfill
remain future work.

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
