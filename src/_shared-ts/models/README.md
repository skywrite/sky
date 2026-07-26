---
created: 2026-07-26
updated: 2026-07-26
---

# Models

Status section last verified **2026-07-26** — this can drift from `updated:` above, which
also moves for edits that do not re-check the status. If you are reading this much later,
re-run the checks in [Verifying this document](#verifying-this-document) before trusting
it; the structure is stable, the status is a snapshot.

## Two classes per entity

Most entities here ship two classes, and the distinction matters:

| | file | what it is |
|---|---|---|
| **Document** | `X/document/mod.ts` | `XDocument extends Document` — YAML frontmatter + markdown body. Parses, creates, serializes. Knows nothing about other entities. |
| **Model** | `X/model/mod.ts` | `X` — composes an `XDocument` with a `MarkdownStore`. Its job is turning name *strings* into entity *objects* (`doc.yaml['from']` → a `Person`). |

The barrel exports the **Document** as `default`:

```ts
// Person/mod.ts
export { default, default as PersonDocument } from './document/mod.ts'  // ← the default
export { default as Person }                 from './model/mod.ts'      // ← named only
```

So `import PersonDocument from '#shared/models/Person/mod.ts'` gives you the **Document**.
This trips people up: `Person` and `PersonDocument` are different classes, and nearly all
live code runs on the `*Document` one.

## Status: the model layer is dormant

As of 2026-07-26, **every domain model class has zero construction sites outside the
`model/` layer itself**. All 11 of them:

`Day` · `Decision` · `Event` · `Idea` · `Meeting` · `Message` · `Organization` · `Person` ·
`Place` · `Project` · `Video`

The only live calls are model → model:

```
Meeting ─┐
Message ─┼→ Person → Organization
Event   ─┤
Video   ─┘
```

That is a connected subgraph with no root. It type-checks, it has no dead-code warnings,
and it executes zero lines in production.

**This is not rot to be cleaned up on sight.** It is a designed layer that has not been
given an entry point yet. Deleting it is a real option (see below), but it should be a
decision, not a drive-by.

## Why it drifted

The model layer's one distinctive capability is store-backed name resolution. The query
layer needed the same underlying thing — matching `involves: "Bob"` against a document
whose `who:` says `Bob Smith` — but for **filtering**, not for materializing objects.

So it grew its own, in `DomainCollection/query/nameResolver.ts`, and that implementation is
strictly better at the filtering job:

- alias-set lookup, then token matching, then token *prefix* matching (`"Dan"` → `"Daniel"`)
- interaction-score disambiguation with a win margin, rather than first-match
- memoized, and shaped as `(name) => string[]` so resolution only ever **widens** matching

`store.resolve(raw) → Person` does none of that. Two different jobs — "which names mean
this person, ranked by score" versus "give me the object" — and the query layer needed the
first. The model layer was superseded for that use case, not forgotten.

## What DomainCollection actually composes

The original intent was that `DomainCollection` deal in models. In practice it composes
**`Document` + `MarkdownStore`**, and the GraphQL query path runs on that:

```
schema.ts            videos: () => liveDc()?.videos(args)
resolvers.ts         domain.entriesByType('video')  → { doc: Document, path }[]
resolvers.ts         docToVideo(doc, path, day)     → plain object for GraphQL
```

The `Document` in that chain is the base markdown class produced by
`service/scanner/scan.ts`, which parses **every** time-based file into a plain
`MarkdownDoc`. It is never an `XDocument` and never a model.

That has one consequence worth knowing before you touch `DomainCollection`'s getters:

- **Entity getters** (`orgs`, `people`, `projects`, `goals`, `ideas`, `places`) read from
  typed sub-stores, so `getAll() as PersonDocument[]` is sound.
- **Time-based getters** (`videos`) do not have a typed sub-store behind them. The same
  cast there would be a lie, so `videos` *constructs* — `new VideoDocument(doc.yaml,
  doc.markdown, doc.yamlError)`. Copy the construction, not the cast.

The import list in `DomainCollection/mod.ts` encodes exactly this, and the asymmetry is
deliberate: the casting getters need their class only in a type position (a cast *is* a type
position), so they use `import type` and erase at compile time. `VideoDocument` is `new`ed,
so it must be a value import. If you ever see a second non-`type` entity import appear
there, it means someone else stopped casting — which is a good sign, not a smell.

## If you are adding an entity today

Write the **Document**. That is the part that carries weight: creation defaults,
`yamlKeyOrder`, typed accessors, a fixture and a roundtrip test. Wire it into
`Markdown/Collection/entityTypes.ts` (type union, priority, path pattern) and, if it should
be queryable, into `DomainCollection/query/` (`parser.ts`, `transpiler.ts`, `resolvers.ts`
filter + `docToX` + root resolver).

Add the **model** only if you want symmetry with its siblings, and know you are adding to a
layer nothing calls yet. It costs little and it keeps the directory uniform — `Video/model/mod.ts`
was added on 2026-07-26 on exactly those grounds.

## What would revive the layer — or retire it

**Revive:** a caller that wants to *traverse* rather than *filter* — `video.from.org`,
`.lastInteraction`, an object walk. GraphQL exposing `from`/`who`/`rel` as entity types
instead of raw strings is the natural one, and notebook queries are AI-generated and
ephemeral, so changing those field shapes costs nothing in compatibility. That is a feature
worth building because you want the feature.

**Retire:** if the layer stays superseded, eleven files that *look* load-bearing are a
liability rather than neutral — they read like a live typed system and invite exactly the
unsound cast described above. Deleting `model/` would make the codebase honest about where
the domain logic lives.

Both are defensible. What is not defensible is converting `DomainCollection` to models as
tidiness: it would duplicate or regress `nameResolver`, add a wrapper allocation per result
row on a hot query path for values GraphQL immediately flattens back to strings, and require
making `DomainCollection`'s currently-nullable `store` mandatory.

## Verifying this document

The status section is a snapshot. To re-check it, count construction sites for each model
class, excluding its own definition:

```sh
cd src
for c in Day Decision Event Idea Meeting Message Organization Person Place Project Video; do
  printf '%-14s ' "$c"
  grep -rEn --include='*.ts' "\b(new $c\(|$c\.from\()" . \
    | grep -v node_modules | grep -v "models/$c/model/mod.ts" | wc -l
done
```

Two known false positives: `Day/document/timezone_test.ts` constructs the *Document*
(imported locally as `Day`), and `service/handler/` matches the DOM's `new Event(...)`.
Anything else is a real caller — and means this document is out of date.
