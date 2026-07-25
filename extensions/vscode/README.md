---
updated: 2026-07-23
---

# VSCode Extension

Notebook helper extension: entity completions (people, projects, tags, organizations, places, day items, notes), day-file handlers (checkbox/reminder/todo gutters), Typora integration (Cmd+T), and Claude-powered summarize commands.

## No build step

VS Code loads `src/extension.ts` directly: the package is `"type": "module"`, `main` points at the TypeScript entry, and the Node extension host strips types at load (VS Code ≥ 1.100; Node per `.nvmrc`). Edit a file, reload the window, done. `.prompt.md` templates are read at call time via `import.meta.url`, so editing them takes effect without a reload.

## Install

Symlink the extension into VS Code's extensions folder, install deps, then fully restart VS Code (restart, not window reload — the extension scanner only reads the folder at startup):

```bash
ln -s /path/to/sky-oss/extensions/vscode ~/.vscode/extensions/sky-ext
cd /path/to/sky-oss/extensions/vscode && npm install
```

After that it runs from the repo in place; edits take effect on the next window reload. If a fresh machine ever fails to register the symlink, the fallback is launching with `code --extensionDevelopmentPath=/path/to/sky-oss/extensions/vscode`.

## Layout

- `src/` — extension source
- `shared` → `../../src/_shared-ts` (symlink) — notebook shared code, addressed as `#shared/*`, `#universal/*`, `#config` via the package.json `imports` map
- `lib` → `../../src/lib` (symlink) — `#lib/*`
- `resources/` — gutter icons
- `scripts/` — the guard scripts behind `npm run check` (see Scripts below)

The symlinks exist because Node forbids `imports` targets outside the package directory. Resolution realpaths through them, so shared code's own `#`-imports keep resolving against `src/package.json`. Consequence: the extension cannot be packaged with vsce — it only runs installed in place, per Install above.

## Constraints on the import graph

Node's stripper erases types only — it rejects non-erasable syntax at load, which would surface as an activation crash. The rules, and what enforces each:

| rule | enforced by |
|---|---|
| no parameter properties, enums, or runtime namespaces | `erasableSyntaxOnly` (tsconfig) |
| no angle-bracket assertions — `x as T`, never `<T>x` | `scripts/stripcheck.ts` (tsc cannot catch these) |
| type-only imports marked `import type` | `verbatimModuleSyntax` (tsconfig) |
| import specifiers explicit: `./x.ts`, `#shared/y/mod.ts` | resolution fails fast otherwise |

Dependencies: imports in extension source resolve from `node_modules/` here — so the manifest declares only what extension source itself imports (`ws`, `yaml`). Imports inside shared code resolve from `src/node_modules` on both sides: at runtime via the symlinks' realpath, at typecheck via the tsconfig `paths` block that maps `#`-imports to their real locations — no mirror copies needed here. `scripts/depparity.ts` asserts version parity for any declared overlap and that the runtime (`imports`) and typecheck (`paths`) maps stay equivalent.

## Scripts

```bash
npm run typecheck  # tsc --noEmit over src plus all reachable shared code
npm run check      # typecheck + the three guard scripts below
npm test           # runs the *_test.ts suite in a real VS Code host
```

### The guard scripts (`scripts/`)

With no build step, the invariants a bundler would have enforced (or hidden)
are held by three small scripts instead. Each runs in `npm run check` and, on
failure, prints exactly what to fix.

**`stripcheck.ts` — "everything Node will load, Node can strip."** Walks the
real import graph from the extension, test, and script entry points and runs
Node's *actual* type stripper over every reachable file. This catches what
tsc cannot: syntax that typechecks fine but that the runtime rejects at load
— most notably angle-bracket assertions (`<T>x`), which are erasable syntax
tsc accepts even with `erasableSyntaxOnly`, yet Node refuses for JSX
ambiguity. Without this guard, that class of mistake surfaces as an
activation crash.

**`depparity.ts` — "both resolution views agree."** The extension resolves
modules two ways: extension source loads from `node_modules/` here, while
shared code loads from `src/node_modules` (runtime realpaths through the
symlinks; typecheck follows the tsconfig `paths` block to the same real
locations). The guard asserts (1) any package declared in both places is
version-identical — otherwise the same specifier loads different code
depending on who imports it — and (2) the runtime map (package.json
`imports`) and the typecheck map (tsconfig `paths`) cover the same
namespaces with equivalent targets, so the editor never checks a different
graph than the one Node runs.

**`syncTitles.ts` — "the palette tells the truth about the model."** Command
titles like `Summarize Transcript (claude-opus-5)` are static manifest
data — VS Code has no runtime retitling — so the model id must be physically
baked into `package.json`. Runtime surfaces (the summary heading, the
progress toast) read the AI registry live via `aiModelId('reasoning')` and
follow role repoints automatically; the titles cannot. Run the script bare
after a repoint to re-bake them (`node scripts/syncTitles.ts`, then reload
the window); its `--check` mode fails `npm run check` while they're stale,
so a model bump can't leave the dropdown lying.
