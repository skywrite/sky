---
created: 2026-09-08
updated: 2026-09-08
---

# Places

A place has a display name, a logical reference, and a markdown file. The
reference written in `rel`, `where` or `location` is `places/...`. The web
picker displays the name but saves the reference. All readers use the shared
place store, including legacy name lookups when they are unambiguous.

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

## Readers

The Links picker, frontmatter completion, global search, backlinks and AI
context traversal share place identities. Backlinks include physical location
and geographic parent fields as well as `rel`. A location's coordinate object
and a chat's parent object are metadata, not links. Name aliases remain valid
when reopening older saved links or resuming an import.

VS Code's directory completion continues to emit the existing logical paths;
geographic `.md` files can be completed beside their child directories.

This foundation does not yet add places to the automatic subject extractor,
offer unsaved countries in the web picker, or provide descendant-place query
filters. Those features should build on these identities and creation rules.

## Verification

`../places_test.ts` covers geographic records, moves, aliases, duplicate names,
reference conflicts and repeatable repair. The Links route tests cover the
full search → reference → write → resolve → backlink path, including location
and parent traversal. `service/handler/http-places-e2e_test.ts` exercises the
picker on desktop and phone and reopens a saved country link.

## Notes

- [2026-09-08 — Place references need records and one identity](2026-09-08-place-identities.md).
